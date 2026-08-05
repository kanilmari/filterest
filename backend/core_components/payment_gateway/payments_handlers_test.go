// payments_handlers_test.go
// Tests for webhook signature verification and WebhookHandler hardening.
//
// Coverage targets from ticket #820:
//   - verifyWebhookSignature: valid, invalid, empty, wrong-body, wrong-secret
//   - WebhookHandler: method guard, fail-closed (missing secret), invalid sig,
//     missing sig, invalid JSON, idempotency (0 rows affected), successful update
//
// Uses a scripted sql.Driver (no external test libraries) following the project
// pattern in search_vectors/refresh_row_vector_test.go.
package payment_gateway

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"database/sql/driver"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	backend "easelect/backend/core_components"
)

// ── Scripted DB driver ────────────────────────────────────────────────────

// webhookTestDriver is a minimal sql.Driver that records Exec/Query calls.
// Tests can either keep QueryContext empty so QueryRow returns sql.ErrNoRows,
// or preconfigure a single query row for CreatePayment coverage.
type webhookTestDriver struct {
	execRowsAffected int64
	execRowsError    error
	execErr          error
	execQueries      []string
	queryQueries     []string
	queryColumns     []string
	queryValues      []driver.Value
}

type webhookTestResult struct {
	rowsAffected int64
	err          error
}

func (result webhookTestResult) LastInsertId() (int64, error) { return 0, nil }
func (result webhookTestResult) RowsAffected() (int64, error) { return result.rowsAffected, result.err }

type webhookTestConn struct{ drv *webhookTestDriver }
type webhookTestTx struct{}
type webhookTestRows struct {
	columns []string
	values  []driver.Value
	done    bool
}

func (d *webhookTestDriver) Open(_ string) (driver.Conn, error) {
	return &webhookTestConn{drv: d}, nil
}

func (c *webhookTestConn) Prepare(_ string) (driver.Stmt, error) {
	return nil, fmt.Errorf("prepare not supported by webhookTestDriver")
}
func (c *webhookTestConn) Close() error              { return nil }
func (c *webhookTestConn) Begin() (driver.Tx, error) { return &webhookTestTx{}, nil }
func (tx *webhookTestTx) Commit() error              { return nil }
func (tx *webhookTestTx) Rollback() error            { return nil }

// ExecContext satisfies driver.ExecerContext — used by *sql.DB.Exec.
func (c *webhookTestConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	c.drv.execQueries = append(c.drv.execQueries, query)
	if c.drv.execErr != nil {
		return nil, c.drv.execErr
	}
	return webhookTestResult{rowsAffected: c.drv.execRowsAffected, err: c.drv.execRowsError}, nil
}

// Exec satisfies driver.Execer (fallback for older callers).
func (c *webhookTestConn) Exec(query string, args []driver.Value) (driver.Result, error) {
	named := make([]driver.NamedValue, len(args))
	for i, v := range args {
		named[i] = driver.NamedValue{Ordinal: i + 1, Value: v}
	}
	return c.ExecContext(context.Background(), query, named)
}

// QueryContext satisfies driver.QueryerContext for QueryRow / Query callers.
func (c *webhookTestConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	c.drv.queryQueries = append(c.drv.queryQueries, query)
	return c.queryRows(), nil
}

func (c *webhookTestConn) Query(query string, _ []driver.Value) (driver.Rows, error) {
	c.drv.queryQueries = append(c.drv.queryQueries, query)
	return c.queryRows(), nil
}

func (c *webhookTestConn) queryRows() driver.Rows {
	if len(c.drv.queryColumns) == 0 {
		return &webhookTestRows{columns: []string{"app_name", "status"}}
	}

	return &webhookTestRows{
		columns: c.drv.queryColumns,
		values:  c.drv.queryValues,
	}
}

func (r *webhookTestRows) Columns() []string { return r.columns }
func (r *webhookTestRows) Close() error      { return nil }
func (r *webhookTestRows) Next(dest []driver.Value) error {
	if r.done || len(r.values) == 0 {
		return io.EOF
	}

	copy(dest, r.values)
	r.done = true
	return nil
}

