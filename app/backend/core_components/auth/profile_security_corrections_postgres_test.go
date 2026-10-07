// profile_security_corrections_postgres_test.go
// Proves persistent current-password throttling and reset-confirmation work.
// Connects real handlers and the disposable migrated PostgreSQL fixture.
// Checks committed failure counts, rollback of profile data and unknown-code work.
package auth

import (
	"easelect/backend/core_components/otp"
	"fmt"
	"strings"
	"testing"
)

func TestProfileCurrentPasswordFailureLimitPostgres(t *testing.T) {
	db := loginNameDisposableCluster(t)
	cookie := postgresOwnCookie(t, 91002)
	for index, body := range []string{
		`{"sign_out_other_devices":true,"current_password":"wrong"}`,
		`{"username":"must-not-change","current_password":"wrong"}`,
		`{"email":"must-not-change@example.invalid","current_password":"wrong"}`,
	} {
		response := postgresProfile(t, cookie, body)
		if response.Code != 400 || !strings.Contains(response.Body.String(), "current_password_incorrect") {
			t.Fatal("incorrect password was not counted", index, response.Code, response.Body.String())
		}
	}
	// Every sensitive action shares the same failure budget, even a correct password.
	for _, body := range []string{
		`{"sign_out_other_devices":true,"current_password":"` + loginFixturePassword + `"}`,
		`{"username":"must-not-change","current_password":"` + loginFixturePassword + `"}`,
	} {
		response := postgresProfile(t, cookie, body)
		if response.Code != 429 || !strings.Contains(response.Body.String(), "profile_password_rate_limited") {
			t.Fatal("current-password budget bypass", response.Code, response.Body.String())
		}
	}
	var unchanged bool
	if err := db.QueryRow(`SELECT u.username='ordinary_login' AND ur.email='91002@example.invalid' AND ur.authentication_generation=1
        AND (SELECT count(*) FROM restricted.otp_send_events WHERE user_id=u.id AND purpose='profile_current_password')=3
        FROM system_users u JOIN restricted.users_restricted ur USING(id) WHERE u.id=91002`).Scan(&unchanged); err != nil || !unchanged {
		t.Fatal("failure accounting or profile rollback", err)
	}
	if _, err := db.Exec(`UPDATE restricted.otp_send_events SET requested_at=NOW()-INTERVAL '6 minutes' WHERE user_id=91002 AND purpose='profile_current_password'`); err != nil {
		t.Fatal(err)
	}
	response := postgresProfile(t, cookie, `{"username":"permitted-display","current_password":"`+loginFixturePassword+`"}`)
	if response.Code != 200 {
		t.Fatal("expired failures still block", response.Code, response.Body.String())
	}
}

func TestLT7ResetConfirmUnknownWritesAndCommitsPostgres(t *testing.T) {
	db := loginNameDisposableCluster(t)
	var before, after bool
	if err := db.QueryRow(`SELECT work FROM restricted.password_reset_dummy_work WHERE id=true`).Scan(&before); err != nil {
		t.Fatal(err)
	}
	result, err := otp.VerifyOTP(0, otp.ProfilePasswordReset, "wrong-code")
	if err != nil || result.Status != otp.VerificationNotFound {
		t.Fatal(result, err)
	}
	if err := db.QueryRow(`SELECT work FROM restricted.password_reset_dummy_work WHERE id=true`).Scan(&after); err != nil || before == after {
		t.Fatal("unknown confirmation did not commit dummy write", err)
	}
	code, err := otp.CreateOTP(91002, otp.ProfilePasswordReset, "91002@example.invalid")
	if err != nil {
		t.Fatal(err)
	}
	if code == "wrong-code" {
		t.Fatal("fixture code collision")
	}
	result, err = otp.VerifyOTP(91002, otp.ProfilePasswordReset, "wrong-code")
	if err != nil || result.Status != otp.VerificationInvalid {
		t.Fatal(result, err)
	}
	var attempts int
	if err := db.QueryRow(`SELECT attempts FROM restricted.verification_codes WHERE user_id=91002 AND purpose='password_reset'`).Scan(&attempts); err != nil || attempts != 1 {
		t.Fatal("pending confirmation did not commit attempt", err)
	}
	if err := db.QueryRow(`SELECT work FROM restricted.password_reset_dummy_work WHERE id=true`).Scan(&before); err != nil || before != after {
		t.Fatal(fmt.Sprintf("real confirmation used dummy work: %v", err))
	}
}
