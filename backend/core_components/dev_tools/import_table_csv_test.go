// import_table_csv_test.go
// Backend tests for the CSV import helper used by dev-tools table imports.
// Bridges stub SQL drivers, temporary CSV fixtures, and ImportTableCSVTx behavior.
// Exists to keep import conflict handling stable during documentation and refactor passes.

package devtools

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"os"
	"strings"
	"testing"
)

type stubDriver struct {
	lastQuery string
	lastArgs  []driver.NamedValue
}

func (d *stubDriver) Open(name string) (driver.Conn, error) {
	return &stubConn{drv: d}, nil
}

type stubConn struct {
	drv *stubDriver
}

func (c *stubConn) Close() error { return nil }
func (c *stubConn) Prepare(query string) (driver.Stmt, error) {
	return nil, errors.New("not implemented")
}
func (c *stubConn) Begin() (driver.Tx, error) { return &stubTx{conn: c}, nil }
func (c *stubConn) BeginTx(ctx context.Context, opts driver.TxOptions) (driver.Tx, error) {
	return &stubTx{conn: c}, nil
}
func (c *stubConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	c.drv.lastQuery = query
	c.drv.lastArgs = append([]driver.NamedValue(nil), args...)
	return driver.RowsAffected(1), nil
}
func (c *stubConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	return nil, errors.New("not implemented")
}

// stubTx implements driver.Tx.
type stubTx struct {
	conn *stubConn
}

func (t *stubTx) Commit() error   { return nil }
func (t *stubTx) Rollback() error { return nil }

func TestImportTableCSVTx_DoNothingOnEmptyUpdate(t *testing.T) {
	drv := &stubDriver{}
	sql.Register("stub", drv)
	db, err := sql.Open("stub", "")
	if err != nil {
		t.Fatalf("sql open failed: %v", err)
	}
	defer db.Close()

	tx, err := db.Begin()
	if err != nil {
		t.Fatalf("begin failed: %v", err)
	}

	if err := os.MkdirAll("tables_data", 0o755); err != nil {
		t.Fatalf("failed to create tables_data: %v", err)
	}
	csvPath := "tables_data/test_table.csv"
	data := "id,created,updated\n1,2025-08-14,2025-08-14\n"
	if err := os.WriteFile(csvPath, []byte(data), 0o644); err != nil {
		t.Fatalf("failed to write csv: %v", err)
	}
	defer os.Remove(csvPath)

	if _, _, err := ImportTableCSVTx(tx, "test_table"); err != nil {
		t.Fatalf("ImportTableCSVTx returned error: %v", err)
	}
	if !strings.Contains(drv.lastQuery, "DO NOTHING") {
		t.Fatalf("expected query to use DO NOTHING, got %s", drv.lastQuery)
	}
	if len(drv.lastArgs) != 3 {
		t.Fatalf("expected 3 args, got %d", len(drv.lastArgs))
	}
}
