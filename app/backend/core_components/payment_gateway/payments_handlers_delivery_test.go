package payment_gateway

import (
	"crypto/sha256"
	"errors"
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
