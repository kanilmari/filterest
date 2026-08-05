// otp.go
// Generates, stores, throttles, and atomically verifies one-time passwords.
// Bridges authentication handlers and restricted OTP tables through DbConfidential.
// Exists so applications select server-owned security profiles instead of supplying
// TTLs, attempt budgets, or delivery limits from request-controlled code.

package otp

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/logging"
	"fmt"
	"math"
	"strings"
	"time"
)

const (
	// Charset is the unambiguous 32-character set (no 0/O/1/I/l).
	Charset    = "abcdefghjkmnpqrstuvwxyz23456789"
	CodeLength = 9
)

// ProfileName identifies a server-owned OTP policy. Callers may select a
// profile, but they cannot override its expiry, attempt, or send limits.
type ProfileName string

const (
	ProfileLogin          ProfileName = "login"
	ProfilePasswordReset  ProfileName = "password_reset"
	ProfileEmailChange    ProfileName = "email_change"
	ProfilePasswordChange ProfileName = "password_change"
	ProfileRegFetchLogin  ProfileName = "regfetch_login"
)

// Profile is the shared OTP contract for current and future application
// adapters. CoreEnabled=false reserves a reviewed policy without allowing the
// core adapter to silently replace app-specific controls.
type Profile struct {
	Name               ProfileName
	Purpose            string
	TTL                time.Duration
	MaxVerifyAttempts  int
	UserSendLimit      int
	UserSendWindow     time.Duration
	MinimumSendSpacing time.Duration
	IPSendLimit        int
	IPSendWindow       time.Duration
	CoreEnabled        bool
}

var profiles = map[ProfileName]Profile{
	ProfileLogin: {
		Name: ProfileLogin, Purpose: "login", TTL: 5 * time.Minute,
		MaxVerifyAttempts: 5, UserSendLimit: 3, UserSendWindow: 5 * time.Minute, CoreEnabled: true,
	},
	ProfilePasswordReset: {
		Name: ProfilePasswordReset, Purpose: "password_reset", TTL: 5 * time.Minute,
		MaxVerifyAttempts: 5, UserSendLimit: 3, UserSendWindow: 5 * time.Minute, CoreEnabled: true,
	},
	ProfileEmailChange: {
		Name: ProfileEmailChange, Purpose: "email_change", TTL: 5 * time.Minute,
		MaxVerifyAttempts: 5, UserSendLimit: 3, UserSendWindow: 5 * time.Minute, CoreEnabled: true,
	},
	ProfilePasswordChange: {
		Name: ProfilePasswordChange, Purpose: "password_change", TTL: 5 * time.Minute,
		MaxVerifyAttempts: 5, UserSendLimit: 3, UserSendWindow: 5 * time.Minute, CoreEnabled: true,
	},
	ProfileRegFetchLogin: {
		Name: ProfileRegFetchLogin, Purpose: "regfetch_login", TTL: 5 * time.Minute,
		MaxVerifyAttempts: 5, UserSendLimit: 3, UserSendWindow: 15 * time.Minute,
		MinimumSendSpacing: 60 * time.Second, IPSendLimit: 10, IPSendWindow: 15 * time.Minute,
		CoreEnabled: false,
	},
}

// VerificationStatus is intentionally more precise than a bool inside the
// service. HTTP adapters may still collapse statuses to avoid enumeration.
type VerificationStatus string

const (
	VerificationVerified          VerificationStatus = "verified"
	VerificationInvalid           VerificationStatus = "invalid"
	VerificationExpired           VerificationStatus = "expired"
	VerificationAttemptsExhausted VerificationStatus = "attempts_exhausted"
	VerificationNotFound          VerificationStatus = "not_found"
)

// VerificationResult is produced by the same transaction that consumes or
// advances the challenge, so attempts_remaining is never a second racy read.
type VerificationResult struct {
	Status            VerificationStatus
	AttemptsRemaining int
}

func (result VerificationResult) IsVerified() bool {
	return result.Status == VerificationVerified
}

