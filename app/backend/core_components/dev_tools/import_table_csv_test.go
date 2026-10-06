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
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"easelect/backend/core_components/runtime_grants/granttest"
	"easelect/backend/core_components/runtimepaths"
)

type stubDriver struct {
	actorRows   [][]driver.Value
	users       map[int64]bool
	userLookups int
	execArgs    [][]driver.NamedValue
	lastQuery   string
	lastArgs    []driver.NamedValue
}

func TestImportTableCSVSkipsOnlyRetiredColumnMetadata(t *testing.T) {
	for _, test := range []struct {
		name, table, csv string
		wantArgs         []interface{}
		wantLayout       bool
	}{
		{"first", "system_column_details", "label_value_layout,id,show_key_on_card,show_value_on_card\ninline,1,false,true\n", []interface{}{"1", "false", "true"}, false},
		{"middle", "system_column_details", "id,show_key_on_card,label_value_layout,show_value_on_card\n1,,stacked,false\n2,true,,true\n", []interface{}{"2", "true", "true"}, false},
		{"last", "system_column_details", "id,show_key_on_card,show_value_on_card,label_value_layout\n1,false,true,auto\n", []interface{}{"1", "false", "true"}, false},
		{"other table", "content", "id,label_value_layout\n1,inline\n", []interface{}{"1", "inline"}, true},
		{"other unknown column", "system_column_details", "id,unknown_metadata\n1,kept\n", []interface{}{"1", "kept"}, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			// system_column_details is policy metadata, so the import opens the grant boundary.
			granttest.ConfigureRoles(t)
			root := t.TempDir()
			paths, err := runtimepaths.Resolve(root, root, false)
			if err != nil {
				t.Fatal(err)
			}
			configureTableCSVRuntimePathsForTest(t, paths)
			if err := os.MkdirAll(tableCSVDataDir(), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(tableCSVFilePath(test.table), []byte(test.csv), 0o600); err != nil {
				t.Fatal(err)
			}
			drv := &stubDriver{}
			name := "retired-csv-" + t.Name()
			sql.Register(name, drv)
			db, err := sql.Open(name, "")
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			tx, err := db.Begin()
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			if _, _, err := ImportTableCSVTx(tx, test.table); err != nil {
				t.Fatal(err)
			}
			if strings.Contains(drv.lastQuery, "label_value_layout") != test.wantLayout {
				t.Fatalf("wrong retired-header handling: %s", drv.lastQuery)
			}
			got := make([]interface{}, len(drv.lastArgs))
			for i, value := range drv.lastArgs {
				got[i] = value.Value
			}
			if !reflect.DeepEqual(got, test.wantArgs) {
				t.Fatalf("values=%#v want=%#v", got, test.wantArgs)
			}
			if test.name == "middle" && drv.execArgs[0][1].Value != nil {
				t.Fatal("nullable visibility was not preserved")
			}
			if test.name == "other unknown column" && !strings.Contains(drv.lastQuery, "unknown_metadata") {
				t.Fatal("unknown column silently skipped")
			}
		})
	}
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
	// The grant boundary's lock statements are not the import's row writes.
	if granttest.IsPolicyLock(query) {
		return driver.RowsAffected(0), nil
	}
	c.drv.execArgs = append(c.drv.execArgs, append([]driver.NamedValue(nil), args...))
	c.drv.lastQuery = query
	c.drv.lastArgs = append([]driver.NamedValue(nil), args...)
	return driver.RowsAffected(1), nil
}

// QueryContext answers the restore's metadata lookups (which gallery a table belongs
// to) with no rows: the stub's tables have no pictures.
func (c *stubConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if strings.Contains(query, "AS roles(actor_role)") {
		return &csvActorRows{cols: []string{"column_name", "actor_role"}, rows: c.drv.actorRows}, nil
	}
	if strings.Contains(query, "FROM public.system_users WHERE id") {
		c.drv.userLookups++
		return &csvActorRows{cols: []string{"exists"}, rows: [][]driver.Value{{c.drv.users[args[0].Value.(int64)]}}}, nil
	}
	// A policy-metadata import reads an empty, valid grant catalogue.
	if result, ok := granttest.BoundaryQuery(query, args); ok {
		return result, nil
	}
	return &stubEmptyRows{}, nil
}

type stubEmptyRows struct{}

func (*stubEmptyRows) Columns() []string              { return []string{"table_name"} }
func (*stubEmptyRows) Close() error                   { return nil }
func (*stubEmptyRows) Next(dest []driver.Value) error { return io.EOF }

// stubTx implements driver.Tx.
type stubTx struct {
	conn *stubConn
}

func (t *stubTx) Commit() error   { return nil }
func (t *stubTx) Rollback() error { return nil }

func TestImportTableCSVTx_DoNothingOnEmptyUpdate(t *testing.T) {
	legacyRoot := t.TempDir()
	paths, err := runtimepaths.Resolve(legacyRoot, legacyRoot, false)
	if err != nil {
		t.Fatalf("resolve legacy runtime paths: %v", err)
	}
	configureTableCSVRuntimePathsForTest(t, paths)

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

	if err := os.MkdirAll(tableCSVDataDir(), 0o755); err != nil {
		t.Fatalf("failed to create tables_data: %v", err)
	}
	csvPath := tableCSVFilePath("test_table")
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
	if filepath.Dir(csvPath) != filepath.Join(legacyRoot, "tables_data") {
		t.Fatalf("legacy CSV directory = %q", filepath.Dir(csvPath))
	}
}
