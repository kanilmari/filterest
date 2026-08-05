// Verifies fixed-PIN boundaries and RFC-compatible TOTP behavior.

package auth

import (
	"testing"
	"time"
)

func TestFixedPINValidationAndHashing(t *testing.T) {
	for _, pin := range []string{"1234", "12345678"} {
		hash, err := hashFixedPIN(pin)
		if err != nil {
			t.Fatalf("hashFixedPIN(%q): %v", pin, err)
		}
		if hash == pin || !verifyFixedPIN(hash, pin) {
			t.Fatalf("fixed PIN %q was not stored and verified as a hash", pin)
		}
	}
	for _, pin := range []string{"123", "123456789", "12a4", ""} {
		if isValidFixedPIN(pin) {
			t.Fatalf("isValidFixedPIN(%q) = true, want false", pin)
		}
	}
}

func TestTOTPMatchesRFC6238SHA1Vector(t *testing.T) {
	// RFC 6238 SHA1 secret "12345678901234567890", at T=1, yields 94287082
	// with eight digits. The standard six-digit truncation is 287082.
	const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
	code, err := totpCodeForCounter(secret, 1)
	if err != nil {
		t.Fatalf("totpCodeForCounter: %v", err)
	}
	if code != "287082" {
		t.Fatalf("code = %q, want 287082", code)
	}
	if !verifyTOTPAt(secret, code, time.Unix(59, 0)) {
		t.Fatal("verifyTOTPAt rejected RFC-compatible code")
	}
}

func TestGeneratedTOTPSecretIsUsable(t *testing.T) {
	secret, err := generateTOTPSecret()
	if err != nil {
		t.Fatalf("generateTOTPSecret: %v", err)
	}
	now := time.Unix(1_700_000_000, 0)
	code, err := totpCodeForCounter(secret, uint64(now.Unix()/totpPeriod))
	if err != nil {
		t.Fatalf("totpCodeForCounter: %v", err)
	}
	if !verifyTOTPAt(secret, code, now) {
		t.Fatal("generated secret did not verify its current code")
	}
}
