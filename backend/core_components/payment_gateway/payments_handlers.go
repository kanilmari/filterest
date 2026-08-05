// payments_handlers.go
// HTTP handlers for the payment gateway integration. Processes payment initiation requests,
// handles gateway callbacks, and updates order status in the database.
// Exists to route app payment workflows through one gateway-facing backend surface.
package payment_gateway

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"easelect/backend/core_components/httpresponse"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	pathpkg "path"
	"strconv"
	"strings"
	"sync"
	"time"

	backend "easelect/backend/core_components"
)

const (
	maxCreatePaymentBodyBytes           int64 = 64 << 10
	maxPaymentWebhookBodyBytes          int64 = 64 << 10
	revolutWebhookTimestampTolerance          = 5 * time.Minute
	revolutWebhookSignatureVersion            = "v1"
	paymentStatusTransitionPredicateSQL       = `(
		(status = 'pending' AND $1 IN ('authorised', 'completed', 'failed', 'cancelled'))
		OR (status = 'authorised' AND $1 IN ('completed', 'failed', 'cancelled'))
	)`
)

var paymentCallbackDeliverer = deliverCompletedPaymentCallback

// ErrCallerManagedPaymentCallback rejects the former request-controlled callback target.
var ErrCallerManagedPaymentCallback = errors.New("payment callback targets are server-managed")

type paymentCallbackTarget struct {
	baseURLEnvs []string
	path        string
}

var (
	paymentCallbackTargetsMu sync.RWMutex
	paymentCallbackTargets   = make(map[string]paymentCallbackTarget)
)

