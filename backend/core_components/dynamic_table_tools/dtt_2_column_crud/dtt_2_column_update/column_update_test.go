// column_update_test.go
// Unit tests for UpdateColumns, UpdateColumnMetadata, and nilIfEmpty.
// Uses a database/sql driver double so ALTER TABLE and metadata sync operations can be verified without a live PostgreSQL instance.
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

	dtt_2_column_crud "easelect/backend/core_components/dynamic_table_tools/dtt_2_column_crud"
)

// ── driver double ──────────────────────────────────────────────────────

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

func (*colUpdateTx) Commit() error   { return nil }
func (*colUpdateTx) Rollback() error { return nil }

func (c *colUpdateConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	c.state.mu.Lock()
	defer c.state.mu.Unlock()

	c.state.queryCalls = append(c.state.queryCalls, query)

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
func (r *colUpdateRows) Close() error      { return nil }

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

// ── sanitize helpers ───────────────────────────────────────────────────

func goodSanitize(s string) (string, error) { return s, nil }

func rejectBadNames(s string) (string, error) {
	if strings.HasPrefix(s, "bad") {
		return "", fmt.Errorf("invalid identifier: %s", s)
	}
	return s, nil
}

// ── nilIfEmpty tests ───────────────────────────────────────────────────

func TestNilIfEmptyReturnsPointerForValidString(t *testing.T) {
	result := nilIfEmpty(sql.NullString{String: "text", Valid: true})
	if result == nil || *result != "text" {
		t.Fatalf("nilIfEmpty(Valid) = %v, want pointer to \"text\"", result)
	}
}

func TestNilIfEmptyReturnsNilForInvalidString(t *testing.T) {
	result := nilIfEmpty(sql.NullString{Valid: false})
	if result != nil {
		t.Fatalf("nilIfEmpty(Invalid) = %v, want nil", result)
	}
}

// ── UpdateColumns tests ────────────────────────────────────────────────

func TestUpdateColumnsReturnsNilForEmptySlice(t *testing.T) {
	_, tx, _ := openColUpdateTx(t, nil, nil)

	err := UpdateColumns(tx, "users", nil, goodSanitize)
	if err != nil {
		t.Fatalf("UpdateColumns returned error for empty slice: %v", err)
	}
}

func TestUpdateColumnsRejectsInvalidOriginalName(t *testing.T) {
	_, tx, state := openColUpdateTx(t, nil, nil)

	err := UpdateColumns(tx, "users", []dtt_2_column_crud.ModifiedCol{
		{OriginalName: "bad-orig", NewName: "new_col", DataType: "text"},
	}, rejectBadNames)
	if err == nil || !strings.Contains(err.Error(), "invalid identifier: bad-orig") {
		t.Fatalf("err = %v, want invalid identifier error for original name", err)
	}
	if len(state.execCalls) != 0 {
		t.Fatalf("exec calls = %d, want 0", len(state.execCalls))
	}
}

func TestUpdateColumnsRejectsInvalidNewName(t *testing.T) {
	_, tx, state := openColUpdateTx(t, nil, nil)

	err := UpdateColumns(tx, "users", []dtt_2_column_crud.ModifiedCol{
		{OriginalName: "ok_orig", NewName: "bad-new", DataType: "text"},
	}, rejectBadNames)
	if err == nil || !strings.Contains(err.Error(), "invalid identifier: bad-new") {
		t.Fatalf("err = %v, want invalid identifier error for new name", err)
	}
	if len(state.execCalls) != 0 {
		t.Fatalf("exec calls = %d, want 0", len(state.execCalls))
	}
}

func TestUpdateColumnsRenameAndTypeChangeHappyPath(t *testing.T) {
	// Rename: ALTER TABLE RENAME COLUMN → exec 1
	// Lang source_low update → exec 2
	// Lang column_value source_high update → exec 3
	// Lang usage_explanation update → exec 4
	// Lang column_value usage_explanation update → exec 5
	// Type change: ALTER TABLE ALTER COLUMN TYPE → exec 6
	_, tx, state := openColUpdateTx(t, nil, []queuedExec{{}, {}, {}, {}, {}, {}})

	err := UpdateColumns(tx, "users", []dtt_2_column_crud.ModifiedCol{
		{OriginalName: "old_col", NewName: "new_col", DataType: "text"},
	}, goodSanitize)
	if err != nil {
		t.Fatalf("UpdateColumns returned error: %v", err)
	}

	if len(state.execCalls) != 6 {
		t.Fatalf("exec calls = %d, want 6", len(state.execCalls))
	}
	if got := state.execCalls[0]; got != "ALTER TABLE users RENAME COLUMN old_col TO new_col" {
		t.Fatalf("exec[0] = %q, want RENAME statement", got)
	}
	if got := state.execCalls[5]; got != "ALTER TABLE users ALTER COLUMN new_col TYPE TEXT" {
		t.Fatalf("exec[5] = %q, want ALTER TYPE statement", got)
	}
}

func TestUpdateColumnsSameNameTypeOnly(t *testing.T) {
	_, tx, state := openColUpdateTx(t, nil, []queuedExec{{}})

	err := UpdateColumns(tx, "users", []dtt_2_column_crud.ModifiedCol{
		{OriginalName: "col", NewName: "col", DataType: "boolean"},
	}, goodSanitize)
	if err != nil {
		t.Fatalf("UpdateColumns returned error: %v", err)
	}

	if len(state.execCalls) != 1 {
		t.Fatalf("exec calls = %d, want 1", len(state.execCalls))
	}
	if got := state.execCalls[0]; got != "ALTER TABLE users ALTER COLUMN col TYPE BOOLEAN" {
		t.Fatalf("exec[0] = %q, want BOOLEAN type change", got)
	}
}

func TestUpdateColumnsVarcharWithLength(t *testing.T) {
	length := 255
	_, tx, state := openColUpdateTx(t, nil, []queuedExec{{}})

	err := UpdateColumns(tx, "users", []dtt_2_column_crud.ModifiedCol{
		{OriginalName: "col", NewName: "col", DataType: "varchar", Length: &length},
	}, goodSanitize)
	if err != nil {
		t.Fatalf("UpdateColumns returned error: %v", err)
	}

	if len(state.execCalls) != 1 {
		t.Fatalf("exec calls = %d, want 1", len(state.execCalls))
	}
	if got := state.execCalls[0]; got != "ALTER TABLE users ALTER COLUMN col TYPE VARCHAR(255)" {
		t.Fatalf("exec[0] = %q, want VARCHAR(255) type change", got)
	}
}

func TestUpdateColumnsPropagatesRenameExecError(t *testing.T) {
	wantErr := errors.New("rename boom")
	_, tx, _ := openColUpdateTx(t, nil, []queuedExec{{err: wantErr}})

	err := UpdateColumns(tx, "users", []dtt_2_column_crud.ModifiedCol{
		{OriginalName: "old_col", NewName: "new_col", DataType: "text"},
	}, goodSanitize)
	if !errors.Is(err, wantErr) {
		t.Fatalf("err = %v, want %v", err, wantErr)
	}
}

func TestUpdateColumnsPropagatesTypeChangeExecError(t *testing.T) {
	wantErr := errors.New("type boom")
	_, tx, _ := openColUpdateTx(t, nil, []queuedExec{{err: wantErr}})

	err := UpdateColumns(tx, "users", []dtt_2_column_crud.ModifiedCol{
		{OriginalName: "col", NewName: "col", DataType: "text"},
	}, goodSanitize)
	if !errors.Is(err, wantErr) {
		t.Fatalf("err = %v, want %v", err, wantErr)
	}
}

func TestUpdateColumnsIgnoresLangCleanupFailure(t *testing.T) {
	// Rename exec succeeds, lang 1st exec fails → non-fatal, type exec succeeds
	_, tx, state := openColUpdateTx(t, nil, []queuedExec{
		{},                                    // ALTER RENAME
		{err: errors.New("lang source boom")}, // lang source_low update fails → non-fatal
		{},                                    // ALTER TYPE
	})

	err := UpdateColumns(tx, "users", []dtt_2_column_crud.ModifiedCol{
		{OriginalName: "old_col", NewName: "new_col", DataType: "text"},
	}, goodSanitize)
	if err != nil {
		t.Fatalf("UpdateColumns returned error: %v", err)
	}

	if len(state.execCalls) != 3 {
		t.Fatalf("exec calls = %d, want 3 (rename + failed lang + type)", len(state.execCalls))
	}
}

// ── UpdateColumnMetadata tests ─────────────────────────────────────────

func TestUpdateColumnMetadataPropagatesCleanupError(t *testing.T) {
	db, _ := openColUpdateDB(t, nil, []queuedExec{
		{err: errors.New("cleanup boom")},
	})

	err := UpdateColumnMetadata(db)
	if err == nil || !strings.Contains(err.Error(), "error cleaning up obsolete entries") {
		t.Fatalf("err = %v, want wrapped cleanup error", err)
	}
}

func TestUpdateColumnMetadataPropagatesTablesQueryError(t *testing.T) {
	db, _ := openColUpdateDB(t, []queuedQuery{
		{err: errors.New("tables boom")},
	}, []queuedExec{
		{}, // cleanup succeeds
	})

	err := UpdateColumnMetadata(db)
	if err == nil || !strings.Contains(err.Error(), "error fetching tables") {
		t.Fatalf("err = %v, want wrapped tables query error", err)
	}
}

func TestUpdateColumnMetadataNoTablesReturnsNil(t *testing.T) {
	db, state := openColUpdateDB(t, []queuedQuery{
		{cols: []string{"table_name", "table_uid"}, rows: nil},
	}, []queuedExec{
		{}, // cleanup
	})

	err := UpdateColumnMetadata(db)
	if err != nil {
		t.Fatalf("UpdateColumnMetadata returned error: %v", err)
	}
	if len(state.execCalls) != 1 {
		t.Fatalf("exec calls = %d, want 1 (cleanup only)", len(state.execCalls))
	}
}

func TestUpdateColumnMetadataUsesNonAbortingRegclassLookup(t *testing.T) {
	db, state := openColUpdateDB(t, []queuedQuery{
		{
			cols: []string{"table_name", "table_uid"},
			rows: [][]driver.Value{{"concurrently_deleted_table", int64(1)}},
		},
		{
			cols: []string{"attname", "attnum", "data_type"},
			rows: nil, // to_regclass(NULL) represents the table disappearing mid-sync
		},
		{
			cols: []string{"column_name", "column_uid", "data_type"},
			rows: nil,
		},
	}, []queuedExec{{}})

	if err := UpdateColumnMetadata(db); err != nil {
		t.Fatalf("UpdateColumnMetadata returned error: %v", err)
	}
	if len(state.queryCalls) != 3 {
		t.Fatalf("query calls = %d, want 3", len(state.queryCalls))
	}
	columnsQuery := state.queryCalls[1]
	if !strings.Contains(columnsQuery, "pg_catalog.to_regclass($1)") {
		t.Fatalf("columns query = %q, want parameterized to_regclass lookup", columnsQuery)
	}
	if strings.Contains(columnsQuery, "::regclass") {
		t.Fatalf("columns query = %q, direct regclass cast can abort on a concurrent delete", columnsQuery)
	}
}

func TestUpdateColumnMetadataPropagatesPerTableQueryErrors(t *testing.T) {
	tests := []struct {
		name       string
		queries    []queuedQuery
		wantDetail string
	}{
		{
			name: "columns query",
			queries: []queuedQuery{
				{cols: []string{"table_name", "table_uid"}, rows: [][]driver.Value{{"test_table", int64(1)}}},
				{err: errors.New("columns boom")},
			},
			wantDetail: "error fetching columns for table test_table",
		},
		{
			name: "columns scan",
			queries: []queuedQuery{
				{cols: []string{"table_name", "table_uid"}, rows: [][]driver.Value{{"test_table", int64(1)}}},
				{cols: []string{"attname", "attnum", "data_type"}, rows: [][]driver.Value{{"id", "not-an-integer", "integer"}}},
			},
			wantDetail: "error scanning column info for table test_table",
		},
		{
			name: "metadata query",
			queries: []queuedQuery{
				{cols: []string{"table_name", "table_uid"}, rows: [][]driver.Value{{"test_table", int64(1)}}},
				{cols: []string{"attname", "attnum", "data_type"}, rows: nil},
				{err: errors.New("metadata boom")},
			},
			wantDetail: "error fetching metadata for table test_table",
		},
		{
			name: "metadata scan",
			queries: []queuedQuery{
				{cols: []string{"table_name", "table_uid"}, rows: [][]driver.Value{{"test_table", int64(1)}}},
				{cols: []string{"attname", "attnum", "data_type"}, rows: nil},
				{cols: []string{"column_name", "column_uid", "data_type"}, rows: [][]driver.Value{{"id", "not-an-integer", "integer"}}},
			},
			wantDetail: "error scanning metadata for table test_table",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db, _ := openColUpdateDB(t, tt.queries, []queuedExec{{}})
			err := UpdateColumnMetadata(db)
			if err == nil || !strings.Contains(err.Error(), tt.wantDetail) {
				t.Fatalf("err = %v, want detail %q", err, tt.wantDetail)
			}
		})
	}
}

