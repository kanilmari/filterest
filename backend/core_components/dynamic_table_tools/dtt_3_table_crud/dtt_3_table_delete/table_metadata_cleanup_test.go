// table_metadata_cleanup_test.go
// Unit tests for shared table-delete metadata cleanup helpers.
// Uses a package-local database/sql driver double so the delete/query sequence can be verified without a live PostgreSQL instance or production refactors.
package dtt_3_table_delete

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
	rowsAffected int64
	err          error
}

type deleteTableState struct {
	mu sync.Mutex

	queries []queuedDeleteQuery
	execs   []queuedDeleteExec

	queryCalls []string
	execCalls  []string
}

type deleteTableDriver struct {
	state *deleteTableState
}

type deleteTableConn struct {
	state *deleteTableState
}

type deleteTableRows struct {
	cols []string
	rows [][]driver.Value
	idx  int
}

var deleteTableDriverRegisterMu sync.Mutex

func (d *deleteTableDriver) Open(string) (driver.Conn, error) {
	return &deleteTableConn{state: d.state}, nil
}

func (c *deleteTableConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("prepare not supported in delete table test driver")
}

func (c *deleteTableConn) Close() error { return nil }

func (c *deleteTableConn) Begin() (driver.Tx, error) {
	return nil, errors.New("transactions not supported in delete table test driver")
}

func (c *deleteTableConn) Query(query string, args []driver.Value) (driver.Rows, error) {
	named := make([]driver.NamedValue, len(args))
	for i, arg := range args {
		named[i] = driver.NamedValue{Ordinal: i + 1, Value: arg}
	}
	return c.QueryContext(context.Background(), query, named)
}

func (c *deleteTableConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	c.state.mu.Lock()
	defer c.state.mu.Unlock()

	c.state.queryCalls = append(c.state.queryCalls, query)
	if len(c.state.queries) == 0 {
		return nil, errors.New("unexpected query")
	}

	next := c.state.queries[0]
	c.state.queries = c.state.queries[1:]
	if next.err != nil {
		return nil, next.err
	}

	return &deleteTableRows{
		cols: append([]string(nil), next.cols...),
		rows: cloneDeleteTableRows(next.rows),
	}, nil
}

func (c *deleteTableConn) Exec(query string, args []driver.Value) (driver.Result, error) {
	named := make([]driver.NamedValue, len(args))
	for i, arg := range args {
		named[i] = driver.NamedValue{Ordinal: i + 1, Value: arg}
	}
	return c.ExecContext(context.Background(), query, named)
}

func (c *deleteTableConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
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
	return driver.RowsAffected(next.rowsAffected), nil
}

func (r *deleteTableRows) Columns() []string { return append([]string(nil), r.cols...) }
func (r *deleteTableRows) Close() error      { return nil }

func (r *deleteTableRows) Next(dest []driver.Value) error {
	if r.idx >= len(r.rows) {
		return io.EOF
	}
	copy(dest, r.rows[r.idx])
	r.idx++
	return nil
}

func cloneDeleteTableRows(rows [][]driver.Value) [][]driver.Value {
	cloned := make([][]driver.Value, len(rows))
	for i, row := range rows {
		cloned[i] = append([]driver.Value(nil), row...)
	}
	return cloned
}

func openDeleteTableDB(t *testing.T, queries []queuedDeleteQuery, execs []queuedDeleteExec) (*sql.DB, *deleteTableState) {
	t.Helper()
	deleteTableDriverRegisterMu.Lock()
	defer deleteTableDriverRegisterMu.Unlock()

	state := &deleteTableState{
		queries: append([]queuedDeleteQuery(nil), queries...),
		execs:   append([]queuedDeleteExec(nil), execs...),
	}

	driverName := fmt.Sprintf("delete_table_test_%d", time.Now().UnixNano())
	sql.Register(driverName, &deleteTableDriver{state: state})

	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open returned error: %v", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	t.Cleanup(func() {
		_ = db.Close()
	})

	return db, state
}

type resultStub struct {
	n   int64
	err error
}

func (r resultStub) LastInsertId() (int64, error) { return 0, errors.New("not implemented") }
func (r resultStub) RowsAffected() (int64, error) { return r.n, r.err }

func TestRowsAffectedHandlesSuccessAndErrors(t *testing.T) {
	if got := rowsAffected(resultStub{n: 7}); got != 7 {
		t.Fatalf("rowsAffected success = %d, want 7", got)
	}
	if got := rowsAffected(resultStub{err: errors.New("boom")}); got != 0 {
		t.Fatalf("rowsAffected error = %d, want 0", got)
	}
}

func TestDeleteRemovedTablesSuccessAndExecError(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		db, state := openDeleteTableDB(t, nil, []queuedDeleteExec{{rowsAffected: 2}})

		if err := DeleteRemovedTables(db); err != nil {
			t.Fatalf("DeleteRemovedTables returned error: %v", err)
		}
		if len(state.execCalls) != 1 {
			t.Fatalf("exec call count = %d, want 1", len(state.execCalls))
		}
		if !strings.Contains(state.execCalls[0], "WITH removed_tables AS") {
			t.Fatalf("delete query missing removed_tables CTE:\n%s", state.execCalls[0])
		}
	})

	t.Run("exec error", func(t *testing.T) {
		db, _ := openDeleteTableDB(t, nil, []queuedDeleteExec{{err: errors.New("delete boom")}})

		err := DeleteRemovedTables(db)
		if err == nil || err.Error() != "error deleting removed tables: delete boom" {
			t.Fatalf("err = %v, want wrapped delete error", err)
		}
	})
}

