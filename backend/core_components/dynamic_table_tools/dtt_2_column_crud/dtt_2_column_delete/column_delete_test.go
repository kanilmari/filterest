// column_delete_test.go
// Unit tests for RemoveColumns.
// Uses a transactional database/sql driver double so the PK guard, drop statement, and lang cleanup interaction can be tested without a live PostgreSQL instance.
package dtt_2_column_delete

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

type queuedDeleteQuery struct {
	cols []string
	rows [][]driver.Value
	err  error
}

type queuedDeleteExec struct {
	err error
}

type deleteState struct {
	mu sync.Mutex

	queries []queuedDeleteQuery
	execs   []queuedDeleteExec

	execCalls []string
}

type deleteDriver struct {
	state *deleteState
}

type deleteConn struct {
	state *deleteState
}

type deleteTx struct{}

type deleteRows struct {
	cols []string
	rows [][]driver.Value
	idx  int
}

var deleteDriverRegisterMu sync.Mutex

func (d *deleteDriver) Open(string) (driver.Conn, error) {
	return &deleteConn{state: d.state}, nil
}

func (c *deleteConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("prepare not supported in column delete test driver")
}

func (c *deleteConn) Close() error { return nil }

func (c *deleteConn) Begin() (driver.Tx, error) {
	return &deleteTx{}, nil
}

func (c *deleteConn) BeginTx(context.Context, driver.TxOptions) (driver.Tx, error) {
	return &deleteTx{}, nil
}

func (*deleteTx) Commit() error   { return nil }
func (*deleteTx) Rollback() error { return nil }

func (c *deleteConn) Query(query string, args []driver.Value) (driver.Rows, error) {
	named := make([]driver.NamedValue, len(args))
	for i, arg := range args {
		named[i] = driver.NamedValue{Ordinal: i + 1, Value: arg}
	}
	return c.QueryContext(context.Background(), query, named)
}

func (c *deleteConn) QueryContext(_ context.Context, _ string, _ []driver.NamedValue) (driver.Rows, error) {
	c.state.mu.Lock()
	defer c.state.mu.Unlock()

	if len(c.state.queries) == 0 {
		return nil, errors.New("unexpected query")
	}

	next := c.state.queries[0]
	c.state.queries = c.state.queries[1:]
	if next.err != nil {
		return nil, next.err
	}
	return &deleteRows{
		cols: append([]string(nil), next.cols...),
		rows: cloneDeleteRows(next.rows),
	}, nil
}

func (c *deleteConn) Exec(query string, args []driver.Value) (driver.Result, error) {
	named := make([]driver.NamedValue, len(args))
	for i, arg := range args {
		named[i] = driver.NamedValue{Ordinal: i + 1, Value: arg}
	}
	return c.ExecContext(context.Background(), query, named)
}

func (c *deleteConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	c.state.mu.Lock()
	defer c.state.mu.Unlock()

	c.state.execCalls = append(c.state.execCalls, query)
	if len(c.state.execs) == 0 {
		return nil, errors.New("unexpected exec")
	}

	next := c.state.execs[0]
	c.state.execs = c.state.execs[1:]
	if next.err != nil {
		return nil, next.err
	}
	return driver.RowsAffected(1), nil
}

func (r *deleteRows) Columns() []string { return append([]string(nil), r.cols...) }
func (r *deleteRows) Close() error      { return nil }

func (r *deleteRows) Next(dest []driver.Value) error {
	if r.idx >= len(r.rows) {
		return io.EOF
	}
	copy(dest, r.rows[r.idx])
	r.idx++
	return nil
}

func cloneDeleteRows(rows [][]driver.Value) [][]driver.Value {
	cloned := make([][]driver.Value, len(rows))
	for i, row := range rows {
		cloned[i] = append([]driver.Value(nil), row...)
	}
	return cloned
}

func openDeleteTx(t *testing.T, queries []queuedDeleteQuery, execs []queuedDeleteExec) (*sql.DB, *sql.Tx, *deleteState) {
	t.Helper()
	deleteDriverRegisterMu.Lock()
	defer deleteDriverRegisterMu.Unlock()

	state := &deleteState{
		queries: append([]queuedDeleteQuery(nil), queries...),
		execs:   append([]queuedDeleteExec(nil), execs...),
	}
	driverName := fmt.Sprintf("column_delete_test_%d", time.Now().UnixNano())
	sql.Register(driverName, &deleteDriver{state: state})

	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open returned error: %v", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	tx, err := db.Begin()
	if err != nil {
		_ = db.Close()
		t.Fatalf("db.Begin returned error: %v", err)
	}

	t.Cleanup(func() {
		_ = tx.Rollback()
		_ = db.Close()
	})
	return db, tx, state
}

