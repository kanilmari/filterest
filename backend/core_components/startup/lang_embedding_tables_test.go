// lang_embedding_tables_test.go
// Regression tests for startup-managed language embedding helper tables.
// Verifies the startup ensure flow mirrors runtime role grants onto <table>_lang_embeddings.

package startup

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	backend "easelect/backend/core_components"
)

type langEmbeddingQuery struct {
	columns []string
	rows    [][]driver.Value
	err     error
}

type langEmbeddingExec struct {
	rowsAffected int64
	err          error
}

type langEmbeddingDriver struct{}
type langEmbeddingConn struct{}
type langEmbeddingStmt struct{}
type langEmbeddingTx struct{}
type langEmbeddingRows struct {
	columns []string
	rows    [][]driver.Value
	index   int
}
type langEmbeddingResult struct{ rowsAffected int64 }

var (
	langEmbeddingMu       sync.Mutex
	langEmbeddingQueries  []langEmbeddingQuery
	langEmbeddingExecs    []langEmbeddingExec
	langEmbeddingCalls    []string
	langEmbeddingInitOnce sync.Once
)

func TestEnsureLangEmbeddingTablesMirrorsRuntimeRoleGrants(t *testing.T) {
	db := newLangEmbeddingTestDB(t)
	defer db.Close()

	savedDB := backend.Db
	backend.Db = db
	t.Cleanup(func() {
		backend.Db = savedDB
	})

	pushLangEmbeddingQuery(langEmbeddingQuery{
		columns: []string{"table_name"},
		rows:    [][]driver.Value{{"app_service_catalog"}},
	})
	pushLangEmbeddingQuery(langEmbeddingQuery{
		columns: []string{"has_table_privilege"},
		rows:    [][]driver.Value{{true}},
	})
	pushLangEmbeddingQuery(langEmbeddingQuery{
		columns: []string{"has_table_privilege"},
		rows:    [][]driver.Value{{true}},
	})
	pushLangEmbeddingQuery(langEmbeddingQuery{
		columns: []string{"has_table_privilege"},
		rows:    [][]driver.Value{{true}},
	})
	pushLangEmbeddingQuery(langEmbeddingQuery{
		columns: []string{"has_table_privilege"},
		rows:    [][]driver.Value{{true}},
	})
	pushLangEmbeddingQuery(langEmbeddingQuery{
		columns: []string{"has_table_privilege"},
		rows:    [][]driver.Value{{true}},
	})
	pushLangEmbeddingQuery(langEmbeddingQuery{
		columns: []string{"has_table_privilege"},
		rows:    [][]driver.Value{{true}},
	})
	pushLangEmbeddingQuery(langEmbeddingQuery{
		columns: []string{"pg_get_serial_sequence"},
		rows:    [][]driver.Value{{"public.app_service_catalog_lang_embeddings_id_seq"}},
	})

	for range 9 {
		pushLangEmbeddingExec(langEmbeddingExec{rowsAffected: 1})
	}

	EnsureLangEmbeddingTables()

	calls := snapshotLangEmbeddingCalls()
	assertCallContains(t, calls, `CREATE TABLE IF NOT EXISTS "app_service_catalog_lang_embeddings"`)
	assertCallContains(t, calls, `GRANT SELECT ON TABLE "app_service_catalog_lang_embeddings" TO "readeronly"`)
	assertCallContains(t, calls, `GRANT SELECT ON TABLE "app_service_catalog_lang_embeddings" TO "guest_user"`)
	assertCallContains(t, calls, `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "app_service_catalog_lang_embeddings" TO "basic_user"`)
	assertCallContains(t, calls, `GRANT USAGE, SELECT ON SEQUENCE "public"."app_service_catalog_lang_embeddings_id_seq" TO "basic_user"`)
}

func newLangEmbeddingTestDB(t *testing.T) *sql.DB {
	t.Helper()
	langEmbeddingInitOnce.Do(func() {
		sql.Register("easelect-lang-embedding-startup-test", &langEmbeddingDriver{})
	})
	resetLangEmbeddingState()
	db, err := sql.Open("easelect-lang-embedding-startup-test", time.Now().Format("150405.000000000"))
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	db.SetMaxOpenConns(8)
	db.SetMaxIdleConns(8)
	return db
}

func pushLangEmbeddingQuery(query langEmbeddingQuery) {
	langEmbeddingMu.Lock()
	defer langEmbeddingMu.Unlock()
	langEmbeddingQueries = append(langEmbeddingQueries, query)
}

