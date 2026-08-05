package payment_gateway

import (
	"crypto/sha256"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestWebhookHandler_AcceptsValidSignatureDuringSecretRotation(t *testing.T) {
	secret := "test_secret"
	t.Setenv("REVOLUT_WEBHOOK_SECRET", secret)
	db, _ := newWebhookTestDB(1)
	defer db.Close()
	withDB(t, db)
	withPaymentCallbackDeliverer(t, func(string) (bool, error) { return true, nil })

	body := buildWebhookBody(t, "ORDER_COMPLETED")
	timestamp := strconv.FormatInt(time.Now().UTC().UnixMilli(), 10)
	req := httptest.NewRequest(http.MethodPost, "/api/payments/webhook", strings.NewReader(string(body)))
	req.Header.Set("Revolut-Request-Timestamp", timestamp)
	req.Header.Add("Revolut-Signature", "v1="+strings.Repeat("0", sha256.Size*2))
	req.Header.Add("Revolut-Signature", computeTestSignature(body, timestamp, secret))
	rr := httptest.NewRecorder()

	WebhookHandler(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("WebhookHandler status = %d, want %d with one valid rotation signature", rr.Code, http.StatusOK)
	}
}

func TestWebhookHandler_RejectsMissingOrderID(t *testing.T) {
	secret := "test_secret"
	t.Setenv("REVOLUT_WEBHOOK_SECRET", secret)
	body := []byte(`{"event":"ORDER_COMPLETED","order_id":""}`)
	req := httptest.NewRequest(http.MethodPost, "/api/payments/webhook", strings.NewReader(string(body)))
	addValidWebhookHeaders(req, body, secret)
	rr := httptest.NewRecorder()

	WebhookHandler(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("WebhookHandler status = %d, want %d for empty order_id", rr.Code, http.StatusBadRequest)
	}
}

func TestWebhookHandler_IgnoresUnsupportedSignedEvent(t *testing.T) {
	secret := "test_secret"
	t.Setenv("REVOLUT_WEBHOOK_SECRET", secret)
	body := buildWebhookBody(t, "ORDER_PAYMENT_FAILED")
	req := httptest.NewRequest(http.MethodPost, "/api/payments/webhook", strings.NewReader(string(body)))
	addValidWebhookHeaders(req, body, secret)
	rr := httptest.NewRecorder()

	WebhookHandler(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("WebhookHandler status = %d, want %d for authenticated unsupported event", rr.Code, http.StatusOK)
	}
}

func TestWebhookHandler_PropagatesStatusUpdateFailure(t *testing.T) {
	secret := "test_secret"
	t.Setenv("REVOLUT_WEBHOOK_SECRET", secret)
	db, drv := newWebhookTestDB(0)
	drv.execErr = errors.New("database unavailable")
	defer db.Close()
	withDB(t, db)
	withPaymentCallbackDeliverer(t, func(string) (bool, error) {
		t.Fatal("callback delivery must not run after status update failure")
		return false, nil
	})

	body := buildWebhookBody(t, "ORDER_COMPLETED")
	req := httptest.NewRequest(http.MethodPost, "/api/payments/webhook", strings.NewReader(string(body)))
	addValidWebhookHeaders(req, body, secret)
	rr := httptest.NewRecorder()
	WebhookHandler(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("WebhookHandler status = %d, want %d", rr.Code, http.StatusInternalServerError)
	}
}

func TestWebhookHandler_PropagatesRowsAffectedFailure(t *testing.T) {
	secret := "test_secret"
	t.Setenv("REVOLUT_WEBHOOK_SECRET", secret)
	db, drv := newWebhookTestDB(1)
	drv.execRowsError = errors.New("rows affected unavailable")
	defer db.Close()
	withDB(t, db)
	withPaymentCallbackDeliverer(t, func(string) (bool, error) {
		t.Fatal("callback delivery must not run without a verified transition result")
		return false, nil
	})

	body := buildWebhookBody(t, "ORDER_COMPLETED")
	req := httptest.NewRequest(http.MethodPost, "/api/payments/webhook", strings.NewReader(string(body)))
	addValidWebhookHeaders(req, body, secret)
	rr := httptest.NewRecorder()
	WebhookHandler(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("WebhookHandler status = %d, want 500", rr.Code)
	}
}

func TestPaymentStatusTransitionPredicateIsForwardOnly(t *testing.T) {
	for _, required := range []string{
		"status = 'pending'",
		"status = 'authorised'",
		"$1 IN ('authorised', 'completed', 'failed', 'cancelled')",
		"$1 IN ('completed', 'failed', 'cancelled')",
	} {
		if !strings.Contains(paymentStatusTransitionPredicateSQL, required) {
			t.Fatalf("transition predicate missing %q: %s", required, paymentStatusTransitionPredicateSQL)
		}
	}
	for _, terminal := range []string{"status = 'completed'", "status = 'failed'", "status = 'cancelled'"} {
		if strings.Contains(paymentStatusTransitionPredicateSQL, terminal) {
			t.Fatalf("transition predicate must not transition terminal state %q", terminal)
		}
	}
}

func TestWebhookHandler_CallbackFailureRequestsProviderRetry(t *testing.T) {
	secret := "test_secret"
	t.Setenv("REVOLUT_WEBHOOK_SECRET", secret)
	db, _ := newWebhookTestDB(0)
	defer db.Close()
	withDB(t, db)
	withPaymentCallbackDeliverer(t, func(string) (bool, error) {
		return false, errors.New("app returned 503")
	})

	body := buildWebhookBody(t, "ORDER_COMPLETED")
	req := httptest.NewRequest(http.MethodPost, "/api/payments/webhook", strings.NewReader(string(body)))
	addValidWebhookHeaders(req, body, secret)
	rr := httptest.NewRecorder()
	WebhookHandler(rr, req)

	if rr.Code != http.StatusBadGateway {
		t.Fatalf("WebhookHandler status = %d, want %d", rr.Code, http.StatusBadGateway)
	}
}

func TestWebhookHandler_UnknownCompletedOrderRequestsProviderRetry(t *testing.T) {
	secret := "test_secret"
	t.Setenv("REVOLUT_WEBHOOK_SECRET", secret)
	db, _ := newWebhookTestDB(0)
	defer db.Close()
	withDB(t, db)

	body := buildWebhookBody(t, "ORDER_COMPLETED")
	req := httptest.NewRequest(http.MethodPost, "/api/payments/webhook", strings.NewReader(string(body)))
	addValidWebhookHeaders(req, body, secret)
	rr := httptest.NewRecorder()
	WebhookHandler(rr, req)

	if rr.Code != http.StatusBadGateway {
		t.Fatalf("WebhookHandler status = %d, want %d for unknown completed order", rr.Code, http.StatusBadGateway)
	}
}

func TestGetPaymentStatusHandler_RedeliversAlreadyCompletedPayment(t *testing.T) {
	createdAt := time.Now().UTC()
	db, _ := newWebhookTestDBWithQueryRow(
		0,
		[]string{"id", "payment_token", "status", "amount_cents", "currency", "paid_at", "revolut_order_id", "created_at"},
		[]driver.Value{1, "payment-token-123", "completed", 490, "EUR", createdAt, "rev-order-123", createdAt},
	)
	defer db.Close()
	withDB(t, db)
	callbackCalls := 0
	withPaymentCallbackDeliverer(t, func(orderID string) (bool, error) {
		callbackCalls++
		if orderID != "rev-order-123" {
			t.Fatalf("callback order ID = %q", orderID)
		}
		return true, nil
	})

	req := httptest.NewRequest(http.MethodGet, "/api/payments/payment-token-123/status", nil)
	rr := httptest.NewRecorder()
	GetPaymentStatusHandler(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("GetPaymentStatusHandler status = %d, want 200", rr.Code)
	}
	if callbackCalls != 1 {
		t.Fatalf("callback delivery calls = %d, want 1", callbackCalls)
	}
}

func TestGetPaymentStatusHandler_AuthorisedIsNotCompleted(t *testing.T) {
	createdAt := time.Now().UTC()
	db, _ := newWebhookTestDBWithQueryRow(
		1,
		[]string{"id", "payment_token", "status", "amount_cents", "currency", "paid_at", "revolut_order_id", "created_at"},
		[]driver.Value{1, "payment-token-123", "pending", 490, "EUR", nil, "rev-order-123", createdAt},
	)
	defer db.Close()
	withDB(t, db)
	withPaymentCallbackDeliverer(t, func(string) (bool, error) {
		t.Fatal("authorised payment must not trigger fulfillment callback")
		return false, nil
	})

	revolutServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"id":"rev-order-123","state":"authorised"}`)
	}))
	defer revolutServer.Close()
	originalClient := revolutClient
	revolutClient = &RevolutClient{SecretKey: "test-secret", BaseURL: revolutServer.URL, APIVersion: "2024-09-01", HTTPClient: revolutServer.Client()}
	t.Cleanup(func() { revolutClient = originalClient })

	req := httptest.NewRequest(http.MethodGet, "/api/payments/payment-token-123/status", nil)
	rr := httptest.NewRecorder()
	GetPaymentStatusHandler(rr, req)

	var response PaymentStatusResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if rr.Code != http.StatusOK || response.Status != "authorised" || response.PaidAt != nil {
		t.Fatalf("response = (%d, %#v), want authorised without paid_at", rr.Code, response)
	}
}

func TestGetPaymentStatusHandler_AuthorisedAdvancesToCompleted(t *testing.T) {
	createdAt := time.Now().UTC()
	db, _ := newWebhookTestDBWithQueryRow(
		1,
		[]string{"id", "payment_token", "status", "amount_cents", "currency", "paid_at", "revolut_order_id", "created_at"},
		[]driver.Value{1, "payment-token-123", "authorised", 490, "EUR", nil, "rev-order-123", createdAt},
	)
	defer db.Close()
	withDB(t, db)
	callbackCalls := 0
	withPaymentCallbackDeliverer(t, func(orderID string) (bool, error) {
		callbackCalls++
		return true, nil
	})

	revolutServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"id":"rev-order-123","state":"completed"}`)
	}))
	defer revolutServer.Close()
	originalClient := revolutClient
	revolutClient = &RevolutClient{SecretKey: "test-secret", BaseURL: revolutServer.URL, APIVersion: "2024-09-01", HTTPClient: revolutServer.Client()}
	t.Cleanup(func() { revolutClient = originalClient })

	req := httptest.NewRequest(http.MethodGet, "/api/payments/payment-token-123/status", nil)
	rr := httptest.NewRecorder()
	GetPaymentStatusHandler(rr, req)

	var response PaymentStatusResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if rr.Code != http.StatusOK || response.Status != "completed" || response.PaidAt == nil || callbackCalls != 1 {
		t.Fatalf("response/callbacks = (%d, %#v, %d), want completed with paid_at and one callback", rr.Code, response, callbackCalls)
	}
}