func TestUpdateColumnMetadataStopsAfterMetadataMutationError(t *testing.T) {
	tests := []struct {
		name       string
		columns    [][]driver.Value
		metadata   [][]driver.Value
		wantDetail string
	}{
		{
			name:       "update",
			columns:    [][]driver.Value{{"id", int64(1), "integer"}},
			metadata:   [][]driver.Value{{"id", int64(10), "integer"}},
			wantDetail: "error updating system_column_details",
		},
		{
			name:       "insert",
			columns:    [][]driver.Value{{"new_col", int64(2), "text"}},
			metadata:   nil,
			wantDetail: "error inserting into system_column_details",
		},
		{
			name:       "delete",
			columns:    nil,
			metadata:   [][]driver.Value{{"old_col", int64(11), "text"}},
			wantDetail: "error deleting from system_column_details",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db, state := openColUpdateDB(t, []queuedQuery{
				{cols: []string{"table_name", "table_uid"}, rows: [][]driver.Value{{"test_table", int64(1)}}},
				{cols: []string{"attname", "attnum", "data_type"}, rows: tt.columns},
				{cols: []string{"column_name", "column_uid", "data_type"}, rows: tt.metadata},
			}, []queuedExec{
				{},
				{err: errors.New("mutation boom")},
				{}, // must remain unused: a failed transaction cannot accept more work
			})

			err := UpdateColumnMetadata(db)
			if err == nil || !strings.Contains(err.Error(), tt.wantDetail) {
				t.Fatalf("err = %v, want detail %q", err, tt.wantDetail)
			}
			if len(state.execCalls) != 2 {
				t.Fatalf("exec calls = %d, want cleanup plus one failed mutation", len(state.execCalls))
			}
		})
	}
}

