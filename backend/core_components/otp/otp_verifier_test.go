// otp_verifier_test.go
// Exercises fail-closed transaction behavior with a focused database driver.
// Bridges OTP service tests and database/sql without requiring a live database.
// Exists to prove that success is returned only after one locked row is consumed.

package otp

import (
	"context"
	"database/sql"
	"database/sql/driver"
	backend "easelect/backend/core_components"
	"fmt"
	"io"
	"strings"
	"sync/atomic"
	"testing"
)

type otpVerifyMockDriver struct{}
type otpVerifyMockConn struct{}
type otpVerifyMockTx struct{}
type otpVerifyMockRows struct {
	cols []string
	vals []driver.Value
	done bool
}

type otpVerifyMockState struct {
	storedHash   string
	storedTarget string
	attempts     int64
	maxAttempts  int64
	expired      bool
	noRows       bool
	deleteError  bool
	commitError  bool
	lastQuery    string
	lastExec     string
	execCount    int32
}

var otpVerifyState otpVerifyMockState
var otpVerifyDriverCounter atomic.Int64

func (d *otpVerifyMockDriver) Open(_ string) (driver.Conn, error) { return &otpVerifyMockConn{}, nil }
func (c *otpVerifyMockConn) Prepare(_ string) (driver.Stmt, error) {
	return nil, fmt.Errorf("prepare not supported")
}
func (c *otpVerifyMockConn) Close() error { return nil }
func (c *otpVerifyMockConn) Begin() (driver.Tx, error) {
	return &otpVerifyMockTx{}, nil
}
func (c *otpVerifyMockConn) BeginTx(context.Context, driver.TxOptions) (driver.Tx, error) {
	return &otpVerifyMockTx{}, nil
}
func (tx *otpVerifyMockTx) Commit() error {
	if otpVerifyState.commitError {
		return fmt.Errorf("forced commit failure")
	}
	return nil
}
func (tx *otpVerifyMockTx) Rollback() error { return nil }

func (r *otpVerifyMockRows) Columns() []string { return r.cols }
func (r *otpVerifyMockRows) Close() error      { return nil }
func (r *otpVerifyMockRows) Next(dest []driver.Value) error {
	if r.done || otpVerifyState.noRows {
		return io.EOF
	}
	r.done = true
	copy(dest, r.vals)
	return nil
}

func (c *otpVerifyMockConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	otpVerifyState.lastQuery = query
	return &otpVerifyMockRows{
		cols: []string{"id", "code_hash", "target_email", "attempts", "max_attempts", "expired"},
		vals: []driver.Value{
			int64(55),
			otpVerifyState.storedHash,
			otpVerifyState.storedTarget,
			otpVerifyState.attempts,
			otpVerifyState.maxAttempts,
			otpVerifyState.expired,
		},
	}, nil
}

func (c *otpVerifyMockConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	otpVerifyState.lastExec = query
	otpVerifyState.execCount++
	if otpVerifyState.deleteError && strings.Contains(query, "DELETE FROM restricted.verification_codes") {
		return nil, fmt.Errorf("forced delete failure")
	}
	return driver.RowsAffected(1), nil
}

func openOTPVerifyMockDB(t *testing.T, state otpVerifyMockState) *sql.DB {
	t.Helper()
	otpVerifyState = state
	name := fmt.Sprintf("otp_verify_%d", otpVerifyDriverCounter.Add(1))
	sql.Register(name, &otpVerifyMockDriver{})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatalf("sql.Open mock: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func withOTPVerifyDB(t *testing.T, state otpVerifyMockState) {
	t.Helper()
	original := backend.DbConfidential
	backend.DbConfidential = openOTPVerifyMockDB(t, state)
	t.Cleanup(func() { backend.DbConfidential = original })
}

func baseOTPVerifyState() otpVerifyMockState {
	return otpVerifyMockState{
		storedHash: HashCode("abc def ghj"), storedTarget: "first@example.com",
		maxAttempts: 5,
	}
}

func TestVerifyOTPForTargetRejectsMismatchedTargetEmail(t *testing.T) {
	withOTPVerifyDB(t, baseOTPVerifyState())

	result, err := VerifyOTPForTarget(7, ProfileEmailChange, "other@example.com", "abc def ghj")
	if err != nil {
		t.Fatalf("VerifyOTPForTarget() error: %v", err)
	}
	if result.Status != VerificationInvalid || result.AttemptsRemaining != 4 {
		t.Fatalf("unexpected result: %#v", result)
	}
	if !strings.Contains(otpVerifyState.lastQuery, "FOR UPDATE") {
		t.Fatal("verification row was not locked")
	}
	if !strings.Contains(otpVerifyState.lastExec, "UPDATE restricted.verification_codes") {
		t.Fatal("target mismatch did not consume an attempt")
	}
}

func TestVerifyOTPFailsClosedWhenConsumeDeleteFails(t *testing.T) {
	state := baseOTPVerifyState()
	state.deleteError = true
	withOTPVerifyDB(t, state)

	result, err := VerifyOTP(7, ProfileLogin, "abc def ghj")
	if err == nil {
		t.Fatal("expected consume error")
	}
	if result.IsVerified() {
		t.Fatal("OTP must not verify when consume fails")
	}
}

func TestVerifyOTPFailsClosedWhenCommitFails(t *testing.T) {
	state := baseOTPVerifyState()
	state.commitError = true
	withOTPVerifyDB(t, state)

	result, err := VerifyOTP(7, ProfileLogin, "abc def ghj")
	if err == nil {
		t.Fatal("expected commit error")
	}
	if result.IsVerified() {
		t.Fatal("OTP must not verify when commit fails")
	}
}

func TestVerifyOTPDeletesOnFifthWrongAttempt(t *testing.T) {
	state := baseOTPVerifyState()
	state.attempts = 4
	withOTPVerifyDB(t, state)

	result, err := VerifyOTP(7, ProfileLogin, "wrongcode")
	if err != nil {
		t.Fatalf("VerifyOTP() error: %v", err)
	}
	if result.Status != VerificationAttemptsExhausted || result.AttemptsRemaining != 0 {
		t.Fatalf("unexpected result: %#v", result)
	}
	if !strings.Contains(otpVerifyState.lastExec, "DELETE FROM restricted.verification_codes") {
		t.Fatal("fifth wrong attempt did not consume the challenge")
	}
}

func TestVerifyOTPReturnsNotFoundWithoutMutation(t *testing.T) {
	state := baseOTPVerifyState()
	state.noRows = true
	withOTPVerifyDB(t, state)

	result, err := VerifyOTP(7, ProfileLogin, "abc def ghj")
	if err != nil {
		t.Fatalf("VerifyOTP() error: %v", err)
	}
	if result.Status != VerificationNotFound || otpVerifyState.execCount != 0 {
		t.Fatalf("unexpected not-found result/state: %#v / %#v", result, otpVerifyState)
	}
}
