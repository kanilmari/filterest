// fingerprint_hmac.go
// Provides HMAC signing and verification for browser fingerprint values.
// Bridges the raw fingerprint hash and the cookie/session stores that hold the signed value.
// Exists to prevent clients from forging valid fingerprint cookies by storing only the HMAC.
package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"os"
)

var fingerprintHMACKey []byte

func initFingerprintHMACKey() {
	key := os.Getenv("SESSION_KEY")
	if key == "" {
		key = "default-dev-key"
	}
	h := sha256.Sum256([]byte(key + ":fingerprint"))
	fingerprintHMACKey = h[:]
}

// HMACFingerprint returns the HMAC-SHA256 of the raw fingerprint value using
// a key derived from SESSION_KEY. The result is a hex-encoded string.
func HMACFingerprint(rawFingerprint string) string {
	if len(fingerprintHMACKey) == 0 {
		initFingerprintHMACKey()
	}
	mac := hmac.New(sha256.New, fingerprintHMACKey)
	mac.Write([]byte(rawFingerprint))
	return hex.EncodeToString(mac.Sum(nil))
}

// VerifyFingerprintHMAC checks whether the HMAC of rawFingerprint matches
// expectedHMAC using a constant-time comparison to prevent timing attacks.
func VerifyFingerprintHMAC(rawFingerprint, expectedHMAC string) bool {
	return hmac.Equal([]byte(HMACFingerprint(rawFingerprint)), []byte(expectedHMAC))
}