func pushLangEmbeddingExec(exec langEmbeddingExec) {
	langEmbeddingMu.Lock()
	defer langEmbeddingMu.Unlock()
	langEmbeddingExecs = append(langEmbeddingExecs, exec)
}

func resetLangEmbeddingState() {
	langEmbeddingMu.Lock()
	defer langEmbeddingMu.Unlock()
	langEmbeddingQueries = nil
	langEmbeddingExecs = nil
	langEmbeddingCalls = nil
}

func snapshotLangEmbeddingCalls() []string {
	langEmbeddingMu.Lock()
	defer langEmbeddingMu.Unlock()
	out := make([]string, len(langEmbeddingCalls))
	copy(out, langEmbeddingCalls)
	return out
}

func popLangEmbeddingQuery() (langEmbeddingQuery, bool) {
	langEmbeddingMu.Lock()
	defer langEmbeddingMu.Unlock()
	if len(langEmbeddingQueries) == 0 {
		return langEmbeddingQuery{}, false
	}
	item := langEmbeddingQueries[0]
	langEmbeddingQueries = langEmbeddingQueries[1:]
	return item, true
}

func popLangEmbeddingExec() (langEmbeddingExec, bool) {
	langEmbeddingMu.Lock()
	defer langEmbeddingMu.Unlock()
	if len(langEmbeddingExecs) == 0 {
		return langEmbeddingExec{}, false
	}
	item := langEmbeddingExecs[0]
	langEmbeddingExecs = langEmbeddingExecs[1:]
	return item, true
}

func recordLangEmbeddingCall(query string) {
	langEmbeddingMu.Lock()
	defer langEmbeddingMu.Unlock()
	langEmbeddingCalls = append(langEmbeddingCalls, query)
}

func assertCallContains(t *testing.T, calls []string, needle string) {
	t.Helper()
	for _, call := range calls {
		if strings.Contains(call, needle) {
			return
		}
	}
	t.Fatalf("did not find %q in calls: %v", needle, calls)
}

func (d *langEmbeddingDriver) Open(_ string) (driver.Conn, error)  { return &langEmbeddingConn{}, nil }
func (c *langEmbeddingConn) Prepare(_ string) (driver.Stmt, error) { return &langEmbeddingStmt{}, nil }
func (c *langEmbeddingConn) Close() error                          { return nil }
func (c *langEmbeddingConn) Begin() (driver.Tx, error)             { return &langEmbeddingTx{}, nil }
func (tx *langEmbeddingTx) Commit() error                          { return nil }
func (tx *langEmbeddingTx) Rollback() error                        { return nil }

func (c *langEmbeddingConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	recordLangEmbeddingCall(query)
	exec, ok := popLangEmbeddingExec()
	if !ok {
		return nil, errors.New("mock: unexpected Exec call")
	}
	if exec.err != nil {
		return nil, exec.err
	}
	return langEmbeddingResult{rowsAffected: exec.rowsAffected}, nil
}

func (c *langEmbeddingConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	recordLangEmbeddingCall(query)
	item, ok := popLangEmbeddingQuery()
	if !ok {
		return nil, errors.New("mock: unexpected Query call")
	}
	if item.err != nil {
		return nil, item.err
	}
	return &langEmbeddingRows{columns: item.columns, rows: item.rows}, nil
}

func (s *langEmbeddingStmt) Close() error  { return nil }
func (s *langEmbeddingStmt) NumInput() int { return -1 }
func (s *langEmbeddingStmt) Exec(_ []driver.Value) (driver.Result, error) {
	return nil, errors.New("mock: unexpected Exec call")
}
func (s *langEmbeddingStmt) Query(_ []driver.Value) (driver.Rows, error) {
	return nil, errors.New("mock: unexpected Query call")
}

func (r *langEmbeddingRows) Columns() []string { return r.columns }
func (r *langEmbeddingRows) Close() error      { return nil }
func (r *langEmbeddingRows) Next(dest []driver.Value) error {
	if r.index >= len(r.rows) {
		return io.EOF
	}
	copy(dest, r.rows[r.index])
	r.index++
	return nil
}

func (r langEmbeddingResult) LastInsertId() (int64, error) { return 0, nil }
func (r langEmbeddingResult) RowsAffected() (int64, error) { return r.rowsAffected, nil }
