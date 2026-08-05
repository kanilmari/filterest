// payment_callback_signature_validator_test.go
// Verifies fail-closed signing and validation for internal payment callbacks.
// Bridges synthetic callback payloads and the shared HMAC contract used by fulfillment apps.
// Exists to prevent unsigned, tampered, or misconfigured callbacks from being accepted.

package payment_gateway

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPaymentCallbackSignatureRoundTrip(t *testing.T) {
	t.Setenv(paymentCallbackSecretEnv, "callback-test-secret")
	body := []byte(`{"revolut_order_id":"order-123","status":"completed"}`)

	signature, err := SignPaymentCallbackPayload(body)
	if err != nil {
		t.Fatalf("SignPaymentCallbackPayload returned error: %v", err)
	}
	if err := VerifyPaymentCallbackSignature(body, signature); err != nil {
		t.Fatalf("VerifyPaymentCallbackSignature returned error: %v", err)
	}
	if err := VerifyPaymentCallbackSignature([]byte(`{"status":"failed"}`), signature); !errors.Is(err, ErrPaymentCallbackSignatureInvalid) {
		t.Fatalf("tampered body error = %v, want ErrPaymentCallbackSignatureInvalid", err)
	}
}

func TestPaymentCallbackSignatureFailsClosedWithoutSecret(t *testing.T) {
	t.Setenv(paymentCallbackSecretEnv, "")

	if _, err := SignPaymentCallbackPayload([]byte(`{}`)); !errors.Is(err, ErrPaymentCallbackSecretNotConfigured) {
		t.Fatalf("SignPaymentCallbackPayload error = %v, want ErrPaymentCallbackSecretNotConfigured", err)
	}
	if err := VerifyPaymentCallbackSignature([]byte(`{}`), "anything"); !errors.Is(err, ErrPaymentCallbackSecretNotConfigured) {
		t.Fatalf("VerifyPaymentCallbackSignature error = %v, want ErrPaymentCallbackSecretNotConfigured", err)
	}
}

func TestTriggerCallbackSendsSignedExactBody(t *testing.T) {
	t.Setenv(paymentCallbackSecretEnv, "callback-test-secret")
	var receivedBody []byte
	var receivedSignature string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var err error
		receivedBody, err = io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("read callback body: %v", err)
		}
		receivedSignature = r.Header.Get(PaymentCallbackSignatureHeader)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	if err := triggerCallback(server.URL, "order-123", "completed"); err != nil {
		t.Fatalf("triggerCallback returned error: %v", err)
	}

	if err := VerifyPaymentCallbackSignature(receivedBody, receivedSignature); err != nil {
		t.Fatalf("callback signature verification failed: %v", err)
	}
	var payload map[string]string
	if err := json.Unmarshal(receivedBody, &payload); err != nil {
		t.Fatalf("unmarshal callback body: %v", err)
	}
	if payload["revolut_order_id"] != "order-123" || payload["status"] != "completed" {
		t.Fatalf("callback payload = %#v", payload)
	}
}

func TestTriggerCallbackDoesNotSendWithoutSigningSecret(t *testing.T) {
	t.Setenv(paymentCallbackSecretEnv, "")
	requestCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	if err := triggerCallback(server.URL, "order-123", "completed"); !errors.Is(err, ErrPaymentCallbackSecretNotConfigured) {
		t.Fatalf("triggerCallback error = %v, want missing-secret error", err)
	}

	if requestCount != 0 {
		t.Fatalf("callback request count = %d, want 0", requestCount)
	}
}

func TestTriggerCallbackRejectsNonSuccessResponse(t *testing.T) {
	t.Setenv(paymentCallbackSecretEnv, "callback-test-secret")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "retry later", http.StatusServiceUnavailable)
	}))
	defer server.Close()

	err := triggerCallback(server.URL, "order-123", "completed")
	if err == nil || !strings.Contains(err.Error(), "status 503") {
		t.Fatalf("triggerCallback error = %v, want status 503", err)
	}
}

func TestTriggerCallbackDoesNotForwardSignedBodyAcrossRedirect(t *testing.T) {
	t.Setenv(paymentCallbackSecretEnv, "callback-test-secret")
	redirectTargetCalls := 0
	redirectTarget := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		redirectTargetCalls++
		w.WriteHeader(http.StatusOK)
	}))
	defer redirectTarget.Close()

	redirectSource := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, redirectTarget.URL, http.StatusTemporaryRedirect)
	}))
	defer redirectSource.Close()

	err := triggerCallback(redirectSource.URL, "order-123", "completed")
	if err == nil || !strings.Contains(err.Error(), "status 307") {
		t.Fatalf("triggerCallback error = %v, want status 307", err)
	}
	if redirectTargetCalls != 0 {
		t.Fatalf("redirect target calls = %d, want 0", redirectTargetCalls)
	}
}
