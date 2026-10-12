// column_update_helpers_test.go
// Provides the shared database/sql driver double and column-update fixtures.
// Between column mutation and metadata synchronization tests and queued SQL responses.
// Keeps deterministic query and execution state defined once without PostgreSQL.
package dtt_2_column_update

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"testing"
	"time"
)

type queuedQuery struct {
	cols []string
	rows [][]driver.Value
	err  error
}

type queuedExec struct {
	err error
}

type colUpdateState struct {
	mu sync.Mutex

	queries []queuedQuery
	execs   []queuedExec

	actorRows  [][]driver.Value
	queryCalls []string
	execCalls  []string
}

type colUpdateDriver struct {
	state *colUpdateState
}

type colUpdateConn struct {
	state *colUpdateState
}

type colUpdateTx struct{}

type colUpdateRows struct {
	cols []string
	rows [][]driver.Value
	idx  int
}

var colUpdateDriverRegisterMu sync.Mutex

func (d *colUpdateDriver) Open(string) (driver.Conn, error) {
	return &colUpdateConn{state: d.state}, nil
}

func (c *colUpdateConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("prepare not supported in column update test driver")
}

func (c *colUpdateConn) Close() error { return nil }

func (c *colUpdateConn) Begin() (driver.Tx, error) {
	return &colUpdateTx{}, nil
}

func (c *colUpdateConn) BeginTx(context.Context, driver.TxOptions) (driver.Tx, error) {
	return &colUpdateTx{}, nil
}

func (*colUpdateTx) Commit() error { return nil }

func (*colUpdateTx) Rollback() error { return nil }

func (c *colUpdateConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	c.state.mu.Lock()
	defer c.state.mu.Unlock()

	c.state.queryCalls = append(c.state.queryCalls, query)
	if strings.Contains(query, "AS roles(actor_role)") {
		return &colUpdateRows{cols: []string{"column_name", "actor_role"}, rows: c.state.actorRows}, nil
	}

	if len(c.state.queries) == 0 {
		return nil, fmt.Errorf("unexpected query: %s", query)
	}

	next := c.state.queries[0]
	c.state.queries = c.state.queries[1:]
	if next.err != nil {
		return nil, next.err
	}
	return &colUpdateRows{
		cols: append([]string(nil), next.cols...),
		rows: cloneTestRows(next.rows),
	}, nil
}

func (c *colUpdateConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
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
	return driver.RowsAffected(1), nil
}

func (r *colUpdateRows) Columns() []string { return append([]string(nil), r.cols...) }

func (r *colUpdateRows) Close() error { return nil }

func (r *colUpdateRows) Next(dest []driver.Value) error {
	if r.idx >= len(r.rows) {
		return io.EOF
	}
	copy(dest, r.rows[r.idx])
	r.idx++
	return nil
}

func cloneTestRows(rows [][]driver.Value) [][]driver.Value {
	cloned := make([][]driver.Value, len(rows))
	for i, row := range rows {
		cloned[i] = append([]driver.Value(nil), row...)
	}
	return cloned
}

func openColUpdateDB(t *testing.T, queries []queuedQuery, execs []queuedExec) (*sql.DB, *colUpdateState) {
	t.Helper()
	colUpdateDriverRegisterMu.Lock()
	defer colUpdateDriverRegisterMu.Unlock()

	state := &colUpdateState{
		queries: append([]queuedQuery(nil), queries...),
		execs:   append([]queuedExec(nil), execs...),
	}
	driverName := fmt.Sprintf("col_update_test_%d", time.Now().UnixNano())
	sql.Register(driverName, &colUpdateDriver{state: state})

	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open returned error: %v", err)
	}
	db.SetMaxOpenConns(5)
	db.SetMaxIdleConns(5)

	t.Cleanup(func() { _ = db.Close() })
	return db, state
}

func openColUpdateTx(t *testing.T, queries []queuedQuery, execs []queuedExec) (*sql.DB, *sql.Tx, *colUpdateState) {
	t.Helper()
	db, state := openColUpdateDB(t, queries, execs)

	tx, err := db.Begin()
	if err != nil {
		t.Fatalf("db.Begin returned error: %v", err)
	}

	t.Cleanup(func() { _ = tx.Rollback() })
	return db, tx, state
}

// currentTypeQuery answers the stored-type lookup UpdateColumns makes before it
// decides whether a JSON column needs a conversion clause.
func currentTypeQuery(typeName string) queuedQuery {
	return queuedQuery{
		cols: []string{"format_type"},
		rows: [][]driver.Value{{typeName}},
	}
}

func goodSanitize(s string) (string, error) { return s, nil }

func rejectBadNames(s string) (string, error) {
	if strings.HasPrefix(s, "bad") {
		return "", fmt.Errorf("invalid identifier: %s", s)
	}
	return s, nil
}