// RegisterPaymentCallbackTarget binds an app identity to one server-owned
// callback path and its ordered origin environment variables. Private apps
// register their own targets during startup so the public payment gateway does
// not depend on or disclose private application routes.
func RegisterPaymentCallbackTarget(appName string, baseURLEnvs []string, callbackPath string) error {
	normalizedAppName := strings.ToLower(strings.TrimSpace(appName))
	if !isValidPaymentCallbackAppName(normalizedAppName) {
		return fmt.Errorf("payment callback app name %q is invalid", appName)
	}
	if len(baseURLEnvs) == 0 {
		return fmt.Errorf("payment callback origin environments are required for app %q", appName)
	}

	envNames := make([]string, len(baseURLEnvs))
	for index, envName := range baseURLEnvs {
		envName = strings.TrimSpace(envName)
		if !isValidPaymentCallbackEnvName(envName) {
			return fmt.Errorf("payment callback origin environment %q is invalid for app %q", envName, appName)
		}
		envNames[index] = envName
	}

	parsedPath, err := url.ParseRequestURI(callbackPath)
	if err != nil || callbackPath == "/" || !strings.HasPrefix(callbackPath, "/") ||
		strings.HasPrefix(callbackPath, "//") || strings.Contains(callbackPath, `\`) ||
		parsedPath.IsAbs() || parsedPath.Host != "" ||
		parsedPath.RawQuery != "" || parsedPath.Fragment != "" || parsedPath.Path != callbackPath ||
		pathpkg.Clean(callbackPath) != callbackPath {
		return fmt.Errorf("payment callback path %q is invalid for app %q", callbackPath, appName)
	}

	paymentCallbackTargetsMu.Lock()
	defer paymentCallbackTargetsMu.Unlock()
	if _, exists := paymentCallbackTargets[normalizedAppName]; exists {
		return fmt.Errorf("payment callback target is already registered for app %q", appName)
	}
	paymentCallbackTargets[normalizedAppName] = paymentCallbackTarget{
		baseURLEnvs: envNames,
		path:        callbackPath,
	}
	return nil
}

func isValidPaymentCallbackAppName(appName string) bool {
	if len(appName) == 0 || len(appName) > 100 {
		return false
	}
	for index, char := range appName {
		if (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') ||
			(index > 0 && (char == '-' || char == '_')) {
			continue
		}
		return false
	}
	return true
}

func isValidPaymentCallbackEnvName(envName string) bool {
	if envName == "" {
		return false
	}
	for index, char := range envName {
		if (char >= 'A' && char <= 'Z') || char == '_' ||
			(index > 0 && char >= '0' && char <= '9') {
			continue
		}
		return false
	}
	return true
}

// PaymentRequest represents a request to create a payment
type PaymentRequest struct {
	AppName         string            `json:"app_name"`
	ExternalOrderID string            `json:"external_order_id"`
	CustomerEmail   string            `json:"customer_email"`
	AmountCents     int               `json:"amount_cents"`
	Currency        string            `json:"currency"`
	Description     string            `json:"description"`
	SuccessURL      string            `json:"success_url"`
	CancelURL       string            `json:"cancel_url"`
	Locale          string            `json:"locale"`
	Metadata        map[string]string `json:"metadata"`
	// CallbackURL is retained only to reject the former caller-managed API field.
	CallbackURL string `json:"callback_url"`
}

// PaymentResponse represents the response after creating a payment
type PaymentResponse struct {
	PaymentID    int    `json:"payment_id"`
	PaymentToken string `json:"payment_token"`
	CheckoutURL  string `json:"checkout_url"`
	Status       string `json:"status"`
}

// PaymentStatusResponse represents payment status
type PaymentStatusResponse struct {
	PaymentID      int       `json:"payment_id"`
	PaymentToken   string    `json:"payment_token"`
	Status         string    `json:"status"`
	AmountCents    int       `json:"amount_cents"`
	Currency       string    `json:"currency"`
	PaidAt         *string   `json:"paid_at,omitempty"`
	RevolutOrderID string    `json:"revolut_order_id,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
}

var revolutClient *RevolutClient

func validateCreatePaymentServiceToken(r *http.Request) bool {
	expectedToken := strings.TrimSpace(os.Getenv("MCP_SERVICE_TOKEN"))
	if expectedToken == "" {
		return strings.TrimSpace(os.Getenv("ENVIRONMENT_TYPE")) == "dev"
	}

	authHeader := strings.TrimSpace(r.Header.Get("Authorization"))
	parts := strings.SplitN(authHeader, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return false
	}

	return hmac.Equal([]byte(parts[1]), []byte(expectedToken))
}

// Init initializes the payment gateway, ensuring required tables exist
func Init() error {
	// Guard: skip initialization when the database connection is not available
	// (e.g. during conformance tests that only register routes without a running DB).
	if backend.Db == nil {
		log.Printf("\033[33mwarning: payment gateway skipped — no database connection\033[0m")
		return nil
	}

	// Ensure payments table exists
	if err := ensurePaymentsTable(); err != nil {
		log.Printf("\033[33mwarning: could not ensure payments table: %v\033[0m", err)
		// Continue anyway — table may already exist via migration
	}

	var err error
	revolutClient, err = NewRevolutClient()
	if err != nil {
		log.Printf("\033[33mwarning: payment gateway not initialized: %v\033[0m", err)
		return err
	}

	mode := "PRODUCTION"
	if revolutClient.IsSandbox() {
		mode = "SANDBOX"
	}
	log.Printf("[payment-gateway] ✅ Initialized in %s mode", mode)

	return nil
}

// ensurePaymentsTable creates the payments table if it does not exist.
// This is idempotent — safe to run on every startup.
func ensurePaymentsTable() error {
	_, err := backend.Db.Exec(`
		CREATE TABLE IF NOT EXISTS payments (
			id                    SERIAL PRIMARY KEY,
			app_name              VARCHAR(100) NOT NULL,
			external_order_id     VARCHAR(255),
			customer_email        VARCHAR(255) NOT NULL,
			amount_cents          INTEGER NOT NULL,
			currency              VARCHAR(3) NOT NULL DEFAULT 'EUR',
			status                VARCHAR(50) NOT NULL DEFAULT 'pending',
			revolut_order_id      VARCHAR(255),
			revolut_checkout_url  TEXT,
			metadata              JSONB DEFAULT '{}',
			payment_token         UUID DEFAULT gen_random_uuid(),
			paid_at               TIMESTAMPTZ,
			webhook_received_at   TIMESTAMPTZ,
			created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`)
	if err != nil {
		return fmt.Errorf("create payments table: %w", err)
	}

	// Create indexes (IF NOT EXISTS is implicit for CREATE INDEX IF NOT EXISTS)
	for _, idx := range []string{
		`CREATE INDEX IF NOT EXISTS idx_payments_token ON payments(payment_token)`,
		`CREATE INDEX IF NOT EXISTS idx_payments_revolut_order_id ON payments(revolut_order_id)`,
		`CREATE INDEX IF NOT EXISTS idx_payments_app_name ON payments(app_name)`,
	} {
		if _, err := backend.Db.Exec(idx); err != nil {
			log.Printf("\033[33mwarning: index creation: %v\033[0m", err)
		}
	}

	log.Printf("[payment-gateway] payments table ready")
	return nil
}

// CreatePayment creates a Revolut payment order and saves it to the database.
// This is the core business logic, usable by both HTTP handlers and internal Go callers.
func CreatePayment(req PaymentRequest) (*PaymentResponse, error) {
	if strings.TrimSpace(req.CallbackURL) != "" {
		return nil, ErrCallerManagedPaymentCallback
	}
	if _, callerManagedCallback := req.Metadata["callback_url"]; callerManagedCallback {
		return nil, ErrCallerManagedPaymentCallback
	}
	if revolutClient == nil {
		return nil, fmt.Errorf("payment gateway not initialized")
	}

	// Validate required fields
	if req.AppName == "" || req.CustomerEmail == "" || req.AmountCents <= 0 {
		return nil, fmt.Errorf("missing required fields: app_name, customer_email, amount_cents")
	}

	if req.Currency == "" {
		req.Currency = "EUR"
	}

	// Create order in Revolut
	revolutReq := CreateOrderRequest{
		Amount:           req.AmountCents,
		Currency:         req.Currency,
		Description:      req.Description,
		CustomerEmail:    req.CustomerEmail,
		MerchantOrderRef: req.ExternalOrderID,
		RedirectURL:      req.SuccessURL,
		Locale:           req.Locale,
	}

	order, err := revolutClient.CreateOrder(revolutReq)
	if err != nil {
		return nil, fmt.Errorf("failed to create Revolut order: %w", err)
	}

	// Convert metadata to JSON
	metadataJSON, _ := json.Marshal(req.Metadata)

	// Insert into payments table
	var paymentID int
	var paymentToken string
	err = backend.Db.QueryRow(`
		INSERT INTO payments (
			app_name, external_order_id, customer_email, amount_cents, currency,
			status, revolut_order_id, revolut_checkout_url, metadata, payment_token
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, gen_random_uuid())
		RETURNING id, payment_token
	`,
		req.AppName, req.ExternalOrderID, req.CustomerEmail, req.AmountCents, req.Currency,
		"pending", order.ID, order.CheckoutURL, string(metadataJSON),
	).Scan(&paymentID, &paymentToken)

	if err != nil {
		log.Printf("\033[31merror: failed to save payment to database: %v\033[0m", err)
		return nil, fmt.Errorf("failed to save payment: %w", err)
	}

	log.Printf("[payment-gateway] Created payment #%d for %s (Revolut: %s)", paymentID, req.AppName, order.ID)

	return &PaymentResponse{
		PaymentID:    paymentID,
		PaymentToken: paymentToken,
		CheckoutURL:  order.CheckoutURL,
		Status:       "pending",
	}, nil
}

// CreatePaymentHandler handles POST /api/payments/create
func CreatePaymentHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	if !validateCreatePaymentServiceToken(r) {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, "service_token_invalid")
		return
	}

	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxCreatePaymentBodyBytes))
	var req PaymentRequest
	if err := decoder.Decode(&req); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			httpresponse.RespondWithError(w, http.StatusRequestEntityTooLarge, "payment_request_too_large")
			return
		}
		httpresponse.RespondWithError(w, http.StatusBadRequest, "payment_request_invalid")
		return
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "payment_request_invalid")
		return
	}

	resp, err := CreatePayment(req)
	if err != nil {
		log.Printf("\033[31merror: %v\033[0m", err)
		if errors.Is(err, ErrCallerManagedPaymentCallback) {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "callback_url_server_managed")
			return
		}
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "payment_create_failed")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// GetPaymentStatusHandler handles GET /api/payments/:token or /api/payments/:token/status
func GetPaymentStatusHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	// Extract token from URL path: /api/payments/{token} or /api/payments/{token}/status
	path := strings.TrimSuffix(r.URL.Path, "/")
	path = strings.TrimSuffix(path, "/status")
	parts := strings.Split(path, "/")
	if len(parts) < 3 {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "Invalid path")
		return
	}
	token := parts[len(parts)-1] // Last part is the token

	var resp PaymentStatusResponse
	var paidAt *time.Time

	err := backend.Db.QueryRow(`
		SELECT id, payment_token, status, amount_cents, currency, paid_at, revolut_order_id, created_at
		FROM payments WHERE payment_token = $1
	`, token).Scan(
		&resp.PaymentID, &resp.PaymentToken, &resp.Status,
		&resp.AmountCents, &resp.Currency, &paidAt,
		&resp.RevolutOrderID, &resp.CreatedAt,
	)

	if err != nil {
		httpresponse.RespondWithError(w, http.StatusNotFound, "Payment not found")
		return
	}

	if paidAt != nil {
		formatted := paidAt.Format(time.RFC3339)
		resp.PaidAt = &formatted
	}

	// Pending and authorised payments may advance from the provider's current
	// order state. Terminal local states are never polled or downgraded.
	if (resp.Status == "pending" || resp.Status == "authorised") && resp.RevolutOrderID != "" && revolutClient != nil {
		order, err := revolutClient.GetOrder(resp.RevolutOrderID)
		if err == nil && order != nil {
			revolutState := strings.ToLower(order.State)
			if isKnownPaymentStatus(revolutState) {
				now := time.Now().UTC()
				result, updateErr := backend.Db.Exec(`
					UPDATE payments
					SET status = $1,
					    paid_at = CASE WHEN $1 = 'completed' THEN $2 ELSE paid_at END
					WHERE payment_token = $3 AND `+paymentStatusTransitionPredicateSQL+`
				`, revolutState, now, token)
				if updateErr != nil {
					log.Printf("\033[33mwarning: failed to update payment status: %v\033[0m", updateErr)
				} else if rowsAffected, rowsErr := result.RowsAffected(); rowsErr != nil {
					log.Printf("\033[33mwarning: failed to verify payment status update: %v\033[0m", rowsErr)
				} else if rowsAffected > 0 {
					log.Printf("[payment-gateway] Updated payment %s status to %s (from Revolut live check)", token, revolutState)
					resp.Status = revolutState
					if revolutState == "completed" {
						formatted := now.Format(time.RFC3339)
						resp.PaidAt = &formatted
					}
				}
			}
		}
	}
	if resp.Status == "completed" && resp.RevolutOrderID != "" {
		if delivered, callbackErr := paymentCallbackDeliverer(resp.RevolutOrderID); callbackErr != nil {
			log.Printf("\033[31merror: failed to redeliver completed payment callback during live status check: %v\033[0m", callbackErr)
		} else if delivered {
			log.Printf("[payment-gateway] Redelivered completed payment callback during live status check for %s", resp.RevolutOrderID)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// WebhookHandler handles POST /api/payments/webhook
func WebhookHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxPaymentWebhookBodyBytes))
	if err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			httpresponse.RespondWithError(w, http.StatusRequestEntityTooLarge, "Webhook payload too large")
			return
		}
		httpresponse.RespondWithError(w, http.StatusBadRequest, "Failed to read body")
		return
	}

	// Webhook signature verification — fail closed if secret is not configured
	webhookSecret := strings.TrimSpace(os.Getenv("REVOLUT_WEBHOOK_SECRET"))
	if webhookSecret == "" {
		log.Printf("\033[31merror: REVOLUT_WEBHOOK_SECRET not configured — rejecting webhook\033[0m")
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "Webhook not configured")
		return
	}
	timestampHeaders := r.Header.Values("Revolut-Request-Timestamp")
	signature := strings.Join(r.Header.Values("Revolut-Signature"), ",")
	if len(timestampHeaders) != 1 || !verifyWebhookSignature(body, timestampHeaders[0], signature, webhookSecret, time.Now().UTC()) {
		log.Printf("\033[31merror: invalid webhook signature\033[0m")
		httpresponse.RespondWithError(w, http.StatusUnauthorized, "Invalid signature")
		return
	}

	var payload WebhookPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		log.Printf("\033[31merror: failed to parse webhook payload: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusBadRequest, "Invalid payload")
		return
	}

	if strings.TrimSpace(payload.OrderID) == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "Missing order_id")
		return
	}

	newStatus, supported := paymentStatusForRevolutEvent(payload.Event)
	if !supported {
		log.Printf("[payment-gateway] Ignoring unsupported Revolut webhook event=%s, order_id=%s", payload.Event, payload.OrderID)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("OK"))
		return
	}

	log.Printf("[payment-gateway] Received webhook: event=%s, order_id=%s", payload.Event, payload.OrderID)

	now := time.Now()
	result, err := backend.Db.Exec(`
		UPDATE payments
		SET status = $1, webhook_received_at = $2, paid_at = CASE WHEN $1 = 'completed' THEN $2 ELSE paid_at END
		WHERE revolut_order_id = $3 AND `+paymentStatusTransitionPredicateSQL+`
	`, newStatus, now, payload.OrderID)

	if err != nil {
		log.Printf("\033[31merror: failed to update payment status: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "Failed to update payment status")
		return
	}

	// A completed provider event must attempt downstream delivery even when the
	// status transition was already consumed by an earlier webhook or live GET.
	rowsAffected, rowsAffectedErr := result.RowsAffected()
	if rowsAffectedErr != nil {
		log.Printf("\033[31merror: failed to determine payment status transition result: %v\033[0m", rowsAffectedErr)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "Failed to verify payment status update")
		return
	}
	if rowsAffected == 0 && newStatus != "completed" {
		log.Printf("[payment-gateway] Ignored non-forward payment status transition for order %s", payload.OrderID)
	}

	if newStatus == "completed" {
		delivered, callbackErr := paymentCallbackDeliverer(payload.OrderID)
		if callbackErr != nil {
			log.Printf("\033[31merror: completed payment callback delivery failed for %s: %v\033[0m", payload.OrderID, callbackErr)
			httpresponse.RespondWithError(w, http.StatusBadGateway, "Payment callback delivery failed")
			return
		}
		if rowsAffected == 0 && delivered {
			log.Printf("[payment-gateway] Redelivered idempotent completed callback for %s", payload.OrderID)
		}
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte("OK"))
}