// newWebhookTestDB registers a unique scripted driver and opens a DB against it.
func newWebhookTestDB(rowsAffected int64) (*sql.DB, *webhookTestDriver) {
	return newWebhookTestDBWithQueryRow(rowsAffected, nil, nil)
}

func newWebhookTestDBWithQueryRow(rowsAffected int64, queryColumns []string, queryValues []driver.Value) (*sql.DB, *webhookTestDriver) {
	drv := &webhookTestDriver{execRowsAffected: rowsAffected}
	drv.queryColumns = queryColumns
	drv.queryValues = queryValues
	name := fmt.Sprintf("webhook_test_%d", time.Now().UnixNano())
	sql.Register(name, drv)
	db, _ := sql.Open(name, "")
	return db, drv
}

// ── Helpers ───────────────────────────────────────────────────────────────

func computeTestSignature(body []byte, timestamp, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte("v1." + timestamp + "."))
	mac.Write(body)
	return "v1=" + hex.EncodeToString(mac.Sum(nil))
}

func addValidWebhookHeaders(req *http.Request, body []byte, secret string) {
	timestamp := strconv.FormatInt(time.Now().UTC().UnixMilli(), 10)
	req.Header.Set("Revolut-Request-Timestamp", timestamp)
	req.Header.Set("Revolut-Signature", computeTestSignature(body, timestamp, secret))
}

func buildWebhookBody(t *testing.T, event string) []byte {
	t.Helper()
	p := WebhookPayload{
		Event:   event,
		OrderID: "rev_order_test_123",
	}
	b, err := json.Marshal(p)
	if err != nil {
		t.Fatalf("marshal webhook payload: %v", err)
	}
	return b
}

// withDB swaps backend.Db for the duration of the test and restores it after.
func withDB(t *testing.T, db *sql.DB) {
	t.Helper()
	orig := backend.Db
	backend.Db = db
	t.Cleanup(func() { backend.Db = orig })
}

func withPaymentCallbackDeliverer(t *testing.T, deliverer func(string) (bool, error)) {
	t.Helper()
	original := paymentCallbackDeliverer
	paymentCallbackDeliverer = deliverer
	t.Cleanup(func() { paymentCallbackDeliverer = original })
}

// ── verifyWebhookSignature tests ──────────────────────────────────────────

