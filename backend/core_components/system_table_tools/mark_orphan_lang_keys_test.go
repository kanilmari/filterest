// mark_orphan_lang_keys_test.go
// Verifies the orphan lang-key startup sync uses bulk database operations.
// Bridges MarkOrphanLangKeys with a package-local SQL mock driver that records calls.
// Exists to prevent shared-dev startup regressions caused by per-row orphan writes.
package system_table_tools

import (
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

func init() {
	sql.Register("easelect-system-table-tools-test", &orphanQueueDriver{})
}

func newSystemTableToolsTestDB(t interface{ Fatal(...interface{}) }) *sql.DB {
	db, err := sql.Open("easelect-system-table-tools-test", "")
	if err != nil {
		t.Fatal("newSystemTableToolsTestDB:", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	return db
}

type orphanQueuedQuery struct {
	cols []string
	rows [][]driver.Value
	err  error
}

type orphanQueuedExec struct {
	err          error
	rowsAffected int64
}

var (
	orphanQueueMu    sync.Mutex
	orphanQueryQueue []orphanQueuedQuery
	orphanExecQueue  []orphanQueuedExec
	orphanCallLog    []string
)

func pushOrphanQuery(q orphanQueuedQuery) {
	orphanQueueMu.Lock()
	orphanQueryQueue = append(orphanQueryQueue, q)
	orphanQueueMu.Unlock()
}

func pushOrphanExec(e orphanQueuedExec) {
	orphanQueueMu.Lock()
	orphanExecQueue = append(orphanExecQueue, e)
	orphanQueueMu.Unlock()
}

func resetOrphanQueues() {
	orphanQueueMu.Lock()
	orphanQueryQueue = nil
	orphanExecQueue = nil
	orphanCallLog = nil
	orphanQueueMu.Unlock()
}

func snapshotOrphanCalls() []string {
	orphanQueueMu.Lock()
	defer orphanQueueMu.Unlock()
	calls := make([]string, len(orphanCallLog))
	copy(calls, orphanCallLog)
	return calls
}

func popOrphanQuery() (orphanQueuedQuery, bool) {
	orphanQueueMu.Lock()
	defer orphanQueueMu.Unlock()
	if len(orphanQueryQueue) == 0 {
		return orphanQueuedQuery{}, false
	}
	q := orphanQueryQueue[0]
	orphanQueryQueue = orphanQueryQueue[1:]
	return q, true
}

func popOrphanExec() (orphanQueuedExec, bool) {
	orphanQueueMu.Lock()
	defer orphanQueueMu.Unlock()
	if len(orphanExecQueue) == 0 {
		return orphanQueuedExec{}, false
	}
	e := orphanExecQueue[0]
	orphanExecQueue = orphanExecQueue[1:]
	return e, true
}

func recordOrphanCall(query string) {
	orphanQueueMu.Lock()
	orphanCallLog = append(orphanCallLog, query)
	orphanQueueMu.Unlock()
}

type orphanQueueDriver struct{}

func (d *orphanQueueDriver) Open(name string) (driver.Conn, error) {
	return &orphanQueueConn{}, nil
}

type orphanQueueConn struct{}

func (c *orphanQueueConn) Prepare(query string) (driver.Stmt, error) {
	return &orphanQueueStmt{query: query}, nil
}

func (c *orphanQueueConn) Close() error { return nil }

func (c *orphanQueueConn) Begin() (driver.Tx, error) {
	return &orphanQueueTx{}, nil
}

type orphanQueueTx struct{}

func (t *orphanQueueTx) Commit() error   { return nil }
func (t *orphanQueueTx) Rollback() error { return nil }

type orphanQueueStmt struct {
	query string
}

func (s *orphanQueueStmt) Close() error  { return nil }
func (s *orphanQueueStmt) NumInput() int { return -1 }

func (s *orphanQueueStmt) Exec(args []driver.Value) (driver.Result, error) {
	recordOrphanCall(s.query)
	e, ok := popOrphanExec()
	if !ok {
		return nil, errors.New("mock: unexpected Exec call (exec queue empty)")
	}
	if e.err != nil {
		return nil, e.err
	}
	return &orphanQueueResult{rowsAffected: e.rowsAffected}, nil
}

func (s *orphanQueueStmt) Query(args []driver.Value) (driver.Rows, error) {
	recordOrphanCall(s.query)
	q, ok := popOrphanQuery()
	if !ok {
		return nil, errors.New("mock: unexpected Query call (query queue empty)")
	}
	if q.err != nil {
		return nil, q.err
	}
	return &orphanQueueRows{cols: q.cols, data: q.rows}, nil
}

type orphanQueueRows struct {
	cols []string
	data [][]driver.Value
	idx  int
}

func (r *orphanQueueRows) Columns() []string { return r.cols }
func (r *orphanQueueRows) Close() error      { return nil }

func (r *orphanQueueRows) Next(dest []driver.Value) error {
	if r.idx >= len(r.data) {
		return io.EOF
	}
	copy(dest, r.data[r.idx])
	r.idx++
	return nil
}

type orphanQueueResult struct {
	rowsAffected int64
}

func (r *orphanQueueResult) LastInsertId() (int64, error) { return 0, nil }
func (r *orphanQueueResult) RowsAffected() (int64, error) { return r.rowsAffected, nil }

func TestMarkOrphanLangKeysUsesBulkDatabaseOperations(t *testing.T) {
	resetOrphanQueues()
	t.Cleanup(resetOrphanQueues)

	db := newSystemTableToolsTestDB(t)
	defer db.Close()

	originalDB := backend.Db
	backend.Db = db
	defer func() {
		backend.Db = originalDB
	}()

	lastSourceScanMu.Lock()
	originalScan := lastSourceScan
	lastSourceScan = time.Now()
	lastSourceScanMu.Unlock()
	defer func() {
		lastSourceScanMu.Lock()
		lastSourceScan = originalScan
		lastSourceScanMu.Unlock()
	}()

	pushOrphanQuery(orphanQueuedQuery{
		cols: []string{"id", "lang_key", "en", "lang_key_type"},
		rows: [][]driver.Value{
			{int64(10), "orphan_alpha", "Alpha", "ui"},
			{int64(11), "orphan_beta", "Beta", "ui"},
		},
	})
	pushOrphanExec(orphanQueuedExec{rowsAffected: 2})
	pushOrphanExec(orphanQueuedExec{rowsAffected: 1})
	pushOrphanQuery(orphanQueuedQuery{
		cols: []string{"lang_key_id", "last_seen"},
		rows: [][]driver.Value{},
	})

	orphanCount, deOrphanedCount := MarkOrphanLangKeys()

	if orphanCount != 2 {
		t.Fatalf("MarkOrphanLangKeys orphanCount = %d, want 2", orphanCount)
	}
	if deOrphanedCount != 1 {
		t.Fatalf("MarkOrphanLangKeys deOrphanedCount = %d, want 1", deOrphanedCount)
	}

	calls := snapshotOrphanCalls()
	if len(calls) != 4 {
		t.Fatalf("expected 4 SQL calls, got %d (%v)", len(calls), calls)
	}
	if !strings.Contains(calls[1], "FROM UNNEST") {
		t.Fatalf("expected bulk orphan upsert via UNNEST, got %q", calls[1])
	}
	if !strings.Contains(calls[2], "DELETE FROM system_lang_key_sources") || !strings.Contains(calls[2], "ANY($1") {
		t.Fatalf("expected bulk stale orphan delete query, got %q", calls[2])
	}
}

func TestScanForeignKeyLangKeyReferencesRegistersDomainReferences(t *testing.T) {
	resetOrphanQueues()
	t.Cleanup(resetOrphanQueues)

	db := newSystemTableToolsTestDB(t)
	defer db.Close()

	originalDB := backend.Db
	backend.Db = db
	defer func() {
		backend.Db = originalDB
	}()

	pushOrphanQuery(orphanQueuedQuery{
		cols: []string{"schema", "table", "column"},
		rows: [][]driver.Value{
			{"public", "app_dating_questions", "example_id"},
			{"public", "app_dating_questions", "question_id"},
		},
	})
	pushOrphanQuery(orphanQueuedQuery{
		cols: []string{"lang_key_id"},
		rows: [][]driver.Value{{int64(101)}, {int64(999)}},
	})
	pushOrphanExec(orphanQueuedExec{rowsAffected: 1})
	pushOrphanExec(orphanQueuedExec{rowsAffected: 1})
	pushOrphanQuery(orphanQueuedQuery{
		cols: []string{"lang_key_id"},
		rows: [][]driver.Value{{int64(79)}},
	})
	pushOrphanExec(orphanQueuedExec{rowsAffected: 1})
	pushOrphanExec(orphanQueuedExec{rowsAffected: 1})

	count := scanForeignKeyLangKeyReferences(map[string]int64{
		"question": 79,
		"example":  101,
	})

	if count != 2 {
		t.Fatalf("scanForeignKeyLangKeyReferences count = %d, want 2", count)
	}

	calls := snapshotOrphanCalls()
	if len(calls) != 7 {
		t.Fatalf("expected 7 SQL calls, got %d (%v)", len(calls), calls)
	}
	if !strings.Contains(calls[0], "system_lang_keys") ||
		!strings.Contains(calls[0], "system_lang_key_sources") {
		t.Fatalf("expected constrained FK discovery query, got %q", calls[0])
	}
	if !strings.Contains(calls[2], "INSERT INTO system_lang_key_sources") ||
		!strings.Contains(calls[5], "INSERT INTO system_lang_key_sources") {
		t.Fatalf("expected FK source upserts, got %v", calls)
	}
}
