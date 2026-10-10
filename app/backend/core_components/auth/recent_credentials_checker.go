// recent_credentials_checker.go
// Rechecks password and the account's configured factor for sensitive actions.
// Connects application-update proof issuance to the existing PIN/TOTP/email services.
// Never renews a session or treats an ordinary cookie refresh as fresh authentication.
package auth

import (
	"context"
	"easelect/backend/core_components/email"
	"easelect/backend/core_components/otp"
	"errors"
	"time"
)

var ErrRecentCredentials = errors.New("recent_credentials_refused")
var ErrRecentCredentialsRateLimited = errors.New("recent_credentials_rate_limited")

// CheckRecentCredentials returns factor-required only after the password is verified.
// Callers must rate-limit every attempt before invoking the expensive hash check.
func CheckRecentCredentials(ctx context.Context, userID int, generation int64, password, factor string) (bool, string, error) {
	if err := ctx.Err(); err != nil {
		return false, "", err
	}
	record, err := loadLoginVerificationRecord(userID)
	if err != nil {
		return false, "", err
	}
	if record.APIOnly || record.AuthenticationGeneration != generation || password == "" || len(password) > 1024 || compareLoginPassword([]byte(record.PasswordHash), []byte(password)) != nil {
		return false, "", ErrRecentCredentials
	}
	return checkRecentFactor(record, userID, factor, time.Now())
}

func checkRecentFactor(record loginVerificationRecord, userID int, factor string, now time.Time) (bool, string, error) {
	method := string(record.Method)
	switch record.Method {
	case verificationNone:
		return false, method, nil
	case verificationFixedPIN, verificationTOTP:
		// Missing or malformed configured secrets can never fall back to password-only.
		if record.Method == verificationFixedPIN && record.PINHash == "" || record.Method == verificationTOTP && record.TOTPSecret == "" {
			return false, method, ErrRecentCredentials
		}
		if factor == "" {
			return true, method, nil
		}
		verified := verifyFixedPIN(record.PINHash, factor)
		if record.Method == verificationTOTP {
			verified = verifyTOTPAt(record.TOTPSecret, factor, now)
		}
		if !verified {
			return false, method, ErrRecentCredentials
		}
		return false, method, nil
	case verificationEmail:
		if record.Email == "" {
			return false, method, ErrRecentCredentials
		}
		if factor != "" {
			result, err := otp.VerifyOTP(userID, otp.ProfileApplicationUpdate, factor)
			if err != nil {
				return false, method, err
			}
			if !result.IsVerified() {
				return false, method, ErrRecentCredentials
			}
			return false, method, nil
		}
		reservation, err := otp.ReserveSend(userID, otp.ProfileApplicationUpdate)
		if err != nil {
			return false, method, err
		}
		if !reservation.Allowed {
			return false, method, ErrRecentCredentialsRateLimited
		}
		if err = otp.CreateOTPWithDelivery(userID, otp.ProfileApplicationUpdate, record.Email, func(code string) error {
			return email.SendApplicationUpdateOTPEmail(record.Email, otp.FormatCode(code))
		}); err != nil {
			// Fixed refusal text also keeps database/provider diagnostics out of callers.
			return false, method, ErrRecentCredentials
		}
		return true, method, nil
	default:
		return false, method, ErrRecentCredentials
	}
}