func TestVerifyWebhookSignature(t *testing.T) {
	secret := "super_secret"
	body := []byte(`{"event":"ORDER_COMPLETED","order_id":"ord_1"}`)
	now := time.Date(2026, time.July, 15, 12, 0, 0, 0, time.UTC)
	timestamp := strconv.FormatInt(now.UnixMilli(), 10)
	validSig := computeTestSignature(body, timestamp, secret)
	wrongSig := "v1=" + strings.Repeat("0", sha256.Size*2)

	tests := []struct {
		name      string
		body      []byte
		timestamp string
		signature string
		secret    string
		now       time.Time
		want      bool
	}{
		{
			name:      "valid official v1 signature",
			body:      body,
			timestamp: timestamp,
			signature: validSig,
			secret:    secret,
			now:       now,
			want:      true,
		},
		{
			name:      "valid signature among rotation candidates",
			body:      body,
			timestamp: timestamp,
			signature: wrongSig + ", " + validSig,
			secret:    secret,
			now:       now,
			want:      true,
		},
		{
			name:      "unknown signature version ignored when v1 is valid",
			body:      body,
			timestamp: timestamp,
			signature: "v2=" + strings.Repeat("0", sha256.Size*2) + "," + validSig,
			secret:    secret,
			now:       now,
			want:      true,
		},
		{
			name:      "wrong signature value",
			body:      body,
			timestamp: timestamp,
			signature: wrongSig,
			secret:    secret,
			now:       now,
			want:      false,
		},
		{
			name:      "empty signature",
			body:      body,
			timestamp: timestamp,
			signature: "",
			secret:    secret,
			now:       now,
			want:      false,
		},
		{
			name:      "legacy bare hex signature rejected",
			body:      body,
			timestamp: timestamp,
			signature: strings.TrimPrefix(validSig, "v1="),
			secret:    secret,
			now:       now,
			want:      false,
		},
		{
			name:      "signature over different body",
			body:      body,
			timestamp: timestamp,
			signature: computeTestSignature([]byte("different body"), timestamp, secret),
			secret:    secret,
			now:       now,
			want:      false,
		},
		{
			name:      "signature over different timestamp",
			body:      body,
			timestamp: timestamp,
			signature: computeTestSignature(body, strconv.FormatInt(now.Add(time.Second).UnixMilli(), 10), secret),
			secret:    secret,
			now:       now,
			want:      false,
		},
		{
			name:      "correct signature but wrong secret",
			body:      body,
			timestamp: timestamp,
			signature: validSig,
			secret:    "wrong_secret",
			now:       now,
			want:      false,
		},
		{
			name:      "timestamp at past tolerance boundary",
			body:      body,
			timestamp: strconv.FormatInt(now.Add(-revolutWebhookTimestampTolerance).UnixMilli(), 10),
			signature: computeTestSignature(body, strconv.FormatInt(now.Add(-revolutWebhookTimestampTolerance).UnixMilli(), 10), secret),
			secret:    secret,
			now:       now,
			want:      true,
		},
		{
			name:      "stale timestamp rejected",
			body:      body,
			timestamp: strconv.FormatInt(now.Add(-revolutWebhookTimestampTolerance-time.Millisecond).UnixMilli(), 10),
			signature: computeTestSignature(body, strconv.FormatInt(now.Add(-revolutWebhookTimestampTolerance-time.Millisecond).UnixMilli(), 10), secret),
			secret:    secret,
			now:       now,
			want:      false,
		},
		{
			name:      "future timestamp outside tolerance rejected",
			body:      body,
			timestamp: strconv.FormatInt(now.Add(revolutWebhookTimestampTolerance+time.Millisecond).UnixMilli(), 10),
			signature: computeTestSignature(body, strconv.FormatInt(now.Add(revolutWebhookTimestampTolerance+time.Millisecond).UnixMilli(), 10), secret),
			secret:    secret,
			now:       now,
			want:      false,
		},
		{
			name:      "non-numeric timestamp rejected",
			body:      body,
			timestamp: "not-a-timestamp",
			signature: validSig,
			secret:    secret,
			now:       now,
			want:      false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := verifyWebhookSignature(tc.body, tc.timestamp, tc.signature, tc.secret, tc.now)
			if got != tc.want {
				t.Errorf("verifyWebhookSignature() = %v, want %v", got, tc.want)
			}
		})
	}
}

// ── WebhookHandler tests ──────────────────────────────────────────────────

func TestWebhookHandler_MethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/payments/webhook", nil)
	rr := httptest.NewRecorder()
	WebhookHandler(rr, req)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405 for GET, got %d", rr.Code)
	}
}

func TestCreatePaymentHandler_MissingAuthorizationRejectedWhenTokenConfigured(t *testing.T) {
	t.Setenv("MCP_SERVICE_TOKEN", "test-token")
	t.Setenv("ENVIRONMENT_TYPE", "prod")

	req := httptest.NewRequest(http.MethodPost, "/api/payments/create", strings.NewReader(`{}`))
	rr := httptest.NewRecorder()

	CreatePaymentHandler(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("CreatePaymentHandler status = %d, want %d", rr.Code, http.StatusUnauthorized)
	}
}

func TestCreatePaymentHandler_AllowsExplicitDevBypassWhenTokenUnset(t *testing.T) {
	t.Setenv("MCP_SERVICE_TOKEN", "")
	t.Setenv("ENVIRONMENT_TYPE", "dev")

	req := httptest.NewRequest(http.MethodPost, "/api/payments/create", strings.NewReader(`not-json`))
	rr := httptest.NewRecorder()

	CreatePaymentHandler(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("CreatePaymentHandler status = %d, want %d after dev bypass", rr.Code, http.StatusBadRequest)
	}
}

