// primary_key_guard_test.go
// Unit tests for primary key guard helpers used by dynamic schema mutations.
// Uses a scripted database/sql driver so the guard logic can be verified without a live PostgreSQL instance.
package dtt_2_column_crud

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"sync"
	"testing"
	"time"
)

type pkGuardDriver struct {
	query queuedPKQuery
}

type pkGuardConn struct {
	driver *pkGuardDriver
}

type pkGuardTx struct{}

type queuedPKQuery struct {
	cols []string
	rows [][]driver.Value
	err  error
}

type pkGuardRows struct {
	cols []string
	rows [][]driver.Value
	idx  int
}

var pkDriverRegisterMu sync.Mutex

func (d *pkGuardDriver) Open(_ string) (driver.Conn, error) {
	return &pkGuardConn{driver: d}, nil
}

func (c *pkGuardConn) Prepare(_ string) (driver.Stmt, error) {
	return nil, errors.New("prepare not supported")
}

func (c *pkGuardConn) Close() error { return nil }

func (c *pkGuardConn) Begin() (driver.Tx, error) {
	return &pkGuardTx{}, nil
}

func (c *pkGuardConn) QueryContext(_ context.Context, _ string, _ []driver.NamedValue) (driver.Rows, error) {
	if c.driver.query.err != nil {
		return nil, c.driver.query.err
	}
	return &pkGuardRows{cols: c.driver.query.cols, rows: c.driver.query.rows}, nil
}

func (tx *pkGuardTx) Commit() error   { return nil }
func (tx *pkGuardTx) Rollback() error { return nil }

func (r *pkGuardRows) Columns() []string { return r.cols }
func (r *pkGuardRows) Close() error      { return nil }

func (r *pkGuardRows) Next(dest []driver.Value) error {
	if r.idx >= len(r.rows) {
		return io.EOF
	}
	copy(dest, r.rows[r.idx])
	r.idx++
	return nil
}

func newPrimaryKeyGuardTestDB(t *testing.T, query queuedPKQuery) *sql.DB {
	t.Helper()
	pkDriverRegisterMu.Lock()
	defer pkDriverRegisterMu.Unlock()

	name := fmt.Sprintf("pk_guard_test_%d", time.Now().UnixNano())
	sql.Register(name, &pkGuardDriver{query: query})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	return db
}

func beginPrimaryKeyGuardTx(t *testing.T, query queuedPKQuery) (*sql.DB, *sql.Tx) {
	t.Helper()
	db := newPrimaryKeyGuardTestDB(t, query)
	tx, err := db.Begin()
	if err != nil {
		db.Close()
		t.Fatalf("db.Begin: %v", err)
	}
	return db, tx
}

func TestGetPrimaryKeyColumns_ReturnsLowerCasedColumnNames(t *testing.T) {
	db, tx := beginPrimaryKeyGuardTx(t, queuedPKQuery{
		cols: []string{"attname"},
		rows: [][]driver.Value{{"ID"}, {"Tenant_ID"}},
	})
	defer db.Close()
	defer tx.Rollback()

	pkCols, err := GetPrimaryKeyColumns(tx, "example_table")
	if err != nil {
		t.Fatalf("GetPrimaryKeyColumns returned error: %v", err)
	}
	if _, ok := pkCols["id"]; !ok {
		t.Fatalf("expected primary key columns to include id, got %#v", pkCols)
	}
	if _, ok := pkCols["tenant_id"]; !ok {
		t.Fatalf("expected primary key columns to include tenant_id, got %#v", pkCols)
	}
}

func TestEnsureTableHasPrimaryKey_ReturnsValidationErrorWhenMissing(t *testing.T) {
	db, tx := beginPrimaryKeyGuardTx(t, queuedPKQuery{
		cols: []string{"attname"},
		rows: nil,
	})
	defer db.Close()
	defer tx.Rollback()

	err := EnsureTableHasPrimaryKey(tx, "example_table")
	var missingErr *ErrTableMissingPrimaryKey
	if !errors.As(err, &missingErr) {
		t.Fatalf("expected ErrTableMissingPrimaryKey, got %v", err)
	}
}

func TestEnsureTableHasPrimaryKey_PropagatesQueryError(t *testing.T) {
	db, tx := beginPrimaryKeyGuardTx(t, queuedPKQuery{
		err: errors.New("boom"),
	})
	defer db.Close()
	defer tx.Rollback()

	err := EnsureTableHasPrimaryKey(tx, "example_table")
	if err == nil || err.Error() != "error fetching primary key columns: boom" {
		t.Fatalf("expected wrapped query error, got %v", err)
	}
}