func TestUpdateColumnMetadataUpdatesExistingColumn(t *testing.T) {
	db, state := openColUpdateDB(t, []queuedQuery{
		// tables
		{
			cols: []string{"table_name", "table_uid"},
			rows: [][]driver.Value{{"test_table", int64(1)}},
		},
		// pg_attribute → "id" exists
		{
			cols: []string{"attname", "attnum", "data_type"},
			rows: [][]driver.Value{{"id", int64(1), "integer"}},
		},
		// metadata → "id" already tracked (triggers update path)
		{
			cols: []string{"column_name", "column_uid", "data_type"},
			rows: [][]driver.Value{{"id", int64(10), "integer"}},
		},
	}, []queuedExec{
		{}, // cleanup
		{}, // UPDATE system_column_details
	})

	err := UpdateColumnMetadata(db)
	if err != nil {
		t.Fatalf("UpdateColumnMetadata returned error: %v", err)
	}
	if len(state.execCalls) != 2 {
		t.Fatalf("exec calls = %d, want 2 (cleanup + update)", len(state.execCalls))
	}
	if !strings.Contains(state.execCalls[1], "UPDATE system_column_details") {
		t.Fatalf("exec[1] = %q, want UPDATE", state.execCalls[1])
	}
	if !strings.Contains(state.execCalls[1], "card_element") {
		t.Fatalf("exec[1] = %q, want card_element backfill in UPDATE", state.execCalls[1])
	}
}

