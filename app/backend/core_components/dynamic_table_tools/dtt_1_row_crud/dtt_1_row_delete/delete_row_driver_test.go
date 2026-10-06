// delete_row_driver_test.go
// Unit tests for the dtt_1_row_delete package.
// Uses httptest for handler guard branches and a database/sql driver double for the extracted transaction-level helpers.
// Shares queued database responses without changing the focused assertions.
package dtt_1_row_delete

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"easelect/backend/core_components/runtime_grants/granttest"
	"errors"
	"fmt"
	"io"
	"sync"
	"testing"
	"time"
)

// ── driver double ──────────────────────────────────────────────────────

type queuedQuery struct {
	cols []string
	rows [][]driver.Value
	err  error
}

type queuedExec struct {
	err             error
	rowsAffected    int64
	rowsAffectedErr error
	setRowsAffected bool
}

type delRowResult struct {
	rowsAffected    int64
	rowsAffectedErr error
}

type delRowState struct {
	mu sync.Mutex

	queries []queuedQuery
	execs   []queuedExec

	queryCalls []string
	queryArgs  [][]driver.NamedValue
	execCalls  []string
}

type delRowDriver struct{ state *delRowState }
type delRowConn struct{ state *delRowState }
type delRowTx struct{}
type delRowRows struct {
	cols []string
	rows [][]driver.Value
	idx  int
}

var delRowDriverRegisterMu sync.Mutex

func (d *delRowDriver) Open(string) (driver.Conn, error) {
	return &delRowConn{state: d.state}, nil
}

func (c *delRowConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("prepare not supported in delete row test driver")
}

func (c *delRowConn) Close() error              { return nil }
func (c *delRowConn) Begin() (driver.Tx, error) { return &delRowTx{}, nil }
func (c *delRowConn) BeginTx(context.Context, driver.TxOptions) (driver.Tx, error) {
	return &delRowTx{}, nil
}

func (*delRowTx) Commit() error   { return nil }
func (*delRowTx) Rollback() error { return nil }

func (r delRowResult) LastInsertId() (int64, error) { return 0, errors.New("not supported") }
func (r delRowResult) RowsAffected() (int64, error) {
	return r.rowsAffected, r.rowsAffectedErr
}

func (c *delRowConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if rows, ok := granttest.SnapshotQuery(query, args); ok {
		return rows, nil
	}
	c.state.mu.Lock()
	defer c.state.mu.Unlock()

	c.state.queryCalls = append(c.state.queryCalls, query)
	c.state.queryArgs = append(c.state.queryArgs, append([]driver.NamedValue(nil), args...))

	if len(c.state.queries) == 0 {
		return nil, fmt.Errorf("unexpected query: %s", query)
	}

	next := c.state.queries[0]
	c.state.queries = c.state.queries[1:]
	if next.err != nil {
		return nil, next.err
	}
	return &delRowRows{
		cols: append([]string(nil), next.cols...),
		rows: cloneRows(next.rows),
	}, nil
}

func (c *delRowConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	if granttest.IsPolicyLock(query) {
		return driver.RowsAffected(0), nil
	}
	c.state.mu.Lock()
	defer c.state.mu.Unlock()

	c.state.execCalls = append(c.state.execCalls, query)

	if len(c.state.execs) == 0 {
		return nil, fmt.Errorf("unexpected exec: %s", query)
	}

	next := c.state.execs[0]
	c.state.execs = c.state.execs[1:]
	if next.err != nil {
		return nil, next.err
	}
	if next.rowsAffectedErr != nil {
		return delRowResult{
			rowsAffected:    next.rowsAffected,
			rowsAffectedErr: next.rowsAffectedErr,
		}, nil
	}
	if next.setRowsAffected {
		return driver.RowsAffected(next.rowsAffected), nil
	}
	return driver.RowsAffected(1), nil
}

func (r *delRowRows) Columns() []string { return append([]string(nil), r.cols...) }
func (r *delRowRows) Close() error      { return nil }

func (r *delRowRows) Next(dest []driver.Value) error {
	if r.idx >= len(r.rows) {
		return io.EOF
	}
	copy(dest, r.rows[r.idx])
	r.idx++
	return nil
}

func cloneRows(rows [][]driver.Value) [][]driver.Value {
	cloned := make([][]driver.Value, len(rows))
	for i, row := range rows {
		cloned[i] = append([]driver.Value(nil), row...)
	}
	return cloned
}

func openDelRowTx(t *testing.T, queries []queuedQuery, execs []queuedExec) (*sql.DB, *sql.Tx, *delRowState) {
	t.Helper()
	granttest.ConfigureRoles(t)
	delRowDriverRegisterMu.Lock()
	defer delRowDriverRegisterMu.Unlock()

	state := &delRowState{
		queries: append([]queuedQuery(nil), queries...),
		execs:   append([]queuedExec(nil), execs...),
	}
	driverName := fmt.Sprintf("del_row_test_%d", time.Now().UnixNano())
	sql.Register(driverName, &delRowDriver{state: state})

	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	tx, err := db.Begin()
	if err != nil {
		_ = db.Close()
		t.Fatalf("db.Begin: %v", err)
	}

	t.Cleanup(func() {
		_ = tx.Rollback()
		_ = db.Close()
	})
	return db, tx, state
}

// ── handler guard tests (httptest) ─────────────────────────────────────