func TestCleanupTableMetadataHappyPathAndSkippedLangCleanup(t *testing.T) {
	db, state := openDeleteTableDB(
		t,
		[]queuedDeleteQuery{
			{
				cols: []string{"table_name"},
				rows: nil, // QueryRow.Scan -> sql.ErrNoRows
			},
		},
		[]queuedDeleteExec{
			{rowsAffected: 1},
			{rowsAffected: 1},
			{rowsAffected: 1},
			{rowsAffected: 1},
			{rowsAffected: 1},
			{rowsAffected: 1},
			{rowsAffected: 1},
			{rowsAffected: 1},
		},
	)

	err := CleanupTableMetadata(db, 42, "public")
	if err != nil {
		t.Fatalf("CleanupTableMetadata returned error: %v", err)
	}

	if len(state.execCalls) != 8 {
		t.Fatalf("exec call count = %d, want 8", len(state.execCalls))
	}
	if len(state.queryCalls) != 1 {
		t.Fatalf("query call count = %d, want 1", len(state.queryCalls))
	}
	if !strings.Contains(state.queryCalls[0], "SELECT table_name FROM system_db_tables") {
		t.Fatalf("table-name query missing:\n%s", state.queryCalls[0])
	}
	if !strings.Contains(state.execCalls[0], "DELETE FROM system_foreign_key_relations_1_m") {
		t.Fatalf("first exec missing 1:M cleanup:\n%s", state.execCalls[0])
	}
	if !strings.Contains(state.execCalls[7], "DELETE FROM system_db_tables") {
		t.Fatalf("final exec missing system_db_tables cleanup:\n%s", state.execCalls[7])
	}
}

func TestCleanupTableMetadataPropagatesExecErrors(t *testing.T) {
	tests := []struct {
		name    string
		queries []queuedDeleteQuery
		execs   []queuedDeleteExec
		wantErr string
	}{
		{
			name: "fk 1m delete",
			execs: []queuedDeleteExec{
				{err: errors.New("fk1m boom")},
			},
			wantErr: "failed to delete 1:M foreign key relations: fk1m boom",
		},
		{
			name: "group rights delete",
			execs: []queuedDeleteExec{
				{rowsAffected: 1},
				{rowsAffected: 1},
				{err: errors.New("rights boom")},
			},
			wantErr: "failed to delete group rights: rights boom",
		},
		{
			name: "final table entry delete",
			queries: []queuedDeleteQuery{
				{
					cols: []string{"table_name"},
					rows: nil,
				},
			},
			execs: []queuedDeleteExec{
				{rowsAffected: 1},
				{rowsAffected: 1},
				{rowsAffected: 1},
				{rowsAffected: 1},
				{rowsAffected: 1},
				{rowsAffected: 1},
				{rowsAffected: 1},
				{err: errors.New("table entry boom")},
			},
			wantErr: "failed to delete table entry: table entry boom",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db, _ := openDeleteTableDB(t, tt.queries, tt.execs)

			err := CleanupTableMetadata(db, 42, "public")
			if err == nil || err.Error() != tt.wantErr {
				t.Fatalf("err = %v, want %q", err, tt.wantErr)
			}
		})
	}
}

func TestCleanupTableMetadataTreatsLangCleanupFailureAsNonFatal(t *testing.T) {
	db, state := openDeleteTableDB(
		t,
		[]queuedDeleteQuery{
			{
				cols: []string{"table_name"},
				rows: [][]driver.Value{{"users"}},
			},
			{
				cols: nil,
				err:  errors.New("affected ids boom"),
			},
		},
		[]queuedDeleteExec{
			{rowsAffected: 1},
			{rowsAffected: 1},
			{rowsAffected: 1},
			{rowsAffected: 1},
			{rowsAffected: 1},
			{rowsAffected: 1},
			{rowsAffected: 1},
			{rowsAffected: 1},
		},
	)

	err := CleanupTableMetadata(db, 42, "public")
	if err != nil {
		t.Fatalf("CleanupTableMetadata returned error: %v", err)
	}

	if len(state.queryCalls) != 2 {
		t.Fatalf("query call count = %d, want 2", len(state.queryCalls))
	}
	if len(state.execCalls) != 8 {
		t.Fatalf("exec call count = %d, want 8", len(state.execCalls))
	}
	if !strings.Contains(state.queryCalls[1], "SELECT DISTINCT lang_key_id") {
		t.Fatalf("lang cleanup query missing:\n%s", state.queryCalls[1])
	}
	if !strings.Contains(state.execCalls[7], "DELETE FROM system_db_tables") {
		t.Fatalf("final cleanup did not continue after lang cleanup failure:\n%s", state.execCalls[7])
	}
}