func TestCreatePaymentHandler_RejectsOversizedAndMultipleJSONValues(t *testing.T) {
	t.Setenv("MCP_SERVICE_TOKEN", "test-token")
	t.Setenv("ENVIRONMENT_TYPE", "prod")

	testCases := []struct {
		name       string
		body       string
		wantStatus int
		wantError  string
	}{
		{
			name:       "oversized body",
			body:       `{"description":"` + strings.Repeat("x", int(maxCreatePaymentBodyBytes)) + `"}`,
			wantStatus: http.StatusRequestEntityTooLarge,
			wantError:  "payment_request_too_large",
		},
		{
			name:       "multiple JSON values",
			body:       `{} {}`,
			wantStatus: http.StatusBadRequest,
			wantError:  "payment_request_invalid",
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/api/payments/create", strings.NewReader(testCase.body))
			req.Header.Set("Authorization", "Bearer test-token")
			rr := httptest.NewRecorder()

			CreatePaymentHandler(rr, req)

			if rr.Code != testCase.wantStatus {
				t.Fatalf("CreatePaymentHandler status = %d, want %d", rr.Code, testCase.wantStatus)
			}
			if !strings.Contains(rr.Body.String(), testCase.wantError) {
				t.Fatalf("CreatePaymentHandler body = %q, want %q", rr.Body.String(), testCase.wantError)
			}
		})
	}
}

