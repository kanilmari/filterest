// cleanup_lang_key_sources_test.go
// Unit tests for dataset/column lang-key cleanup helpers.
// Uses a package-local database/sql driver double so cleanup coverage stays fast and deterministic.
// Protects retained keys and translations while dataset-owned sources are removed.
package lang

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

type queuedCleanupQuery struct {
	rowErr error
	cols   []string
	rows   [][]driver.Value
	err    error
}

type queuedCleanupExec struct {
	rowsAffected int64
	err          error
}

type cleanupState struct {
	mu sync.Mutex

	queries []queuedCleanupQuery
	execs   []queuedCleanupExec

	queryCalls []string
	execCalls  []string
	execArgs   [][]driver.NamedValue
}

type cleanupDriver struct {
	state *cleanupState
}

type cleanupConn struct {
	state *cleanupState
}

type cleanupRows struct {
	err  error
	cols []string
	rows [][]driver.Value
	idx  int
}

var cleanupDriverRegisterMu sync.Mutex

func (d *cleanupDriver) Open(string) (driver.Conn, error) {
	return &cleanupConn{state: d.state}, nil
}

func (c *cleanupConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("prepare not supported in cleanup lang-key test driver")
}

func (c *cleanupConn) Close() error { return nil }

func (c *cleanupConn) Begin() (driver.Tx, error) {
	return nil, errors.New("transactions not supported in cleanup lang-key test driver")
}

func (c *cleanupConn) Query(query string, args []driver.Value) (driver.Rows, error) {
	named := make([]driver.NamedValue, len(args))
	for i, arg := range args {
		named[i] = driver.NamedValue{Ordinal: i + 1, Value: arg}
	}
	return c.QueryContext(context.Background(), query, named)
}

func (c *cleanupConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
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

	return &cleanupRows{
		err:  next.rowErr,
		cols: append([]string(nil), next.cols...),
		rows: cloneCleanupRows(next.rows),
	}, nil
}

func (c *cleanupConn) Exec(query string, args []driver.Value) (driver.Result, error) {
	named := make([]driver.NamedValue, len(args))
	for i, arg := range args {
		named[i] = driver.NamedValue{Ordinal: i + 1, Value: arg}
	}
	return c.ExecContext(context.Background(), query, named)
}