func TestRemoveColumnsPropagatesPrimaryKeyQueryError(t *testing.T) {
	_, tx, _ := openDeleteTx(t, []queuedDeleteQuery{
		{err: errors.New("pk boom")},
	}, nil)

	err := RemoveColumns(tx, "users", []string{"title"})
	if err == nil || err.Error() != "error fetching primary key columns: pk boom" {
		t.Fatalf("err = %v, want wrapped PK query error", err)
	}
}

func TestRemoveColumnsRejectsInvalidIdentifier(t *testing.T) {
	_, tx, state := openDeleteTx(t, []queuedDeleteQuery{
		{
			cols: []string{"attname"},
			rows: [][]driver.Value{{"id"}},
		},
	}, nil)

	err := RemoveColumns(tx, "users", []string{"bad-name"})
	if err == nil || err.Error() != "invalid identifier: bad-name" {
		t.Fatalf("err = %v, want invalid identifier error", err)
	}
	if len(state.execCalls) != 0 {
		t.Fatalf("exec calls = %d, want 0", len(state.execCalls))
	}
}

func TestRemoveColumnsBlocksPrimaryKeyDeletion(t *testing.T) {
	_, tx, state := openDeleteTx(t, []queuedDeleteQuery{
		{
			cols: []string{"attname"},
			rows: [][]driver.Value{{"title"}},
		},
	}, nil)

	err := RemoveColumns(tx, "users", []string{"title"})
	if err == nil || !strings.Contains(err.Error(), "it is a primary key") {
		t.Fatalf("err = %v, want PK guard error", err)
	}
	if len(state.execCalls) != 0 {
		t.Fatalf("exec calls = %d, want 0", len(state.execCalls))
	}
}

func TestRemoveColumnsPropagatesDropExecError(t *testing.T) {
	_, tx, state := openDeleteTx(t, []queuedDeleteQuery{
		{
			cols: []string{"attname"},
			rows: [][]driver.Value{{"id"}},
		},
	}, []queuedDeleteExec{
		{err: errors.New("drop boom")},
	})

	err := RemoveColumns(tx, "users", []string{"title"})
	if err == nil || err.Error() != "drop boom" {
		t.Fatalf("err = %v, want drop exec error", err)
	}
	if len(state.execCalls) != 1 || state.execCalls[0] != "ALTER TABLE users DROP COLUMN title" {
		t.Fatalf("exec calls = %#v, want drop statement", state.execCalls)
	}
}

func TestRemoveColumnsIgnoresLangCleanupFailure(t *testing.T) {
	_, tx, state := openDeleteTx(t, []queuedDeleteQuery{
		{
			cols: []string{"attname"},
			rows: [][]driver.Value{{"id"}},
		},
		{
			err: errors.New("cleanup boom"),
		},
	}, []queuedDeleteExec{
		{}, // ALTER TABLE DROP COLUMN
	})

	err := RemoveColumns(tx, "users", []string{"title"})
	if err != nil {
		t.Fatalf("RemoveColumns returned error: %v", err)
	}
	if len(state.execCalls) != 1 || state.execCalls[0] != "ALTER TABLE users DROP COLUMN title" {
		t.Fatalf("exec calls = %#v, want only drop statement", state.execCalls)
	}
}

func TestRemoveColumnsSuccessWithNoLangSources(t *testing.T) {
	_, tx, state := openDeleteTx(t, []queuedDeleteQuery{
		{
			cols: []string{"attname"},
			rows: [][]driver.Value{{"id"}},
		},
		{
			cols: []string{"lang_key_id"},
			rows: nil,
		},
	}, []queuedDeleteExec{
		{},
	})

	err := RemoveColumns(tx, "users", []string{"title"})
	if err != nil {
		t.Fatalf("RemoveColumns returned error: %v", err)
	}
	if len(state.execCalls) != 1 || state.execCalls[0] != "ALTER TABLE users DROP COLUMN title" {
		t.Fatalf("exec calls = %#v, want only drop statement", state.execCalls)
	}
}