func TestCreatePaymentHandler_ValidBearerCanReachCreatePaymentPath(t *testing.T) {
	t.Setenv("MCP_SERVICE_TOKEN", "test-token")
	t.Setenv("ENVIRONMENT_TYPE", "prod")

	body := `{
		"app_name":"e2e",
		"external_order_id":"ord-123",
		"customer_email":"e2e@example.com",
		"amount_cents":100,
		"currency":"EUR",
		"description":"probe",
		"success_url":"https://example.com/success"
	}`

	req := httptest.NewRequest(http.MethodPost, "/api/payments/create", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer test-token")
	rr := httptest.NewRecorder()

	origClient := revolutClient
	revolutClient = nil
	t.Cleanup(func() { revolutClient = origClient })

	CreatePaymentHandler(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("CreatePaymentHandler status = %d, want %d", rr.Code, http.StatusInternalServerError)
	}
	if !strings.Contains(rr.Body.String(), "payment_create_failed") {
		t.Fatalf("CreatePaymentHandler body = %q, want generic payment error", rr.Body.String())
	}
	if strings.Contains(rr.Body.String(), "payment gateway not initialized") {
		t.Fatalf("CreatePaymentHandler leaked internal error: %q", rr.Body.String())
	}
}

func TestCreatePayment_PassesLocaleToRevolutOrder(t *testing.T) {
	db, _ := newWebhookTestDBWithQueryRow(0, []string{"id", "payment_token"}, []driver.Value{1, "payment-token-123"})
	defer db.Close()
	withDB(t, db)

	var gotMethod string
	var gotPath string
	var gotOrderReq CreateOrderRequest

	revolutServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path

		if err := json.NewDecoder(r.Body).Decode(&gotOrderReq); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"id":"rev_order_test_123","checkout_url":"https://checkout.example/order"}`)
	}))
	defer revolutServer.Close()

	origClient := revolutClient
	revolutClient = &RevolutClient{
		SecretKey:  "test-secret",
		BaseURL:    revolutServer.URL + "/api",
		APIVersion: "2024-09-01",
		HTTPClient: revolutServer.Client(),
	}
	t.Cleanup(func() { revolutClient = origClient })

	resp, err := CreatePayment(PaymentRequest{
		AppName:         "tietohaku",
		ExternalOrderID: "order-123",
		CustomerEmail:   "buyer@example.com",
		AmountCents:     490,
		Currency:        "EUR",
		Description:     "Tietohaku.fi checkout",
		SuccessURL:      "https://tietohaku.fi/?payment=verify",
		Locale:          "fi-FI",
	})
	if err != nil {
		t.Fatalf("CreatePayment returned error: %v", err)
	}

	if gotMethod != http.MethodPost {
		t.Fatalf("Revolut request method = %s, want %s", gotMethod, http.MethodPost)
	}
	if gotPath != "/api/orders" {
		t.Fatalf("Revolut request path = %s, want /api/orders", gotPath)
	}
	if gotOrderReq.Locale != "fi-FI" {
		t.Fatalf("CreateOrderRequest.Locale = %q, want %q", gotOrderReq.Locale, "fi-FI")
	}
	if resp.CheckoutURL != "https://checkout.example/order" {
		t.Fatalf("CreatePayment checkout_url = %q, want %q", resp.CheckoutURL, "https://checkout.example/order")
	}
}

func TestCreatePayment_DatabaseInsertFailureDoesNotReturnCheckoutURL(t *testing.T) {
	db, _ := newWebhookTestDB(0)
	if err := db.Close(); err != nil {
		t.Fatalf("close scripted database: %v", err)
	}
	withDB(t, db)

	revolutServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"id":"rev_order_unpersisted","checkout_url":"https://checkout.example/unpersisted"}`)
	}))
	defer revolutServer.Close()

	originalClient := revolutClient
	revolutClient = &RevolutClient{
		SecretKey:  "test-secret",
		BaseURL:    revolutServer.URL,
		APIVersion: "2024-09-01",
		HTTPClient: revolutServer.Client(),
	}
	t.Cleanup(func() { revolutClient = originalClient })

	response, err := CreatePayment(PaymentRequest{
		AppName:       "test-app",
		CustomerEmail: "buyer@example.com",
		AmountCents:   499,
		Currency:      "EUR",
	})
	if err == nil {
		t.Fatal("CreatePayment returned nil error after database insert failure")
	}
	if response != nil {
		t.Fatalf("CreatePayment response = %#v, want nil so no untracked checkout URL escapes", response)
	}
	if !strings.Contains(err.Error(), "failed to save payment") {
		t.Fatalf("CreatePayment error = %q, want persistence context", err)
	}
}

func TestWebhookHandler_MissingSecret_FailClosed(t *testing.T) {
	// REVOLUT_WEBHOOK_SECRET not set → handler must reject (fail-closed)
	t.Setenv("REVOLUT_WEBHOOK_SECRET", "")
	body := buildWebhookBody(t, "ORDER_COMPLETED")
	req := httptest.NewRequest(http.MethodPost, "/api/payments/webhook", strings.NewReader(string(body)))
	rr := httptest.NewRecorder()
	WebhookHandler(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Errorf("expected 500 (fail-closed) when secret missing, got %d", rr.Code)
	}
}

func TestWebhookHandler_InvalidSignature(t *testing.T) {
	t.Setenv("REVOLUT_WEBHOOK_SECRET", "test_secret")
	body := buildWebhookBody(t, "ORDER_COMPLETED")
	req := httptest.NewRequest(http.MethodPost, "/api/payments/webhook", strings.NewReader(string(body)))
	req.Header.Set("Revolut-Request-Timestamp", strconv.FormatInt(time.Now().UTC().UnixMilli(), 10))
	req.Header.Set("Revolut-Signature", "v1="+strings.Repeat("0", sha256.Size*2))
	rr := httptest.NewRecorder()
	WebhookHandler(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for invalid signature, got %d", rr.Code)
	}
}

