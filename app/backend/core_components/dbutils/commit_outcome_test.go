// commit_outcome_test.go
// Proves a commit that happened stays committed when a later release fails.
// Exercises both release points: the connector's own and the request admission.
// Keeps genuine commit failures distinguishable from saved changes with cleanup noise.
package dbutils

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"testing"
)

type commitOutcomeDriver struct{ commitErr error }
type commitOutcomeConn struct{ commitErr error }
type commitOutcomeTx struct{ commitErr error }

func (d commitOutcomeDriver) Open(string) (driver.Conn, error) {
	return commitOutcomeConn(d), nil
}
func (d commitOutcomeDriver) Connect(context.Context) (driver.Conn, error) { return d.Open("") }
func (d commitOutcomeDriver) Driver() driver.Driver                        { return d }
func (commitOutcomeConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepare")
}
func (commitOutcomeConn) Close() error                { return nil }
func (c commitOutcomeConn) Begin() (driver.Tx, error) { return commitOutcomeTx(c), nil }
func (tx commitOutcomeTx) Commit() error              { return tx.commitErr }
func (commitOutcomeTx) Rollback() error               { return nil }

func TestLazyTxKeepsCommittedOutcomeWhenReleaseFails(t *testing.T) {
	releaseErr := errors.New("request barrier release failed")
	commitErr := errors.New("deferred constraint violated at commit")
	for _, test := range []struct {
		name                string
		driverCommitErr     error
		admissionReleaseErr error
		wantCommitted       bool
		wantCause           error
	}{
		{name: "clean commit", wantCommitted: true},
		{name: "admission release fails after commit", admissionReleaseErr: releaseErr, wantCommitted: true, wantCause: releaseErr},
		{name: "connector release fails after commit", driverCommitErr: CommittedWithCleanupError(releaseErr), wantCommitted: true, wantCause: releaseErr},
		{name: "commit itself fails", driverCommitErr: commitErr, wantCause: commitErr},
		{name: "commit fails and release fails", driverCommitErr: commitErr, admissionReleaseErr: releaseErr, wantCause: commitErr},
	} {
		t.Run(test.name, func(t *testing.T) {
			db := sql.OpenDB(commitOutcomeDriver{commitErr: test.driverCommitErr})
			defer db.Close()
			lt := NewLazyTx(db)
			lt.SetAdmissionHook(func(context.Context) (func() error, error) {
				return func() error { return test.admissionReleaseErr }, nil
			})
			if _, err := lt.Begin(); err != nil {
				t.Fatal(err)
			}
			committedHook, rollbackHook := false, false
			lt.AddAfterCommitHook(func() { committedHook = true })
			lt.AddAfterRollbackHook(func() { rollbackHook = true })

			err := lt.Commit()
			if test.wantCause == nil {
				if err != nil {
					t.Fatalf("clean commit returned %v", err)
				}
			} else if !errors.Is(err, test.wantCause) {
				t.Fatalf("lost cause %v: %v", test.wantCause, err)
			}
			if got := err == nil || IsCommittedCleanupError(err); got != test.wantCommitted {
				t.Fatalf("committed outcome = %v, want %v (%v)", got, test.wantCommitted, err)
			}
			if committedHook != test.wantCommitted {
				t.Fatalf("after-commit hook ran = %v, want %v", committedHook, test.wantCommitted)
			}
			if test.wantCommitted {
				// Middleware never rolls back a committed transaction, but even a
				// stray Rollback must not run compensations for a saved change.
				_ = lt.Rollback()
				if rollbackHook {
					t.Fatal("rollback hook ran after a committed transaction")
				}
			}
		})
	}
}

func TestCommittedWithCleanupErrorDoesNotRewrap(t *testing.T) {
	if CommittedWithCleanupError(nil) != nil {
		t.Fatal("nil cleanup error became an error")
	}
	cause := errors.New("release failed")
	once := CommittedWithCleanupError(cause)
	twice := CommittedWithCleanupError(once)
	if once != twice || !errors.Is(twice, cause) || !IsCommittedCleanupError(twice) {
		t.Fatal(once, twice)
	}
	if IsCommittedCleanupError(cause) {
		t.Fatal("plain error claimed a committed outcome")
	}
}

func TestLazyTxRefusesNewTransactionsOnlyBeforeOneOpens(t *testing.T) {
	reason := errors.New("response already forwarded")
	db := sql.OpenDB(commitOutcomeDriver{})
	defer db.Close()

	refused := NewLazyTx(db)
	if !refused.RefuseNewTransactions(reason) {
		t.Fatal("refusal must succeed while no transaction is open")
	}
	if tx, err := refused.Begin(); tx != nil || !errors.Is(err, reason) || refused.WasStarted() {
		t.Fatalf("transaction opened after refusal: tx=%v err=%v", tx, err)
	}

	open := NewLazyTx(db)
	tx, err := open.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if open.RefuseNewTransactions(reason) {
		t.Fatal("refusal claimed success with a transaction already open")
	}
	if again, err := open.Begin(); err != nil || again != tx {
		t.Fatalf("open transaction became unusable: %v %v", again, err)
	}
	if err := open.Commit(); err != nil {
		t.Fatal(err)
	}
}
