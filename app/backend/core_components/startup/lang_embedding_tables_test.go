// lang_embedding_tables_test.go
// Regression tests for startup-managed language embedding helper tables.
// Verifies the startup ensure flow mirrors runtime role grants onto <table>_lang_embeddings.

package startup

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

func TestStartupEmbeddingCreationUsesSchemaAndPropagatesDDLFailure(t *testing.T) {
	for _, fail := range []int{-1, 0, 1, 2, 3} {
		t.Run(fmt.Sprint(fail), func(t *testing.T) {
			db := newLangEmbeddingTestDB(t)
			defer db.Close()
			pushLangEmbeddingQuery(langEmbeddingQuery{columns: []string{"schema_name", "table_name"}, rows: [][]driver.Value{{"schema quoted", "host quoted"}}})
			for i := 0; i < 4; i++ {
				item := langEmbeddingExec{rowsAffected: 1}
				if i == fail {
					item.err = errors.New("DDL failure")
				}
				pushLangEmbeddingExec(item)
			}
			err := EnsureStartupLangEmbeddingTables(context.Background(), db)
			if (err != nil) != (fail >= 0) {
				t.Fatalf("failure %d: %v", fail, err)
			}
			calls := snapshotLangEmbeddingCalls()
			assertCallContains(t, calls, `CREATE TABLE IF NOT EXISTS "schema quoted"."host quoted_lang_embeddings"`)
			for _, call := range calls {
				if strings.Contains(call, "GRANT ") || strings.Contains(call, "has_table_privilege") || strings.Contains(call, "hnsw") {
					t.Fatalf("historical grant mirror remains: %s", call)
				}
			}
			if fail >= 0 && len(calls) != fail+2 {
				t.Fatalf("continued after required DDL failure: %v", calls)
			}
		})
	}
}

func TestStartupEmbeddingDiscoveryErrorIsRequired(t *testing.T) {
	db := newLangEmbeddingTestDB(t)
	defer db.Close()
	pushLangEmbeddingQuery(langEmbeddingQuery{err: errors.New("discovery failure")})
	if err := EnsureStartupLangEmbeddingTables(context.Background(), db); err == nil {
		t.Fatal("discovery failure swallowed")
	}
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
