// recent_email_delivery_postgres_test.go
// Proves update mail delivery and single consumption on disposable PostgreSQL.
// Reuses the same real-path canary regression as the in-memory delivery tests.
// Requires explicit opt-in and never connects to an installation database.
package auth

import (
	"easelect/backend/core_components/otp"
	"fmt"
	"testing"
)

func TestRecentEmailDeliveryPostgres(t *testing.T) {
	for _, mode := range []string{"development fallback", "send failure", "success"} {
		t.Run(mode, func(t *testing.T) {
			db := loginNameDisposableCluster(t)
			if _, err := db.Exec(`UPDATE restricted.users_restricted SET login_verification_method='email' WHERE id=91002`); err != nil {
				t.Fatal(err)
			}
			previous, err := otp.CreateOTP(91002, otp.ProfileApplicationUpdate, "91002@example.invalid")
			if err != nil {
				t.Fatal(err)
			}
			login, err := otp.CreateOTP(91002, otp.ProfileLogin, "91002@example.invalid")
			if err != nil {
				t.Fatal(err)
			}
			exerciseRecentEmailDelivery(t, db, mode, 91002, 1, loginFixturePassword)
			if result, err := otp.VerifyOTP(91002, otp.ProfileApplicationUpdate, previous); err != nil || result.IsVerified() {
				t.Fatal("replacement restored the previous update challenge")
			}
			if result, err := otp.VerifyOTP(91002, otp.ProfileLogin, login); err != nil || !result.IsVerified() {
				t.Fatal("update delivery altered the independent login challenge")
			}
		})
	}
}

func TestRecentEmailDeliveryPreservesNewerResendPostgres(t *testing.T) {
	for _, lateSuccess := range []bool{false, true} {
		t.Run(fmt.Sprint(lateSuccess), func(t *testing.T) {
			db := loginNameDisposableCluster(t)
			exerciseDelayedRecentEmailDelivery(t, db, lateSuccess)
		})
	}
}
