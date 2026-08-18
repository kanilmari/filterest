// fingerprint_hmac_test.go
// Verifies browser-fingerprint signing and constant-time validation behavior.
// Bridges the auth package to the instance-scoped session-key contract.
// Exists to prevent fingerprints from becoming portable across isolated instances.
package auth

import (
	e_sessions "easelect/backend/core_components/sessions"
	"testing"
)

func TestFingerprintHMACUsesCurrentInstanceKeyScope(t *testing.T) {
	t.Setenv("SESSION_KEY", "shared-raw-key-for-fingerprint-regression-test")
	t.Setenv("SESSION_SECRET_KEY", "shared-raw-encryption-key-for-test")
	t.Setenv("SESSION_COOKIE_MODE", "isolated")
	t.Setenv("SESSION_COOKIE_NAME", "")
	t.Setenv("DB_HOST", "127.0.0.1")
	t.Setenv("DB_PORT", "5433")
	t.Setenv("DB_NAME", "app_a")
	t.Setenv("INSTANCE_NAME", "instance-a")

	e_sessions.InitSessionStore()
	first := HMACFingerprint("browser-fingerprint")

	t.Setenv("DB_NAME", "app_b")
	t.Setenv("INSTANCE_NAME", "instance-b")
	e_sessions.InitSessionStore()
	second := HMACFingerprint("browser-fingerprint")

	if first == second {
		t.Fatal("isolated instances produced the same fingerprint HMAC")
	}
	if !VerifyFingerprintHMAC("browser-fingerprint", second) {
		t.Fatal("VerifyFingerprintHMAC rejected the current instance signature")
	}
	if VerifyFingerprintHMAC("browser-fingerprint", first) {
		t.Fatal("VerifyFingerprintHMAC accepted a sibling instance signature")
	}
}
