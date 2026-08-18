// fingerprint_hmac.go
// Provides HMAC signing and verification for browser fingerprint values.
// Bridges the raw fingerprint hash and the cookie/session stores that hold the signed value.
// Exists to prevent clients from forging valid fingerprint cookies by storing only the HMAC.
package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	e_sessions "easelect/backend/core_components/sessions"
	"encoding/hex"
	"os"
)

func currentFingerprintHMACKey() []byte {
	key := os.Getenv("SESSION_KEY")
	if key == "" {
		key = "default-dev-key"
	}
	return e_sessions.DeriveCurrentAuthKey(key, "fingerprint-hmac")
}

// HMACFingerprint returns the HMAC-SHA256 of the raw fingerprint value using
// an instance- or replica-pool-scoped key derived from SESSION_KEY. The result
// is a hex-encoded string.
func HMACFingerprint(rawFingerprint string) string {
	mac := hmac.New(sha256.New, currentFingerprintHMACKey())
	mac.Write([]byte(rawFingerprint))
	return hex.EncodeToString(mac.Sum(nil))
}

// VerifyFingerprintHMAC checks whether the HMAC of rawFingerprint matches
// expectedHMAC using a constant-time comparison to prevent timing attacks.
func VerifyFingerprintHMAC(rawFingerprint, expectedHMAC string) bool {
	return hmac.Equal([]byte(HMACFingerprint(rawFingerprint)), []byte(expectedHMAC))
}