func (c *cleanupConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	c.state.mu.Lock()
	defer c.state.mu.Unlock()

	c.state.execCalls = append(c.state.execCalls, query)
	c.state.execArgs = append(c.state.execArgs, append([]driver.NamedValue(nil), args...))
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

func (r *cleanupRows) Columns() []string { return append([]string(nil), r.cols...) }
func (r *cleanupRows) Close() error      { return nil }

func (r *cleanupRows) Next(dest []driver.Value) error {
	if r.idx >= len(r.rows) {
		if r.err != nil {
			return r.err
		}
		return io.EOF
	}
	copy(dest, r.rows[r.idx])
	r.idx++
	return nil
}

func cloneCleanupRows(rows [][]driver.Value) [][]driver.Value {
	cloned := make([][]driver.Value, len(rows))
	for i, row := range rows {
		cloned[i] = append([]driver.Value(nil), row...)
	}
	return cloned
}

func openCleanupDB(t *testing.T, queries []queuedCleanupQuery, execs []queuedCleanupExec) (*sql.DB, *cleanupState) {
	t.Helper()
	cleanupDriverRegisterMu.Lock()
	defer cleanupDriverRegisterMu.Unlock()

	state := &cleanupState{
		queries: append([]queuedCleanupQuery(nil), queries...),
		execs:   append([]queuedCleanupExec(nil), execs...),
	}

	driverName := fmt.Sprintf("cleanup_lang_key_test_%d", time.Now().UnixNano())
	sql.Register(driverName, &cleanupDriver{state: state})

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

func TestCleanupLangKeySourcesForTableRemovesSourcesAndKeepsKeys(t *testing.T) {
	db, state := openCleanupDB(
		t,
		[]queuedCleanupQuery{
			{
				cols: []string{"lang_key_id"},
				rows: [][]driver.Value{{int64(101)}, {int64(202)}},
			},
			{
				cols: []string{"count"},
				rows: [][]driver.Value{{int64(0)}},
			},
			{
				cols: []string{"count"},
				rows: [][]driver.Value{{int64(1)}},
			},
		},
		[]queuedCleanupExec{
			{rowsAffected: 4},
			{rowsAffected: 1},
		},
	)

	if err := CleanupLangKeySourcesForTable(db, "service_catalog"); err != nil {
		t.Fatalf("CleanupLangKeySourcesForTable() error = %v", err)
	}

	if len(state.queryCalls) != 1 {
		t.Fatalf("query call count = %d, want 1", len(state.queryCalls))
	}
	if len(state.execCalls) != 1 {
		t.Fatalf("exec call count = %d, want 1", len(state.execCalls))
	}

	firstQuery := state.queryCalls[0]
	if !strings.Contains(firstQuery, "source_type = 'dataset_header'") {
		t.Fatalf("dataset_header cleanup missing from affected-id query:\n%s", firstQuery)
	}
	if !strings.Contains(firstQuery, "source_type = 'column_value'") {
		t.Fatalf("column_value cleanup missing from affected-id query:\n%s", firstQuery)
	}
	if !strings.Contains(firstQuery, "source_high LIKE") {
		t.Fatalf("legacy/prefix ownership matching missing from affected-id query:\n%s", firstQuery)
	}
	if !strings.Contains(firstQuery, "lang_key_id IN (SELECT id FROM system_lang_keys") {
		t.Fatalf("dynamic dataset key cleanup missing from affected-id query:\n%s", firstQuery)
	}

	if !strings.Contains(state.execCalls[0], "DELETE FROM system_lang_key_sources") {
		t.Fatalf("first exec should delete source rows:\n%s", state.execCalls[0])
	}
}

func TestCleanupLangKeySourcesForColumnRemovesColumnValueSources(t *testing.T) {
	db, state := openCleanupDB(
		t,
		[]queuedCleanupQuery{
			{
				cols: []string{"lang_key_id"},
				rows: [][]driver.Value{{int64(303)}},
			},
			{
				cols: []string{"count"},
				rows: [][]driver.Value{{int64(0)}},
			},
		},
		[]queuedCleanupExec{
			{rowsAffected: 2},
			{rowsAffected: 1},
		},
	)

	if err := CleanupLangKeySourcesForColumn(db, "service_catalog", "status"); err != nil {
		t.Fatalf("CleanupLangKeySourcesForColumn() error = %v", err)
	}

	if len(state.queryCalls) != 1 {
		t.Fatalf("query call count = %d, want 1", len(state.queryCalls))
	}
	if len(state.execCalls) != 1 {
		t.Fatalf("exec call count = %d, want 1", len(state.execCalls))
	}

	firstQuery := state.queryCalls[0]
	if !strings.Contains(firstQuery, "source_type = 'column_value'") {
		t.Fatalf("column_value cleanup missing from affected-id query:\n%s", firstQuery)
	}
	if !strings.Contains(firstQuery, "source_high = $3") {
		t.Fatalf("column_value source_high exact match missing from affected-id query:\n%s", firstQuery)
	}
}

func TestCleanupLangKeySourcesForFolderKeepsSourceLessKey(t *testing.T) {
	db, state := openCleanupDB(t,
		[]queuedCleanupQuery{{cols: []string{"lang_key_id"}, rows: [][]driver.Value{{int64(404)}}}, {cols: []string{"count"}, rows: [][]driver.Value{{int64(0)}}}},
		[]queuedCleanupExec{{rowsAffected: 1}, {rowsAffected: 1}},
	)
	if err := CleanupLangKeySourcesForFolder(db, "old_folder"); err != nil {
		t.Fatal(err)
	}
	if len(state.queryCalls) != 1 || len(state.execCalls) != 1 || !strings.Contains(state.execCalls[0], "DELETE FROM system_lang_key_sources") {
		t.Fatal("folder cleanup must remove only sources", state.queryCalls, state.execCalls)
	}
}