func TestUpdateColumnMetadataInsertsNewColumn(t *testing.T) {
	db, state := openColUpdateDB(t, []queuedQuery{
		{
			cols: []string{"table_name", "table_uid"},
			rows: [][]driver.Value{{"test_table", int64(1)}},
		},
		{
			cols: []string{"attname", "attnum", "data_type"},
			rows: [][]driver.Value{{"new_col", int64(2), "text"}},
		},
		{
			cols: []string{"column_name", "column_uid", "data_type"},
			rows: nil, // no existing metadata
		},
	}, []queuedExec{
		{}, // cleanup
		{}, // INSERT into system_column_details
	})

	err := UpdateColumnMetadata(db)
	if err != nil {
		t.Fatalf("UpdateColumnMetadata returned error: %v", err)
	}
	if len(state.execCalls) != 2 {
		t.Fatalf("exec calls = %d, want 2 (cleanup + insert)", len(state.execCalls))
	}
	if !strings.Contains(state.execCalls[1], "INSERT INTO system_column_details") {
		t.Fatalf("exec[1] = %q, want INSERT", state.execCalls[1])
	}
	if !strings.Contains(state.execCalls[1], "card_element") {
		t.Fatalf("exec[1] = %q, want explicit card_element default in INSERT", state.execCalls[1])
	}
}

func TestUpdateColumnMetadataDeletesRemovedColumn(t *testing.T) {
	db, state := openColUpdateDB(t, []queuedQuery{
		{
			cols: []string{"table_name", "table_uid"},
			rows: [][]driver.Value{{"test_table", int64(1)}},
		},
		{
			cols: []string{"attname", "attnum", "data_type"},
			rows: nil, // no pg columns
		},
		{
			cols: []string{"column_name", "column_uid", "data_type"},
			rows: [][]driver.Value{{"old_col", int64(11), "text"}},
		},
	}, []queuedExec{
		{}, // cleanup
		{}, // DELETE from system_column_details
	})

	err := UpdateColumnMetadata(db)
	if err != nil {
		t.Fatalf("UpdateColumnMetadata returned error: %v", err)
	}
	if len(state.execCalls) != 2 {
		t.Fatalf("exec calls = %d, want 2 (cleanup + delete)", len(state.execCalls))
	}
	if !strings.Contains(state.execCalls[1], "DELETE FROM system_column_details") {
		t.Fatalf("exec[1] = %q, want DELETE", state.execCalls[1])
	}
}