func TestWebhookHandler_EmptySignature(t *testing.T) {
	t.Setenv("REVOLUT_WEBHOOK_SECRET", "test_secret")
	body := buildWebhookBody(t, "ORDER_COMPLETED")
	req := httptest.NewRequest(http.MethodPost, "/api/payments/webhook", strings.NewReader(string(body)))
	req.Header.Set("Revolut-Request-Timestamp", strconv.FormatInt(time.Now().UTC().UnixMilli(), 10))
	// Deliberately no Revolut-Signature header
	rr := httptest.NewRecorder()
	WebhookHandler(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for empty/missing signature, got %d", rr.Code)
	}
}

func TestWebhookHandler_MissingTimestamp(t *testing.T) {
	secret := "test_secret"
	t.Setenv("REVOLUT_WEBHOOK_SECRET", secret)
	body := buildWebhookBody(t, "ORDER_COMPLETED")
	req := httptest.NewRequest(http.MethodPost, "/api/payments/webhook", strings.NewReader(string(body)))
	req.Header.Set("Revolut-Signature", computeTestSignature(body, strconv.FormatInt(time.Now().UTC().UnixMilli(), 10), secret))
	rr := httptest.NewRecorder()

	WebhookHandler(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("WebhookHandler status = %d, want %d without timestamp", rr.Code, http.StatusUnauthorized)
	}
}

func TestWebhookHandler_RejectsStaleTimestamp(t *testing.T) {
	secret := "test_secret"
	t.Setenv("REVOLUT_WEBHOOK_SECRET", secret)
	body := buildWebhookBody(t, "ORDER_COMPLETED")
	timestamp := strconv.FormatInt(time.Now().UTC().Add(-revolutWebhookTimestampTolerance-time.Second).UnixMilli(), 10)
	req := httptest.NewRequest(http.MethodPost, "/api/payments/webhook", strings.NewReader(string(body)))
	req.Header.Set("Revolut-Request-Timestamp", timestamp)
	req.Header.Set("Revolut-Signature", computeTestSignature(body, timestamp, secret))
	rr := httptest.NewRecorder()

	WebhookHandler(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("WebhookHandler status = %d, want %d for stale delivery", rr.Code, http.StatusUnauthorized)
	}
}

func TestWebhookHandler_RejectsAmbiguousTimestampHeaders(t *testing.T) {
	secret := "test_secret"
	t.Setenv("REVOLUT_WEBHOOK_SECRET", secret)
	body := buildWebhookBody(t, "ORDER_COMPLETED")
	timestamp := strconv.FormatInt(time.Now().UTC().UnixMilli(), 10)
	req := httptest.NewRequest(http.MethodPost, "/api/payments/webhook", strings.NewReader(string(body)))
	req.Header.Add("Revolut-Request-Timestamp", timestamp)
	req.Header.Add("Revolut-Request-Timestamp", timestamp)
	req.Header.Set("Revolut-Signature", computeTestSignature(body, timestamp, secret))
	rr := httptest.NewRecorder()

	WebhookHandler(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("WebhookHandler status = %d, want %d for duplicate timestamps", rr.Code, http.StatusUnauthorized)
	}
}

func TestWebhookHandler_InvalidJSON(t *testing.T) {
	secret := "test_secret"
	t.Setenv("REVOLUT_WEBHOOK_SECRET", secret)
	body := []byte(`not valid json at all`)
	req := httptest.NewRequest(http.MethodPost, "/api/payments/webhook", strings.NewReader(string(body)))
	addValidWebhookHeaders(req, body, secret)
	rr := httptest.NewRecorder()
	WebhookHandler(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for invalid JSON, got %d", rr.Code)
	}
}

func TestWebhookHandler_RejectsOversizedBody(t *testing.T) {
	t.Setenv("REVOLUT_WEBHOOK_SECRET", "test_secret")
	body := strings.Repeat("x", int(maxPaymentWebhookBodyBytes)+1)
	req := httptest.NewRequest(http.MethodPost, "/api/payments/webhook", strings.NewReader(body))
	rr := httptest.NewRecorder()

	WebhookHandler(rr, req)

	if rr.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("WebhookHandler status = %d, want %d", rr.Code, http.StatusRequestEntityTooLarge)
	}
}