// deliverCompletedPaymentCallback resolves a server-owned callback target and
// completes one bounded synchronous delivery attempt. Webhook callers can then
// return non-2xx on failure so the payment provider retries the idempotent app claim.
func deliverCompletedPaymentCallback(orderID string) (bool, error) {
	if backend.Db == nil {
		return false, fmt.Errorf("payment callback database unavailable")
	}

	var appName string
	var paymentStatus string
	err := backend.Db.QueryRow(`
		SELECT app_name, status
		FROM payments
		WHERE revolut_order_id = $1
	`, orderID).Scan(&appName, &paymentStatus)
	if errors.Is(err, sql.ErrNoRows) {
		return false, fmt.Errorf("completed payment order %s not found", orderID)
	}
	if err != nil {
		return false, fmt.Errorf("load payment callback app: %w", err)
	}
	if paymentStatus != "completed" {
		return false, nil
	}
	callbackURL, configured, err := paymentCallbackURLForApp(appName)
	if err != nil {
		return false, err
	}
	if !configured {
		return false, nil
	}
	if err := triggerCallback(callbackURL, orderID, "completed"); err != nil {
		return false, err
	}
	return true, nil
}

// paymentCallbackURLForApp maps a persisted app identity to an exact callback
// path under a server-configured origin. Neither payment request fields nor
// persisted metadata participate in target selection.
func paymentCallbackURLForApp(appName string) (string, bool, error) {
	paymentCallbackTargetsMu.RLock()
	target, configured := paymentCallbackTargets[strings.ToLower(strings.TrimSpace(appName))]
	paymentCallbackTargetsMu.RUnlock()
	if !configured {
		return "", false, nil
	}

	var rawBaseURL string
	for _, envName := range target.baseURLEnvs {
		if candidate := strings.TrimSpace(os.Getenv(envName)); candidate != "" {
			rawBaseURL = candidate
			break
		}
	}
	if rawBaseURL == "" {
		return "", true, fmt.Errorf("payment callback origin is not configured for app %q", appName)
	}

	baseURL, err := url.Parse(rawBaseURL)
	if err != nil {
		return "", true, fmt.Errorf("parse payment callback origin for app %q: %w", appName, err)
	}
	if (baseURL.Scheme != "http" && baseURL.Scheme != "https") ||
		baseURL.Host == "" || baseURL.User != nil || baseURL.Opaque != "" ||
		(baseURL.Path != "" && baseURL.Path != "/") ||
		baseURL.RawQuery != "" || baseURL.Fragment != "" {
		return "", true, fmt.Errorf("payment callback origin for app %q must be an HTTP(S) origin", appName)
	}
	if baseURL.Scheme == "http" {
		hostname := baseURL.Hostname()
		loopbackIP := net.ParseIP(hostname)
		isLoopback := strings.EqualFold(hostname, "localhost") ||
			(loopbackIP != nil && loopbackIP.IsLoopback())
		if !strings.EqualFold(strings.TrimSpace(os.Getenv("ENVIRONMENT_TYPE")), "dev") || !isLoopback {
			return "", true, fmt.Errorf(
				"payment callback origin for app %q must use HTTPS outside native loopback development",
				appName,
			)
		}
	}

	baseURL.Path = target.path
	baseURL.RawPath = ""
	return baseURL.String(), true, nil
}

