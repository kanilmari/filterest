// recent_credentials_checker_test.go
// Verifies recent password checks and configured PIN/TOTP/email factor requirements.
// Connects the existing credential and factor services with update proof issuance.
// Keeps password-only accounts explicit and missing factor secrets fail-closed.
package auth

import (
	"context"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/otp"
	"errors"
	"golang.org/x/crypto/bcrypt"
	"testing"
	"time"
)

func TestRecentCredentialsRequireCurrentPasswordAndGeneration(t *testing.T) {
	hash, err := bcrypt.GenerateFromPassword([]byte("correct-password"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	pin, err := hashFixedPIN("1234")
	if err != nil {
		t.Fatal(err)
	}
	old := backend.DbConfidential
	t.Cleanup(func() { backend.DbConfidential = old })
	for _, test := range []struct {
		password   string
		generation int64
		factor     string
		apiOnly    bool
		wantError  bool
		required   bool
	}{
		{"wrong", 3, "1234", false, true, false}, {"correct-password", 2, "1234", false, true, false},
		{"correct-password", 3, "", false, false, true}, {"correct-password", 3, "9876", false, true, false},
		{"correct-password", 3, "1234", false, false, false}, {"correct-password", 3, "1234", true, true, false},
	} {
		backend.DbConfidential = openCredentialMockDB(t, credentialMockConfig{hashedPassword: string(hash), verificationMethod: "fixed_pin", fixedPINHash: pin, authGeneration: 3, apiOnly: test.apiOnly})
		required, method, err := CheckRecentCredentials(context.Background(), 42, test.generation, test.password, test.factor)
		if test.wantError {
			if !errors.Is(err, ErrRecentCredentials) {
				t.Fatal(err)
			}
		} else if err != nil || required != test.required || method != "fixed_pin" {
			t.Fatal(required, method, err)
		}
	}
}

func TestRecentFactorsCannotDowngradeMissingOrConfiguredFactors(t *testing.T) {
	now := time.Now()
	secret, err := generateTOTPSecret()
	if err != nil {
		t.Fatal(err)
	}
	code, err := totpCodeForCounter(secret, uint64(now.Unix()/totpPeriod))
	if err != nil {
		t.Fatal(err)
	}
	for _, method := range []loginVerificationMethod{verificationFixedPIN, verificationTOTP, verificationEmail, loginVerificationMethod("unknown")} {
		_, _, err := checkRecentFactor(loginVerificationRecord{Method: method}, 42, "123456", now)
		if !errors.Is(err, ErrRecentCredentials) {
			t.Fatalf("missing %s factor did not refuse: %v", method, err)
		}
	}
	record := loginVerificationRecord{Method: verificationTOTP, TOTPSecret: secret}
	if required, _, err := checkRecentFactor(record, 42, "", now); err != nil || !required {
		t.Fatal(required, err)
	}
	if required, _, err := checkRecentFactor(record, 42, code, now); err != nil || required {
		t.Fatal(required, err)
	}
	if _, _, err := checkRecentFactor(record, 42, "wrong", now); !errors.Is(err, ErrRecentCredentials) {
		t.Fatal(err)
	}
	if required, _, err := checkRecentFactor(loginVerificationRecord{Method: verificationNone}, 42, "", now); err != nil || required {
		t.Fatal(required, err)
	}
	profile, ok := otp.GetProfile(otp.ProfileApplicationUpdate)
	if !ok || profile.Purpose == "login" || profile.TTL != 5*time.Minute || profile.MaxVerifyAttempts != 5 || profile.UserSendLimit != 3 {
		t.Fatal("update email factor lacks its own bounded purpose", profile)
	}
}

func TestRecentEmailFactorConsumesOnlyUpdateChallengePostgres(t *testing.T) {
	db := loginNameDisposableCluster(t)
	if _, err := db.Exec(`UPDATE restricted.users_restricted SET login_verification_method='email' WHERE id=91002`); err != nil {
		t.Fatal(err)
	}
	loginCode, err := otp.CreateOTP(91002, otp.ProfileLogin, "91002@example.invalid")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = CheckRecentCredentials(context.Background(), 91002, 1, loginFixturePassword, loginCode); !errors.Is(err, ErrRecentCredentials) {
		t.Fatal("ordinary login code authorized an update", err)
	}
	code, err := otp.CreateOTP(91002, otp.ProfileApplicationUpdate, "91002@example.invalid")
	if err != nil {
		t.Fatal(err)
	}
	if required, method, err := CheckRecentCredentials(context.Background(), 91002, 1, loginFixturePassword, code); err != nil || required || method != "email" {
		t.Fatal(required, method, err)
	}
	if _, _, err = CheckRecentCredentials(context.Background(), 91002, 1, loginFixturePassword, code); !errors.Is(err, ErrRecentCredentials) {
		t.Fatal("update email code replay succeeded", err)
	}
}
