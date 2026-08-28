// otp_postgres_integration_test.go
// Proves OTP concurrency semantics against an explicitly disposable PostgreSQL database.
// Bridges the service adapter and real row locks/advisory locks without touching native data.
// Exists because database/sql mocks cannot prove PostgreSQL serialization behavior.

package otp

import (
	"database/sql"
	backend "easelect/backend/core_components"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"

	_ "github.com/lib/pq"
)

func openDisposableOTPIntegrationDB(t *testing.T) *sql.DB {
	t.Helper()
	dsn := strings.TrimSpace(os.Getenv("EASELECT_OTP_INTEGRATION_DSN"))
	if dsn == "" {
		t.Skip("EASELECT_OTP_INTEGRATION_DSN is not set")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatalf("open disposable OTP database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	var databaseName string
	if err := db.QueryRow(`SELECT current_database()`).Scan(&databaseName); err != nil {
		t.Fatalf("read disposable database identity: %v", err)
	}
	if databaseName == "easelect" || !strings.Contains(databaseName, "disposable") {
		t.Fatalf("refusing OTP integration mutations in database %q", databaseName)
	}

	var sibling, overwrite bool
	if err := db.QueryRow(`
		SELECT
			EXISTS (SELECT 1 FROM public.system_config WHERE key = 'instance_kind' AND text_value = 'filterest_sibling'),
			EXISTS (SELECT 1 FROM public.system_config WHERE key = 'overwrite_possible' AND boolean_value IS TRUE)
	`).Scan(&sibling, &overwrite); err != nil {
		t.Fatalf("read disposable lifecycle guard: %v", err)
	}
	if !sibling || !overwrite {
		t.Fatal("refusing OTP integration mutations without Filterest disposable lifecycle guards")
	}
	return db
}

func TestOTPPostgresAtomicityAndPersistence(t *testing.T) {
	db := openDisposableOTPIntegrationDB(t)
	original := backend.DbConfidential
	backend.DbConfidential = db
	t.Cleanup(func() { backend.DbConfidential = original })

	var userID int
	if err := db.QueryRow(`SELECT id FROM public.system_users ORDER BY id DESC LIMIT 1`).Scan(&userID); err != nil {
		t.Fatalf("select disposable fixture user: %v", err)
	}

	t.Run("one concurrent verification succeeds", func(t *testing.T) {
		code, err := CreateOTP(userID, ProfileLogin, "atomic@example.invalid")
		if err != nil {
			t.Fatalf("CreateOTP: %v", err)
		}

		const workers = 20
		results := make(chan VerificationResult, workers)
		errors := make(chan error, workers)
		var group sync.WaitGroup
		for range workers {
			group.Add(1)
			go func() {
				defer group.Done()
				result, verifyErr := VerifyOTP(userID, ProfileLogin, code)
				results <- result
				errors <- verifyErr
			}()
		}
		group.Wait()
		close(results)
		close(errors)

		verified := 0
		for err := range errors {
			if err != nil {
				t.Errorf("concurrent VerifyOTP: %v", err)
			}
		}
		for result := range results {
			if result.IsVerified() {
				verified++
			}
		}
		if verified != 1 {
			t.Fatalf("successful concurrent verifications = %d, want 1", verified)
		}
	})

	t.Run("fifth wrong attempt consumes challenge", func(t *testing.T) {
		code, err := CreateOTP(userID, ProfilePasswordReset, "attempts@example.invalid")
		if err != nil {
			t.Fatalf("CreateOTP: %v", err)
		}
		for attempt := 1; attempt <= 5; attempt++ {
			result, verifyErr := VerifyOTP(userID, ProfilePasswordReset, fmt.Sprintf("wrong-%d", attempt))
			if verifyErr != nil {
				t.Fatalf("wrong attempt %d: %v", attempt, verifyErr)
			}
			if attempt < 5 && result.Status != VerificationInvalid {
				t.Fatalf("wrong attempt %d status = %s, want invalid", attempt, result.Status)
			}
			if attempt == 5 && result.Status != VerificationAttemptsExhausted {
				t.Fatalf("fifth wrong attempt status = %s, want attempts_exhausted", result.Status)
			}
		}
		result, err := VerifyOTP(userID, ProfilePasswordReset, code)
		if err != nil || result.Status != VerificationNotFound {
			t.Fatalf("exhausted challenge remained usable: result=%#v err=%v", result, err)
		}
	})

	t.Run("concurrent creates leave one challenge", func(t *testing.T) {
		const workers = 20
		var group sync.WaitGroup
		errors := make(chan error, workers)
		for range workers {
			group.Add(1)
			go func() {
				defer group.Done()
				_, createErr := CreateOTP(userID, ProfileEmailChange, "create@example.invalid")
				errors <- createErr
			}()
		}
		group.Wait()
		close(errors)
		for err := range errors {
			if err != nil {
				t.Errorf("concurrent CreateOTP: %v", err)
			}
		}
		var count int
		if err := db.QueryRow(`
			SELECT COUNT(*) FROM restricted.verification_codes
			WHERE user_id = $1 AND purpose = $2
		`, userID, ProfileEmailChange).Scan(&count); err != nil {
			t.Fatalf("count active challenges: %v", err)
		}
		if count != 1 {
			t.Fatalf("active challenges = %d, want 1", count)
		}
	})

	t.Run("send limit survives new database handle", func(t *testing.T) {
		const workers = 10
		var group sync.WaitGroup
		reservations := make(chan SendReservation, workers)
		errors := make(chan error, workers)
		for range workers {
			group.Add(1)
			go func() {
				defer group.Done()
				reservation, reserveErr := ReserveSend(userID, ProfileLogin)
				reservations <- reservation
				errors <- reserveErr
			}()
		}
		group.Wait()
		close(reservations)
		close(errors)

		allowed := 0
		for err := range errors {
			if err != nil {
				t.Errorf("concurrent ReserveSend: %v", err)
			}
		}
		for reservation := range reservations {
			if reservation.Allowed {
				allowed++
			}
		}
		if allowed != 3 {
			t.Fatalf("allowed send reservations = %d, want 3", allowed)
		}

		secondHandle, err := sql.Open("postgres", os.Getenv("EASELECT_OTP_INTEGRATION_DSN"))
		if err != nil {
			t.Fatalf("open second database handle: %v", err)
		}
		defer secondHandle.Close()
		backend.DbConfidential = secondHandle
		reservation, err := ReserveSend(userID, ProfileLogin)
		backend.DbConfidential = db
		if err != nil {
			t.Fatalf("ReserveSend after handle replacement: %v", err)
		}
		if reservation.Allowed {
			t.Fatal("send limit reset after database handle replacement")
		}
	})
}
