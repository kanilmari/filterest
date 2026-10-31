// read_budget_acquisition_test.go
// Proves bounded pool waits do not own the lifetime of a lazy request transaction.
// Records actual driver BeginTx and metadata QueryContext calls without PostgreSQL.
// Checks connection return on timeout, commit, rollback and begin-hook failure.
package dbutils

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"testing"
	"time"
)

type acquisitionBudgetDriver struct {
	state        *readBudgetState
	begin, query *context.Context
}
type acquisitionBudgetConn struct {
	readBudgetConn
	begin, query *context.Context
}

func (d acquisitionBudgetDriver) Open(string) (driver.Conn, error) {
	return &acquisitionBudgetConn{readBudgetConn{d.state}, d.begin, d.query}, nil
}
func (c *acquisitionBudgetConn) BeginTx(ctx context.Context, _ driver.TxOptions) (driver.Tx, error) {
	*c.begin = ctx
	return c, nil
}
func (c *acquisitionBudgetConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	*c.query = ctx
	return c.readBudgetConn.QueryContext(ctx, query, args)
}

func acquisitionBudgetDB(t *testing.T) (*sql.DB, *context.Context, *context.Context) {
	t.Helper()
	var begin, query context.Context
	name := fmt.Sprintf("read_budget_acquisition_%d", readBudgetDriverID.Add(1))
	sql.Register(name, acquisitionBudgetDriver{&readBudgetState{}, &begin, &query})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { db.Close() })
	return db, &begin, &query
}

func TestReadBudgetLazyTransactionPoolWaitIsBounded(t *testing.T) {
	db, _, _ := acquisitionBudgetDB(t)
	held, err := db.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer held.Close()
	failsafe := time.AfterFunc(300*time.Millisecond, func() { held.Close() })
	defer failsafe.Stop()
	budget, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	lazy := NewLazyTx(db)
	ctx := WithReadBudget(SetLazyTx(context.Background(), lazy), budget)
	start := time.Now()
	if _, err := RequireTxWithError(ctx); !errors.Is(err, context.DeadlineExceeded) || lazy.WasStarted() || ctx.Err() != nil {
		t.Fatal("pool wait escaped its budget or cancelled request", err)
	}
	if time.Since(start) > 200*time.Millisecond {
		t.Fatal("unbounded transaction pool wait")
	}
	held.Close()
	if _, err := lazy.BeginContext(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := lazy.Commit(); err != nil || db.Stats().InUse != 0 {
		t.Fatal("pool slot leaked", err, db.Stats())
	}
}

func TestReadBudgetLazyTransactionRetainsOriginalBeginContext(t *testing.T) {
	for _, mode := range []string{"commit", "rollback", "begin hook failure"} {
		t.Run(mode, func(t *testing.T) {
			db, begin, _ := acquisitionBudgetDB(t)
			parent, finishParent := context.WithTimeout(context.Background(), time.Minute)
			defer finishParent()
			budget, cancel := context.WithTimeout(parent, time.Second)
			defer cancel()
			lazy := NewLazyTx(db)
			if mode == "begin hook failure" {
				lazy.onBegin = func(*sql.Tx) error { return errors.New("hook refused") }
			}
			tx, err := lazy.BeginContext(WithReadBudget(parent, budget))
			if mode == "begin hook failure" {
				if err == nil || db.Stats().InUse != 0 {
					t.Fatal("begin failure leaked connection", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			deadline, _ := (*begin).Deadline()
			original, _ := parent.Deadline()
			if (*begin).Done() != parent.Done() || deadline != original {
				t.Fatal("budget reached BeginTx")
			}
			cancel()
			var value int
			if err := tx.QueryRowContext(parent, "following read").Scan(&value); err != nil || value != 7 {
				t.Fatal(value, err)
			}
			if mode == "commit" {
				err = lazy.Commit()
			} else {
				err = lazy.Rollback()
			}
			if err != nil || db.Stats().InUse != 0 {
				t.Fatal("transaction connection leaked", err, db.Stats())
			}
		})
	}
}

func TestReadBudgetMetadataFallbackCarriesDeadline(t *testing.T) {
	db, _, seen := acquisitionBudgetDB(t)
	budget, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	q, finish, err := BeginReadBudget(WithReadBudget(context.Background(), budget), db)
	if err != nil {
		t.Fatal(err)
	}
	defer finish()
	for _, source := range []Querier{q, &budgetedReadTx{budget: budget}} {
		metadata := ReadBudgetFallback(source, db)
		var value int
		if err := metadata.QueryRow("metadata").Scan(&value); err != nil || value != 7 {
			t.Fatal(value, err)
		}
		deadline, bounded := (*seen).Deadline()
		want, _ := budget.Deadline()
		if !bounded || deadline != want {
			t.Fatal("metadata pool lost deadline", deadline, want)
		}
	}
	if ReadBudgetFallback(db, db) != db {
		t.Fatal("ordinary fallback changed behavior")
	}
}

func TestReadBudgetLazyTransactionReturnsPoolSlotBeforeHooks(t *testing.T) {
	for _, commit := range []bool{true, false} {
		t.Run(fmt.Sprintf("commit=%t", commit), func(t *testing.T) {
			db, _, _ := acquisitionBudgetDB(t)
			budget, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			lazy := NewLazyTx(db)
			if _, err := lazy.BeginContext(WithReadBudget(context.Background(), budget)); err != nil {
				t.Fatal(err)
			}
			ran := false
			hook := func() {
				ran = true
				ctx, finish := context.WithTimeout(context.Background(), 100*time.Millisecond)
				defer finish()
				var value int
				if err := db.QueryRowContext(ctx, "hook read").Scan(&value); err != nil || value != 7 {
					t.Error("ended transaction stranded its pool slot before hooks", value, err)
				}
			}
			var err error
			if commit {
				lazy.AddAfterCommitHook(hook)
				err = lazy.Commit()
			} else {
				lazy.AddAfterRollbackHook(hook)
				err = lazy.Rollback()
			}
			if err != nil || !ran {
				t.Fatal("transaction hook did not finish", err, ran)
			}
		})
	}
}
