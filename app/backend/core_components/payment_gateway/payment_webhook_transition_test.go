// payment_webhook_transition_test.go
// Forward-only webhook transition and callback retry regression tests.
package payment_gateway

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWebhookHandler_Idempotent_ZeroRowsAffected(t *testing.T) {
	// When the UPDATE touches 0 rows (payment already completed), callback
	// delivery must still be retried because the previous attempt may have failed.
	secret := "test_secret"
	t.Setenv("REVOLUT_WEBHOOK_SECRET", secret)

	db, drv := newWebhookTestDB(0) // 0 rows = payment already in completed state
	defer db.Close()
	withDB(t, db)
	callbackCalls := 0
	withPaymentCallbackDeliverer(t, func(orderID string) (bool, error) {
		callbackCalls++
		if orderID != "rev_order_test_123" {
			t.Fatalf("callback order ID = %q", orderID)
		}
		return true, nil
	})

	body := buildWebhookBody(t, "ORDER_COMPLETED")
	req := httptest.NewRequest(http.MethodPost, "/api/payments/webhook", strings.NewReader(string(body)))
	addValidWebhookHeaders(req, body, secret)
	rr := httptest.NewRecorder()
	WebhookHandler(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200 for idempotent webhook, got %d", rr.Code)
	}
	if len(drv.execQueries) != 1 {
		t.Errorf("expected exactly 1 UPDATE exec, got %d", len(drv.execQueries))
	}
	if callbackCalls != 1 {
		t.Fatalf("callback delivery calls = %d, want 1", callbackCalls)
	}
	// Verify the explicit forward-only transition predicate is present in the SQL.
	if !strings.Contains(drv.execQueries[0], "status = 'pending'") || !strings.Contains(drv.execQueries[0], "status = 'authorised'") {
		t.Errorf("UPDATE missing forward-only transition predicate:\n  %s", drv.execQueries[0])
	}
}

func TestWebhookHandler_UpdatesPayment_OneRowAffected(t *testing.T) {
	// When the UPDATE touches 1 row, payment is newly completed → return 200.
	secret := "test_secret"
	t.Setenv("REVOLUT_WEBHOOK_SECRET", secret)

	db, drv := newWebhookTestDB(1) // 1 row = fresh update
	defer db.Close()
	withDB(t, db)
	callbackCalls := 0
	withPaymentCallbackDeliverer(t, func(string) (bool, error) {
		callbackCalls++
		return true, nil
	})

	body := buildWebhookBody(t, "ORDER_COMPLETED")
	req := httptest.NewRequest(http.MethodPost, "/api/payments/webhook", strings.NewReader(string(body)))
	addValidWebhookHeaders(req, body, secret)
	rr := httptest.NewRecorder()
	WebhookHandler(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200 for successful webhook, got %d", rr.Code)
	}
	if len(drv.execQueries) < 1 {
		t.Errorf("expected at least 1 exec (UPDATE), got %d", len(drv.execQueries))
	}
	if callbackCalls != 1 {
		t.Fatalf("callback delivery calls = %d, want 1", callbackCalls)
	}
}
