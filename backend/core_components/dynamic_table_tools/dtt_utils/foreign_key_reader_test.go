// foreign_key_reader_test.go
// Regression tests for FK metadata reads with nested display-column lookups.
// Uses a database/sql driver double to prove the outer rows are released first.
package dtt_utils

import (
	"context"
	"database/sql"
	"database/sql/driver"
	backend "easelect/backend/core_components"
	"fmt"
	"io"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

type fkReaderDriver struct{ state *fkReaderState }
type fkReaderConn struct{ state *fkReaderState }
type fkReaderRows struct {
	state *fkReaderState
	cols  []string
	rows  [][]driver.Value
	index int
	outer bool
}

type fkReaderState struct {
	mu            sync.Mutex
	outerRowsOpen bool
}

var fkReaderDriverCounter int64

func (d *fkReaderDriver) Open(string) (driver.Conn, error) {
	return &fkReaderConn{state: d.state}, nil
}

func (c *fkReaderConn) Prepare(string) (driver.Stmt, error) {
	return nil, fmt.Errorf("prepare not implemented in FK reader test driver")
}

func (c *fkReaderConn) Close() error { return nil }
func (c *fkReaderConn) Begin() (driver.Tx, error) {
	return nil, fmt.Errorf("transactions not implemented")
}

func (c *fkReaderConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	c.state.mu.Lock()
	defer c.state.mu.Unlock()

	switch {
	case strings.Contains(query, "information_schema.table_constraints"):
		c.state.outerRowsOpen = true
		return &fkReaderRows{
			state: c.state,
			cols:  []string{"referencing_column", "referenced_table", "referenced_column"},
			rows:  [][]driver.Value{{"service_id", "services", "id"}},
			outer: true,
		}, nil
	case c.state.outerRowsOpen:
		return nil, fmt.Errorf("nested FK display lookup started before outer rows closed")
	case strings.Contains(query, "SELECT fk_display_column"):
		return &fkReaderRows{state: c.state, cols: []string{"fk_display_column"}}, nil
	case strings.Contains(query, "SELECT column_name FROM information_schema.columns"):
		return &fkReaderRows{
			state: c.state,
			cols:  []string{"column_name"},
			rows:  [][]driver.Value{{"name"}},
		}, nil
	default:
		return nil, fmt.Errorf("unexpected query: %s", query)
	}
}

func (r *fkReaderRows) Columns() []string { return append([]string(nil), r.cols...) }

func (r *fkReaderRows) Close() error {
	if r.outer {
		r.state.mu.Lock()
		r.state.outerRowsOpen = false
		r.state.mu.Unlock()
	}
	return nil
}

func (r *fkReaderRows) Next(dest []driver.Value) error {
	if r.index >= len(r.rows) {
		return io.EOF
	}
	copy(dest, r.rows[r.index])
	r.index++
	return nil
}

func TestGetForeignKeysForTableClosesOuterRowsBeforeDisplayLookup(t *testing.T) {
	state := &fkReaderState{}
	driverName := fmt.Sprintf("fk-reader-test-%d", atomic.AddInt64(&fkReaderDriverCounter, 1))
	sql.Register(driverName, &fkReaderDriver{state: state})
	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	originalDB := backend.Db
	backend.Db = db
	t.Cleanup(func() { backend.Db = originalDB })

	foreignKeys, err := GetForeignKeysForTable("tickets")
	if err != nil {
		t.Fatalf("GetForeignKeysForTable: %v", err)
	}
	foreignKey, ok := foreignKeys["service_id"]
	if !ok {
		t.Fatalf("missing service_id FK: %#v", foreignKeys)
	}
	if foreignKey.NameColumn != "name" {
		t.Fatalf("NameColumn = %q, want name", foreignKey.NameColumn)
	}
}
