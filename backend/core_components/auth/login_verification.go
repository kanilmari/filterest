// login_verification.go
// Resolves and verifies the user-owned sign-in factor selected during account setup.
// Bridges restricted credential storage with fixed-PIN, TOTP, email, and password-only login.
// Exists so environment type never changes the authentication method.

package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1" // #nosec G505 -- RFC 6238 compatibility requires HMAC-SHA1.
	"encoding/base32"
	"encoding/binary"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	backend "easelect/backend/core_components"

	"golang.org/x/crypto/bcrypt"
)

type loginVerificationMethod string

const (
	verificationNone     loginVerificationMethod = "none"
	verificationFixedPIN loginVerificationMethod = "fixed_pin"
	verificationTOTP     loginVerificationMethod = "totp"
	verificationEmail    loginVerificationMethod = "email"

	totpDigits     = 6
	totpPeriod     = int64(30)
	totpSecretSize = 20
)

var errUnsupportedVerificationMethod = errors.New("unsupported login verification method")

type loginVerificationRecord struct {
	Method     loginVerificationMethod
	PINHash    string
	TOTPSecret string
	Email      string
}

func parseLoginVerificationMethod(value string) (loginVerificationMethod, error) {
	method := loginVerificationMethod(strings.ToLower(strings.TrimSpace(value)))
	switch method {
	case verificationNone, verificationFixedPIN, verificationTOTP, verificationEmail:
		return method, nil
	default:
		return "", errUnsupportedVerificationMethod
	}
}

func loadLoginVerificationRecord(userID int) (loginVerificationRecord, error) {
	var record loginVerificationRecord
	var rawMethod string
	err := backend.DbConfidential.QueryRow(`
		SELECT login_verification_method,
		       COALESCE(fixed_pin_hash, ''),
		       COALESCE(totp_secret, ''),
		       email
		FROM restricted.users_restricted
		WHERE id = $1
	`, userID).Scan(&rawMethod, &record.PINHash, &record.TOTPSecret, &record.Email)
	if err != nil {
		return record, err
	}
	method, err := parseLoginVerificationMethod(rawMethod)
	if err != nil {
		return record, err
	}
	record.Method = method
	return record, nil
}

func hashFixedPIN(pin string) (string, error) {
	if !isValidFixedPIN(pin) {
		return "", errors.New("fixed PIN must contain 4-8 digits")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(pin), bcrypt.DefaultCost)
	return string(hash), err
}

func isValidFixedPIN(pin string) bool {
	if len(pin) < 4 || len(pin) > 8 {
		return false
	}
	for _, character := range pin {
		if character < '0' || character > '9' {
			return false
		}
	}
	return true
}

func verifyFixedPIN(hash, pin string) bool {
	if hash == "" || !isValidFixedPIN(pin) {
		return false
	}
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(pin)) == nil
}

func generateTOTPSecret() (string, error) {
	secret := make([]byte, totpSecretSize)
	if _, err := rand.Read(secret); err != nil {
		return "", err
	}
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(secret), nil
}

func normalizeTOTPSecret(secret string) string {
	return strings.ToUpper(strings.NewReplacer(" ", "", "-", "").Replace(strings.TrimSpace(secret)))
}

func totpCodeForCounter(secret string, counter uint64) (string, error) {
	decoded, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(normalizeTOTPSecret(secret))
	if err != nil || len(decoded) == 0 {
		return "", errors.New("invalid TOTP secret")
	}

	message := make([]byte, 8)
	binary.BigEndian.PutUint64(message, counter)
	mac := hmac.New(sha1.New, decoded) // #nosec G401 -- RFC 6238 compatibility requires HMAC-SHA1.
	_, _ = mac.Write(message)
	digest := mac.Sum(nil)
	offset := digest[len(digest)-1] & 0x0f
	value := (uint32(digest[offset])&0x7f)<<24 |
		uint32(digest[offset+1])<<16 |
		uint32(digest[offset+2])<<8 |
		uint32(digest[offset+3])
	code := value % 1_000_000
	return fmt.Sprintf("%0"+strconv.Itoa(totpDigits)+"d", code), nil
}

func verifyTOTPAt(secret, submitted string, now time.Time) bool {
	code := strings.TrimSpace(submitted)
	if len(code) != totpDigits || !isValidFixedPIN(code) {
		return false
	}
	currentCounter := now.Unix() / totpPeriod
	for offset := int64(-1); offset <= 1; offset++ {
		counter := currentCounter + offset
		if counter < 0 {
			continue
		}
		expected, err := totpCodeForCounter(secret, uint64(counter))
		if err == nil && hmac.Equal([]byte(expected), []byte(code)) {
			return true
		}
	}
	return false
}