// SendReservation reports whether a persistent delivery slot was reserved.
type SendReservation struct {
	Allowed    bool
	RetryAfter time.Duration
}

// GetProfile returns a copy of a server-owned policy for adapter design and
// tests. Runtime callers should use the typed operations below.
func GetProfile(name ProfileName) (Profile, bool) {
	profile, ok := profiles[name]
	return profile, ok
}

func coreProfile(name ProfileName) (Profile, error) {
	profile, ok := GetProfile(name)
	if !ok {
		return Profile{}, fmt.Errorf("unknown OTP profile %q", name)
	}
	if !profile.CoreEnabled {
		return Profile{}, fmt.Errorf("OTP profile %q requires its application adapter", name)
	}
	return profile, nil
}

// GenerateCode creates a cryptographically random 9-character OTP code.
func GenerateCode() (string, error) {
	b := make([]byte, CodeLength)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("crypto/rand failed: %w", err)
	}
	code := make([]byte, CodeLength)
	for i := range b {
		code[i] = Charset[b[i]%byte(len(Charset))]
	}
	return string(code), nil
}

// FormatCode adds spaces for readability: "abcdefghj" -> "abc def ghj".
func FormatCode(code string) string {
	if len(code) != CodeLength {
		return code
	}
	return code[0:3] + " " + code[3:6] + " " + code[6:9]
}

// HashCode returns the SHA-256 hex digest of a normalized code.
func HashCode(code string) string {
	h := sha256.Sum256([]byte(strings.ToLower(strings.ReplaceAll(code, " ", ""))))
	return fmt.Sprintf("%x", h)
}

func normalizeTargetEmail(email string) string {
	return strings.TrimSpace(strings.ToLower(email))
}

// CreateOTP atomically creates or replaces the only active challenge for a
// user and profile. The database clock owns expiry calculation.
func CreateOTP(userID int, profileName ProfileName, email string) (string, error) {
	profile, err := coreProfile(profileName)
	if err != nil {
		return "", err
	}
	if backend.DbConfidential == nil {
		return "", fmt.Errorf("confidential database is not initialized")
	}

	code, err := GenerateCode()
	if err != nil {
		return "", err
	}
	target := normalizeTargetEmail(email)
	if target == "" {
		return "", fmt.Errorf("OTP target email is required")
	}

	_, err = backend.DbConfidential.Exec(`
		INSERT INTO restricted.verification_codes
			(user_id, purpose, code_hash, target_email, attempts, max_attempts, created_at, expires_at)
		VALUES ($1, $2, $3, $4, 0, $5, NOW(), NOW() + ($6 * INTERVAL '1 second'))
		ON CONFLICT (user_id, purpose) DO UPDATE
		SET code_hash = EXCLUDED.code_hash,
			target_email = EXCLUDED.target_email,
			attempts = 0,
			max_attempts = EXCLUDED.max_attempts,
			created_at = NOW(),
			expires_at = EXCLUDED.expires_at
	`, userID, profile.Purpose, HashCode(code), target, profile.MaxVerifyAttempts, int(profile.TTL/time.Second))
	if err != nil {
		return "", fmt.Errorf("failed to create OTP: %w", err)
	}

	logging.Infof("[otp] created OTP for user %d, profile=%s", userID, profile.Name)
	return code, nil
}

// RevokeOTP removes only the challenge created for the supplied plaintext
// code. A delayed delivery failure therefore cannot delete a newer resend.
func RevokeOTP(userID int, profileName ProfileName, code string) error {
	profile, err := coreProfile(profileName)
	if err != nil {
		return err
	}
	result, err := backend.DbConfidential.Exec(`
		DELETE FROM restricted.verification_codes
		WHERE user_id = $1 AND purpose = $2 AND code_hash = $3
	`, userID, profile.Purpose, HashCode(code))
	if err != nil {
		return fmt.Errorf("failed to revoke OTP: %w", err)
	}
	if _, err := result.RowsAffected(); err != nil {
		return fmt.Errorf("failed to confirm OTP revocation: %w", err)
	}
	return nil
}