// paymentStatusForRevolutEvent maps terminal and authorisation order events
// documented by the Revolut Merchant API to the local payment status model.
func paymentStatusForRevolutEvent(event string) (string, bool) {
	switch event {
	case "ORDER_COMPLETED":
		return "completed", true
	case "ORDER_AUTHORISED":
		return "authorised", true
	case "ORDER_CANCELLED":
		return "cancelled", true
	case "ORDER_FAILED":
		return "failed", true
	default:
		return "", false
	}
}

func isKnownPaymentStatus(status string) bool {
	switch status {
	case "authorised", "completed", "cancelled", "failed":
		return true
	default:
		return false
	}
}

// verifyWebhookSignature verifies Revolut's v1 timestamped HMAC over the exact
// raw request body. During signing-secret rotation Revolut can send several
// comma-separated signatures; any valid v1 candidate is accepted.
func verifyWebhookSignature(body []byte, timestamp, signatureHeader, secret string, now time.Time) bool {
	timestamp = strings.TrimSpace(timestamp)
	if timestamp == "" || secret == "" {
		return false
	}
	for _, char := range timestamp {
		if char < '0' || char > '9' {
			return false
		}
	}
	timestampMillis, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil {
		return false
	}
	requestTime := time.UnixMilli(timestampMillis)
	age := now.UTC().Sub(requestTime)
	if age < -revolutWebhookTimestampTolerance || age > revolutWebhookTimestampTolerance {
		return false
	}

	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(revolutWebhookSignatureVersion + "." + timestamp + "."))
	mac.Write(body)
	expectedSignature := mac.Sum(nil)

	matched := 0
	for _, candidate := range strings.Split(signatureHeader, ",") {
		version, encodedSignature, found := strings.Cut(strings.TrimSpace(candidate), "=")
		if !found || version != revolutWebhookSignatureVersion || len(encodedSignature) != sha256.Size*2 {
			continue
		}
		decodedSignature, err := hex.DecodeString(encodedSignature)
		if err != nil {
			continue
		}
		matched |= subtle.ConstantTimeCompare(decodedSignature, expectedSignature)
	}
	return matched == 1
}