func TestGetPaymentStatusHandler_DoesNotReportOrDeliverUnpersistedCompletion(t *testing.T) {
	createdAt := time.Now().UTC()
	db, drv := newWebhookTestDBWithQueryRow(
		0,
		[]string{"id", "payment_token", "status", "amount_cents", "currency", "paid_at", "revolut_order_id", "created_at"},
		[]driver.Value{1, "payment-token-123", "pending", 490, "EUR", nil, "rev-order-123", createdAt},
	)
	drv.execErr = errors.New("status update failed")
	defer db.Close()
	withDB(t, db)
	withPaymentCallbackDeliverer(t, func(string) (bool, error) {
		t.Fatal("callback delivery must not run before completed status is persisted")
		return false, nil
	})

	revolutServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"id":"rev-order-123","state":"completed"}`)
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

	req := httptest.NewRequest(http.MethodGet, "/api/payments/payment-token-123/status", nil)
	rr := httptest.NewRecorder()
	GetPaymentStatusHandler(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("GetPaymentStatusHandler status = %d, want 200", rr.Code)
	}
	var response PaymentStatusResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode status response: %v", err)
	}
	if response.Status != "pending" {
		t.Fatalf("payment status = %q, want pending after failed persistence", response.Status)
	}
}

func TestGetPaymentStatusHandler_DoesNotCompleteWhenRowsAffectedFails(t *testing.T) {
	createdAt := time.Now().UTC()
	db, drv := newWebhookTestDBWithQueryRow(
		1,
		[]string{"id", "payment_token", "status", "amount_cents", "currency", "paid_at", "revolut_order_id", "created_at"},
		[]driver.Value{1, "payment-token-123", "pending", 490, "EUR", nil, "rev-order-123", createdAt},
	)
	drv.execRowsError = errors.New("rows affected unavailable")
	defer db.Close()
	withDB(t, db)
	withPaymentCallbackDeliverer(t, func(string) (bool, error) {
		t.Fatal("callback delivery must not run without a verified live transition")
		return false, nil
	})

	revolutServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"id":"rev-order-123","state":"completed"}`)
	}))
	defer revolutServer.Close()
	originalClient := revolutClient
	revolutClient = &RevolutClient{SecretKey: "test-secret", BaseURL: revolutServer.URL, APIVersion: "2024-09-01", HTTPClient: revolutServer.Client()}
	t.Cleanup(func() { revolutClient = originalClient })

	req := httptest.NewRequest(http.MethodGet, "/api/payments/payment-token-123/status", nil)
	rr := httptest.NewRecorder()
	GetPaymentStatusHandler(rr, req)

	var response PaymentStatusResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Status != "pending" || response.PaidAt != nil {
		t.Fatalf("response = %#v, want pending without paid_at", response)
	}
}