// VerifyOTP atomically checks and consumes a challenge.
func VerifyOTP(userID int, profileName ProfileName, code string) (VerificationResult, error) {
	return verifyOTPWithTarget(userID, profileName, code, "")
}

// VerifyOTPForTarget also binds verification to the stored target email.
func VerifyOTPForTarget(userID int, profileName ProfileName, targetEmail, code string) (VerificationResult, error) {
	return verifyOTPWithTarget(userID, profileName, code, targetEmail)
}

func verifyOTPWithTarget(userID int, profileName ProfileName, code, targetEmail string) (VerificationResult, error) {
	profile, err := coreProfile(profileName)
	if err != nil {
		return VerificationResult{}, err
	}
	if backend.DbConfidential == nil {
		return VerificationResult{}, fmt.Errorf("confidential database is not initialized")
	}

	tx, err := backend.DbConfidential.BeginTx(context.Background(), nil)
	if err != nil {
		return VerificationResult{}, fmt.Errorf("begin OTP verification: %w", err)
	}
	defer tx.Rollback()

	var id int64
	var storedHash, storedTarget string
	var attempts, maxAttempts int
	var expired bool
	err = tx.QueryRow(`
		SELECT id, code_hash, target_email, attempts, max_attempts, expires_at <= NOW()
		FROM restricted.verification_codes
		WHERE user_id = $1 AND purpose = $2
		FOR UPDATE
	`, userID, profile.Purpose).Scan(&id, &storedHash, &storedTarget, &attempts, &maxAttempts, &expired)
	if err == sql.ErrNoRows {
		return VerificationResult{Status: VerificationNotFound}, nil
	}
	if err != nil {
		return VerificationResult{}, fmt.Errorf("load OTP challenge: %w", err)
	}

	if expired || attempts >= maxAttempts {
		status := VerificationExpired
		if !expired {
			status = VerificationAttemptsExhausted
		}
		if err := deleteOneChallenge(tx, id); err != nil {
			return VerificationResult{}, err
		}
		if err := tx.Commit(); err != nil {
			return VerificationResult{}, fmt.Errorf("commit expired OTP consumption: %w", err)
		}
		return VerificationResult{Status: status}, nil
	}

	targetMatches := true
	if normalizedTarget := normalizeTargetEmail(targetEmail); normalizedTarget != "" {
		targetMatches = subtle.ConstantTimeCompare([]byte(normalizeTargetEmail(storedTarget)), []byte(normalizedTarget)) == 1
	}
	hashMatches := subtle.ConstantTimeCompare([]byte(storedHash), []byte(HashCode(code))) == 1

	if targetMatches && hashMatches {
		if err := deleteOneChallenge(tx, id); err != nil {
			return VerificationResult{}, err
		}
		if err := tx.Commit(); err != nil {
			return VerificationResult{}, fmt.Errorf("commit OTP consumption: %w", err)
		}
		logging.Infof("[otp] verified OTP for user %d, profile=%s", userID, profile.Name)
		return VerificationResult{Status: VerificationVerified}, nil
	}

	nextAttempts := attempts + 1
	remaining := maxAttempts - nextAttempts
	status := VerificationInvalid
	if nextAttempts >= maxAttempts {
		status = VerificationAttemptsExhausted
		remaining = 0
		if err := deleteOneChallenge(tx, id); err != nil {
			return VerificationResult{}, err
		}
	} else {
		result, err := tx.Exec(`
			UPDATE restricted.verification_codes
			SET attempts = $1
			WHERE id = $2
		`, nextAttempts, id)
		if err != nil {
			return VerificationResult{}, fmt.Errorf("advance OTP attempts: %w", err)
		}
		if err := requireOneRow(result, "advance OTP attempts"); err != nil {
			return VerificationResult{}, err
		}
	}

	if err := tx.Commit(); err != nil {
		return VerificationResult{}, fmt.Errorf("commit failed OTP attempt: %w", err)
	}
	return VerificationResult{Status: status, AttemptsRemaining: remaining}, nil
}

