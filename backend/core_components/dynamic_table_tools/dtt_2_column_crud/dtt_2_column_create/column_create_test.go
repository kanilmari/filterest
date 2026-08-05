// column_create_test.go
// Unit tests for AddNewColumns.
// Uses a tiny database/sql driver double so the ALTER TABLE statements can be verified without a live PostgreSQL instance.
package dtt_2_column_create

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	dtt_2_column_crud "easelect/backend/core_components/dynamic_table_tools/dtt_2_column_crud"
	"sync"
	"testing"
	"time"
)

type addColumnsExecResponse struct {
	err error
}

type addColumnsExecCall struct {
	query string
	args  []driver.NamedValue
}

type addColumnsState struct {
	mu sync.Mutex

	execs     []addColumnsExecResponse
	execCalls []addColumnsExecCall
}

type addColumnsDriver struct {
	state *addColumnsState
}

type addColumnsConn struct {
	state *addColumnsState
}

type addColumnsTx struct{}

var addColumnsDriverRegisterMu sync.Mutex

func (d *addColumnsDriver) Open(_ string) (driver.Conn, error) {
	return &addColumnsConn{state: d.state}, nil
}

func (c *addColumnsConn) Prepare(_ string) (driver.Stmt, error) {
	return nil, errors.New("prepare not supported")
}

func (c *addColumnsConn) Close() error { return nil }

func (c *addColumnsConn) Begin() (driver.Tx, error) {
	return &addColumnsTx{}, nil
}

func (c *addColumnsConn) BeginTx(context.Context, driver.TxOptions) (driver.Tx, error) {
	return &addColumnsTx{}, nil
}

func (*addColumnsTx) Commit() error   { return nil }
func (*addColumnsTx) Rollback() error { return nil }

func (c *addColumnsConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	c.state.mu.Lock()
	defer c.state.mu.Unlock()

	c.state.execCalls = append(c.state.execCalls, addColumnsExecCall{
		query: query,
		args:  append([]driver.NamedValue(nil), args...),
	})

	if len(c.state.execs) == 0 {
		return nil, fmt.Errorf("unexpected exec: %s", query)
	}

	resp := c.state.execs[0]
	c.state.execs = c.state.execs[1:]
	if resp.err != nil {
		return nil, resp.err
	}
	return driver.RowsAffected(1), nil
}

func openAddColumnsTestTx(t *testing.T, execs []addColumnsExecResponse) (*sql.DB, *sql.Tx, *addColumnsState) {
	t.Helper()
	addColumnsDriverRegisterMu.Lock()
	defer addColumnsDriverRegisterMu.Unlock()

	state := &addColumnsState{
		execs: append([]addColumnsExecResponse(nil), execs...),
	}
	driverName := fmt.Sprintf("add_columns_test_%d", time.Now().UnixNano())
	sql.Register(driverName, &addColumnsDriver{state: state})

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

func TestAddNewColumnsReturnsNilForEmptySlice(t *testing.T) {
	if err := AddNewColumns(nil, "users", nil); err != nil {
		t.Fatalf("AddNewColumns returned error for empty slice: %v", err)
	}
}

func TestAddNewColumnsRejectsInvalidIdentifier(t *testing.T) {
	_, tx, state := openAddColumnsTestTx(t, nil)

	err := AddNewColumns(tx, "users", []dtt_2_column_crud.ModifiedCol{
		{NewName: "bad-name", DataType: "text"},
	})
	if err == nil || err.Error() != "invalid identifier: bad-name" {
		t.Fatalf("err = %v, want invalid identifier error", err)
	}
	if len(state.execCalls) != 0 {
		t.Fatalf("exec calls = %d, want 0", len(state.execCalls))
	}
}

func TestAddNewColumnsBuildsExpectedStatements(t *testing.T) {
	varcharLength := 255
	_, tx, state := openAddColumnsTestTx(t, []addColumnsExecResponse{{}, {}})

	err := AddNewColumns(tx, "users", []dtt_2_column_crud.ModifiedCol{
		{NewName: "title", DataType: "varchar", Length: &varcharLength},
		{NewName: "is_active", DataType: "boolean"},
	})
	if err != nil {
		t.Fatalf("AddNewColumns returned error: %v", err)
	}

	if len(state.execCalls) != 2 {
		t.Fatalf("exec calls = %d, want 2", len(state.execCalls))
	}

	if got := state.execCalls[0].query; got != "ALTER TABLE users ADD COLUMN title VARCHAR(255)" {
		t.Fatalf("first query = %q, want VARCHAR statement", got)
	}
	if got := state.execCalls[1].query; got != "ALTER TABLE users ADD COLUMN is_active BOOLEAN" {
		t.Fatalf("second query = %q, want BOOLEAN statement", got)
	}
}

func TestAddNewColumnsPropagatesExecError(t *testing.T) {
	wantErr := errors.New("exec boom")
	_, tx, state := openAddColumnsTestTx(t, []addColumnsExecResponse{
		{err: wantErr},
	})

	err := AddNewColumns(tx, "users", []dtt_2_column_crud.ModifiedCol{
		{NewName: "title", DataType: "text"},
	})
	if !errors.Is(err, wantErr) {
		t.Fatalf("err = %v, want %v", err, wantErr)
	}
	if len(state.execCalls) != 1 {
		t.Fatalf("exec calls = %d, want 1", len(state.execCalls))
	}
}