func TestWebhookHandler_NonCompletedStatus(t *testing.T) {
	// Supported non-completed order events should also update the DB.
	secret := "test_secret"
	t.Setenv("REVOLUT_WEBHOOK_SECRET", secret)

	for _, event := range []string{"ORDER_AUTHORISED", "ORDER_FAILED", "ORDER_CANCELLED"} {
		t.Run(event, func(t *testing.T) {
			db, drv := newWebhookTestDB(1)
			defer db.Close()
			withDB(t, db)

			body := buildWebhookBody(t, event)
			req := httptest.NewRequest(http.MethodPost, "/api/payments/webhook", strings.NewReader(string(body)))
			addValidWebhookHeaders(req, body, secret)
			rr := httptest.NewRecorder()
			WebhookHandler(rr, req)

			if rr.Code != http.StatusOK {
				t.Errorf("event=%s: expected 200, got %d", event, rr.Code)
			}
			if len(drv.execQueries) < 1 {
				t.Errorf("event=%s: expected at least 1 exec, got 0", event)
			}
		})
	}
}

func TestPaymentStatusForRevolutEvent(t *testing.T) {
	tests := map[string]string{
		"ORDER_COMPLETED":  "completed",
		"ORDER_AUTHORISED": "authorised",
		"ORDER_CANCELLED":  "cancelled",
		"ORDER_FAILED":     "failed",
	}
	for event, wantStatus := range tests {
		gotStatus, ok := paymentStatusForRevolutEvent(event)
		if !ok || gotStatus != wantStatus {
			t.Errorf("paymentStatusForRevolutEvent(%q) = (%q, %v), want (%q, true)", event, gotStatus, ok, wantStatus)
		}
	}
	if status, ok := paymentStatusForRevolutEvent("ORDER_PAYMENT_FAILED"); ok || status != "" {
		t.Fatalf("unsupported payment-level event mapped to (%q, %v)", status, ok)
	}
}