func deleteOneChallenge(tx *sql.Tx, id int64) error {
	result, err := tx.Exec(`DELETE FROM restricted.verification_codes WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("consume OTP challenge: %w", err)
	}
	return requireOneRow(result, "consume OTP challenge")
}

func requireOneRow(result sql.Result, operation string) error {
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("%s: confirm affected rows: %w", operation, err)
	}
	if rows != 1 {
		return fmt.Errorf("%s: affected %d rows, expected 1", operation, rows)
	}
	return nil
}

// ReserveSend atomically reserves a persistent user+profile delivery slot.
// The transaction-scoped advisory lock serializes replicas for one bucket.
func ReserveSend(userID int, profileName ProfileName) (SendReservation, error) {
	profile, err := coreProfile(profileName)
	if err != nil {
		return SendReservation{}, err
	}
	if backend.DbConfidential == nil {
		return SendReservation{}, fmt.Errorf("confidential database is not initialized")
	}
	if profile.UserSendLimit <= 0 || profile.UserSendWindow <= 0 {
		return SendReservation{Allowed: true}, nil
	}

	tx, err := backend.DbConfidential.BeginTx(context.Background(), nil)
	if err != nil {
		return SendReservation{}, fmt.Errorf("begin OTP send reservation: %w", err)
	}
	defer tx.Rollback()

	bucket := fmt.Sprintf("otp-send:%d:%s", userID, profile.Purpose)
	if _, err := tx.Exec(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, bucket); err != nil {
		return SendReservation{}, fmt.Errorf("lock OTP send bucket: %w", err)
	}
	windowSeconds := int(profile.UserSendWindow / time.Second)
	if _, err := tx.Exec(`
		DELETE FROM restricted.otp_send_events
		WHERE user_id = $1 AND purpose = $2
		  AND requested_at < NOW() - ($3 * INTERVAL '1 second')
	`, userID, profile.Purpose, windowSeconds); err != nil {
		return SendReservation{}, fmt.Errorf("prune OTP send bucket: %w", err)
	}

	var count int
	var retrySeconds float64
	err = tx.QueryRow(`
		SELECT COUNT(*),
		       COALESCE(GREATEST(EXTRACT(EPOCH FROM
		           (MIN(requested_at) + ($3 * INTERVAL '1 second') - NOW())), 0), 0)
		FROM restricted.otp_send_events
		WHERE user_id = $1 AND purpose = $2
		  AND requested_at >= NOW() - ($3 * INTERVAL '1 second')
	`, userID, profile.Purpose, windowSeconds).Scan(&count, &retrySeconds)
	if err != nil {
		return SendReservation{}, fmt.Errorf("count OTP send bucket: %w", err)
	}

	if count >= profile.UserSendLimit {
		if err := tx.Commit(); err != nil {
			return SendReservation{}, fmt.Errorf("commit blocked OTP reservation: %w", err)
		}
		return SendReservation{Allowed: false, RetryAfter: time.Duration(math.Ceil(retrySeconds)) * time.Second}, nil
	}

	if _, err := tx.Exec(`
		INSERT INTO restricted.otp_send_events (user_id, purpose, requested_at)
		VALUES ($1, $2, NOW())
	`, userID, profile.Purpose); err != nil {
		return SendReservation{}, fmt.Errorf("reserve OTP send slot: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return SendReservation{}, fmt.Errorf("commit OTP send reservation: %w", err)
	}
	return SendReservation{Allowed: true}, nil
}

// CleanExpired removes all expired verification codes.
func CleanExpired() error {
	result, err := backend.DbConfidential.Exec(
		`DELETE FROM restricted.verification_codes WHERE expires_at < NOW()`,
	)
	if err != nil {
		return fmt.Errorf("failed to clean expired OTPs: %w", err)
	}
	if rows, _ := result.RowsAffected(); rows > 0 {
		logging.Infof("[otp] cleaned %d expired verification codes", rows)
	}
	return nil
}
