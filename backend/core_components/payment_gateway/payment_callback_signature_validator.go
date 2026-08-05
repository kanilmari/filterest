// payment_callback_signature_validator.go
// Signs and verifies internal payment-completion callback request bodies.
// Bridges the shared payment gateway and app-specific fulfillment handlers through one HMAC contract.
// Exists to prevent public callers from forging payment fulfillment callbacks.

package payment_gateway

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"strings"
)

const (
	PaymentCallbackSignatureHeader = "X-Easelect-Payment-Signature"
	paymentCallbackSecretEnv       = "PAYMENT_CALLBACK_SECRET"
)

var (
	ErrPaymentCallbackSecretNotConfigured = errors.New("payment callback signing is not configured")
	ErrPaymentCallbackSignatureInvalid    = errors.New("payment callback signature is invalid")
)

// SignPaymentCallbackPayload creates the internal HMAC attached by the payment gateway.
// Between: serialized callback JSON and the app-specific callback HTTP request.
// Why: Authenticates the process that observed and persisted the provider payment state.
func SignPaymentCallbackPayload(body []byte) (string, error) {
	secret := strings.TrimSpace(os.Getenv(paymentCallbackSecretEnv))
	if secret == "" {
		return "", ErrPaymentCallbackSecretNotConfigured
	}

	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil)), nil
}

// VerifyPaymentCallbackSignature validates an app callback body against the configured secret.
// Between: public callback HTTP handlers and the trusted payment-gateway signer.
// Why: Makes payment fulfillment fail closed when authentication is absent or misconfigured.
func VerifyPaymentCallbackSignature(body []byte, signature string) error {
	expectedSignature, err := SignPaymentCallbackPayload(body)
	if err != nil {
		return err
	}

	if !hmac.Equal([]byte(strings.TrimSpace(signature)), []byte(expectedSignature)) {
		return ErrPaymentCallbackSignatureInvalid
	}
	return nil
}
