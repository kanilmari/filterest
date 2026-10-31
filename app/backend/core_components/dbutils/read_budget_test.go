// read_budget_test.go
// Verifies shrinking statement bounds and savepoint recovery without PostgreSQL.
// Connects real database/sql transactions to a driver that models aborted statements.
// Covers successful, failed and unscannable reads plus pooled acquisition deadlines.
package dbutils

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"strconv"
	"sync/atomic"
	"testing"
	"time"
)

type readBudgetDriver struct{ state *readBudgetState }
type readBudgetConn struct{ state *readBudgetState }
type readBudgetState struct {
	timeout, saved int64
	bounds         []int64
	aborted        bool
	committed      bool
	rolledBack     bool
	queries        int
	savepoints     int
	releases       int
}
type readBudgetRows struct{ read bool }

var readBudgetDriverID atomic.Int64

func (d readBudgetDriver) Open(string) (driver.Conn, error) { return &readBudgetConn{d.state}, nil }
func (*readBudgetConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepare")
}
func (*readBudgetConn) Close() error                { return nil }
func (c *readBudgetConn) Begin() (driver.Tx, error) { return c, nil }
func (c *readBudgetConn) Commit() error {
	if c.state.aborted {
		return errors.New("transaction aborted")
	}
	c.state.committed = true
	return nil
}
func (c *readBudgetConn) Rollback() error { c.state.rolledBack = true; return nil }
func (c *readBudgetConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	s := c.state
	switch query {
	case "SAVEPOINT filterest_optional_read":
		s.saved = s.timeout
		s.savepoints++
	case "ROLLBACK TO SAVEPOINT filterest_optional_read":
		s.timeout, s.aborted = s.saved, false
	case "RELEASE SAVEPOINT filterest_optional_read":
		s.releases++
	case "SELECT set_config('statement_timeout', $1, true)":
		s.timeout, _ = strconv.ParseInt(args[0].Value.(string), 10, 64)
		s.bounds = append(s.bounds, s.timeout)
	default:
		return nil, fmt.Errorf("unexpected exec: %s", query)
	}
	return driver.RowsAffected(0), nil
}
func (c *readBudgetConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	c.state.queries++
	if query == "blocked" {
		c.state.aborted = true
		return nil, errors.New("statement timeout")
	}
	if c.state.aborted {
		return nil, errors.New("transaction aborted")
	}
	return &readBudgetRows{}, nil
}
func (*readBudgetRows) Columns() []string { return []string{"value"} }
func (*readBudgetRows) Close() error      { return nil }
func (r *readBudgetRows) Next(values []driver.Value) error {
	if r.read {
		return io.EOF
	}
	r.read, values[0] = true, int64(7)
	return nil
}

func openReadBudgetDB(t *testing.T) (*sql.DB, *readBudgetState) {
	t.Helper()
	s := &readBudgetState{timeout: 9000}
	name := fmt.Sprintf("read_budget_%d", readBudgetDriverID.Add(1))
	sql.Register(name, readBudgetDriver{s})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db, s
}

func TestReadBudgetTransactionRecoveryAndTimeoutRestoration(t *testing.T) {
	for _, mode := range []string{"success", "statement error", "scan error"} {
		t.Run(mode, func(t *testing.T) {
			db, state := openReadBudgetDB(t)
			tx, err := db.BeginTx(context.Background(), nil)
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			budget, cancel := context.WithTimeout(context.Background(), time.Second)
			ctx := WithReadBudget(context.Background(), budget)
			q, finish, err := BeginReadBudget(ctx, tx)
			if err != nil {
				t.Fatal(err)
			}
			query := "read"
			if mode == "statement error" {
				query = "blocked"
			}
			var value int
			if mode == "scan error" {
				var date time.Time
				err = q.QueryRow(query).Scan(&date)
			} else {
				err = q.QueryRow(query).Scan(&value)
			}
			if (err != nil) != (mode != "success") {
				t.Fatalf("read result for %s: %v", mode, err)
			}
			cancel() // Recovery must work after the optional budget has expired.
			if err := finish(); err != nil {
				t.Fatal(err)
			}
			if err := finish(); err != nil || state.savepoints != 1 || state.releases != 1 || state.timeout != 9000 {
				t.Fatal("savepoint/settings not restored exactly once", state, err)
			}
			if len(state.bounds) != 1 || state.bounds[0] < 1 || state.bounds[0] > 1000 {
				t.Fatal("statement ignored remaining budget", state.bounds)
			}
			if err := tx.QueryRowContext(ctx, "following read").Scan(&value); err != nil || value != 7 {
				t.Fatal("following request read failed", value, err)
			}
			if err := tx.Commit(); err != nil || !state.committed || state.rolledBack {
				t.Fatal("budget cancellation rolled back the request", state, err)
			}
		})
	}
}

func TestReadBudgetRecalculatesAtEachStatement(t *testing.T) {
	db, state := openReadBudgetDB(t)
	tx, _ := db.Begin()
	defer tx.Rollback()
	budget, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	ctx := WithReadBudget(context.Background(), budget)
	q, finish, err := BeginReadBudget(ctx, tx)
	if err != nil {
		t.Fatal(err)
	}
	defer finish()
	rows, err := q.Query("first read")
	if err != nil {
		t.Fatal(err)
	}
	rows.Close()
	time.Sleep(10 * time.Millisecond)
	var value int
	if err := q.QueryRow("second read").Scan(&value); err != nil {
		t.Fatal(err)
	}
	if len(state.bounds) != 2 || state.bounds[1] >= state.bounds[0] || state.bounds[1] < 1 {
		t.Fatal("second statement reset the full budget", state.bounds)
	}
	cancel()
	before := state.queries
	if _, err := q.Query("expired read"); !errors.Is(err, context.Canceled) || !ReadBudgetExpired(ctx) || state.queries != before {
		t.Fatal("expired read reached the database", err, state.queries)
	}
}

func TestReadBudgetPoolAcquisitionIsBounded(t *testing.T) {
	db, _ := openReadBudgetDB(t)
	db.SetMaxOpenConns(1)
	held, err := db.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer held.Close()
	budget, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	ctx := WithReadBudget(context.Background(), budget)
	q, finish, err := BeginReadBudget(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	defer finish()
	start := time.Now()
	if _, err := q.Query("blocked pool"); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal("pooled read ignored deadline", err)
	}
	if time.Since(start) > time.Second || ctx.Err() != nil {
		t.Fatal("optional deadline became request cancellation")
	}
}
