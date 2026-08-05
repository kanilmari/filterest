// app_db_compatibility_sync_test.go
// Regression tests for the startup-managed app↔DB compatibility mirror.
// Verifies the manifest loader and the startup sync behavior without requiring
// a live PostgreSQL instance.
package startup

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

type appDBCompatibilityQuery struct {
	columns []string
	rows    [][]driver.Value
	err     error
}

type appDBCompatibilityExec struct {
	rowsAffected int64
	err          error
}

type appDBCompatibilityDriver struct{}
type appDBCompatibilityConn struct{}
type appDBCompatibilityStmt struct{}
type appDBCompatibilityTx struct{}
type appDBCompatibilityRows struct {
	columns []string
	rows    [][]driver.Value
	index   int
}
type appDBCompatibilityResult struct{ rowsAffected int64 }

var (
	appDBCompatibilityMu       sync.Mutex
	appDBCompatibilityQueries  []appDBCompatibilityQuery
	appDBCompatibilityExecs    []appDBCompatibilityExec
	appDBCompatibilityCalls    []string
	appDBCompatibilityInitOnce sync.Once
)

func TestLoadAppDBCompatibilityManifestParsesJSONLRows(t *testing.T) {
	projectRoot := t.TempDir()
	manifestPath := filepath.Join(projectRoot, "server_tools", "versioning", "app_db_compatibility.jsonl")
	if err := os.MkdirAll(filepath.Dir(manifestPath), 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}

	content := strings.Join([]string{
		`# compatibility history`,
		`{"app_version":"6.18.23","min_db_version":"7.0.21","target_db_version":"7.0.21","schema_snapshot_path":"server_tools/versioning/schema_snapshots/db-7.0.21.sql","git_commit_sha":"157b0a8","status":"historical","notes":"slice 1","recorded_at":"2026-03-30T17:27:24Z"}`,
		`{"app_version":"6.18.24","min_db_version":"8.0.0","target_db_version":"8.0.0","schema_snapshot_path":"server_tools/versioning/schema_snapshots/db-8.0.0.sql","git_commit_sha":"1e1b1f7","status":"active","notes":"slice 2","recorded_at":"2026-03-30T18:40:00Z"}`,
	}, "\n")
	if err := os.WriteFile(manifestPath, []byte(content), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	rows, err := loadAppDBCompatibilityManifest(manifestPath)
	if err != nil {
		t.Fatalf("loadAppDBCompatibilityManifest: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("expected 2 rows, got %d", len(rows))
	}
	if rows[1].AppVersion != "6.18.24" {
		t.Fatalf("expected second app version 6.18.24, got %q", rows[1].AppVersion)
	}
	if rows[1].RecordedAt.Format(time.RFC3339) != "2026-03-30T18:40:00Z" {
		t.Fatalf("unexpected recorded_at parse: %s", rows[1].RecordedAt.Format(time.RFC3339))
	}
}

func TestLoadAppDBCompatibilityManifestRejectsMultipleActiveRows(t *testing.T) {
	projectRoot := t.TempDir()
	manifestPath := filepath.Join(projectRoot, "app_db_compatibility.jsonl")
	content := strings.Join([]string{
		`{"app_version":"6.18.23","status":"active","recorded_at":"2026-03-30T17:27:24Z"}`,
		`{"app_version":"6.18.24","status":"active","recorded_at":"2026-03-30T18:40:00Z"}`,
	}, "\n")
	if err := os.WriteFile(manifestPath, []byte(content), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	if _, err := loadAppDBCompatibilityManifest(manifestPath); err == nil ||
		!strings.Contains(err.Error(), "exactly one active row") {
		t.Fatalf("expected multiple-active status error, got %v", err)
	}
}

func TestSyncAppDBCompatibilityMirrorSkipsWhenTableMissing(t *testing.T) {
	projectRoot := writeAppDBCompatibilityManifestFixture(t)
	db := newAppDBCompatibilityTestDB(t)
	defer db.Close()

	pushAppDBCompatibilityQuery(appDBCompatibilityQuery{
		columns: []string{"exists"},
		rows:    [][]driver.Value{{false}},
	})

	count, err := SyncAppDBCompatibilityMirror(db, projectRoot)
	if err != nil {
		t.Fatalf("SyncAppDBCompatibilityMirror: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected sync count 0 when mirror table missing, got %d", count)
	}

	calls := snapshotAppDBCompatibilityCalls()
	if len(calls) != 1 || !strings.Contains(calls[0], "information_schema.tables") {
		t.Fatalf("unexpected calls: %v", calls)
	}
}

func TestSyncAppDBCompatibilityMirrorUpsertsManifestRows(t *testing.T) {
	projectRoot := writeAppDBCompatibilityManifestFixture(t)
	db := newAppDBCompatibilityTestDB(t)
	defer db.Close()

	pushAppDBCompatibilityQuery(appDBCompatibilityQuery{
		columns: []string{"exists"},
		rows:    [][]driver.Value{{true}},
	})
	pushAppDBCompatibilityExec(appDBCompatibilityExec{rowsAffected: 1})
	pushAppDBCompatibilityExec(appDBCompatibilityExec{rowsAffected: 1})
	pushAppDBCompatibilityExec(appDBCompatibilityExec{rowsAffected: 1})

	count, err := SyncAppDBCompatibilityMirror(db, projectRoot)
	if err != nil {
		t.Fatalf("SyncAppDBCompatibilityMirror: %v", err)
	}
	if count != 2 {
		t.Fatalf("expected sync count 2, got %d", count)
	}

	calls := snapshotAppDBCompatibilityCalls()
	if len(calls) < 3 {
		t.Fatalf("expected at least 3 calls, got %v", calls)
	}

	normalizationCalls := 0
	upsertCalls := 0
	for _, call := range calls {
		if strings.Contains(call, "UPDATE system_app_db_compatibility") &&
			strings.Contains(call, "status = 'historical'") {
			normalizationCalls++
		}
		if strings.Contains(call, "INSERT INTO system_app_db_compatibility") &&
			strings.Contains(call, "ON CONFLICT (app_version)") {
			upsertCalls++
		}
	}
	if normalizationCalls != 1 {
		t.Fatalf("expected one status normalization call, got %d from %v", normalizationCalls, calls)
	}
	if upsertCalls != 2 {
		t.Fatalf("expected 2 upsert calls, got %d from %v", upsertCalls, calls)
	}
}

func writeAppDBCompatibilityManifestFixture(t *testing.T) string {
	t.Helper()
	projectRoot := t.TempDir()
	manifestPath := filepath.Join(projectRoot, "server_tools", "versioning", "app_db_compatibility.jsonl")
	if err := os.MkdirAll(filepath.Dir(manifestPath), 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}

	lines := []string{
		`{"app_version":"6.18.23","min_db_version":"7.0.21","target_db_version":"7.0.21","schema_snapshot_path":"server_tools/versioning/schema_snapshots/db-7.0.21.sql","git_commit_sha":"157b0a8","status":"historical","notes":"slice 1","recorded_at":"2026-03-30T17:27:24Z"}`,
		`{"app_version":"6.18.24","min_db_version":"8.0.0","target_db_version":"8.0.0","schema_snapshot_path":"server_tools/versioning/schema_snapshots/db-8.0.0.sql","git_commit_sha":"1e1b1f7","status":"active","notes":"slice 2","recorded_at":"2026-03-30T18:40:00Z"}`,
	}
	if err := os.WriteFile(manifestPath, []byte(strings.Join(lines, "\n")), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	return projectRoot
}

func newAppDBCompatibilityTestDB(t *testing.T) *sql.DB {
	t.Helper()
	appDBCompatibilityInitOnce.Do(func() {
		sql.Register("easelect-app-db-compatibility-test", &appDBCompatibilityDriver{})
	})
	resetAppDBCompatibilityState()
	db, err := sql.Open("easelect-app-db-compatibility-test", fmt.Sprintf("%d", time.Now().UnixNano()))
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(4)
	return db
}

func pushAppDBCompatibilityQuery(query appDBCompatibilityQuery) {
	appDBCompatibilityMu.Lock()
	defer appDBCompatibilityMu.Unlock()
	appDBCompatibilityQueries = append(appDBCompatibilityQueries, query)
}

func pushAppDBCompatibilityExec(exec appDBCompatibilityExec) {
	appDBCompatibilityMu.Lock()
	defer appDBCompatibilityMu.Unlock()
	appDBCompatibilityExecs = append(appDBCompatibilityExecs, exec)
}

func resetAppDBCompatibilityState() {
	appDBCompatibilityMu.Lock()
	defer appDBCompatibilityMu.Unlock()
	appDBCompatibilityQueries = nil
	appDBCompatibilityExecs = nil
	appDBCompatibilityCalls = nil
}

func snapshotAppDBCompatibilityCalls() []string {
	appDBCompatibilityMu.Lock()
	defer appDBCompatibilityMu.Unlock()
	out := make([]string, len(appDBCompatibilityCalls))
	copy(out, appDBCompatibilityCalls)
	return out
}

func popAppDBCompatibilityQuery() (appDBCompatibilityQuery, bool) {
	appDBCompatibilityMu.Lock()
	defer appDBCompatibilityMu.Unlock()
	if len(appDBCompatibilityQueries) == 0 {
		return appDBCompatibilityQuery{}, false
	}
	item := appDBCompatibilityQueries[0]
	appDBCompatibilityQueries = appDBCompatibilityQueries[1:]
	return item, true
}

func popAppDBCompatibilityExec() (appDBCompatibilityExec, bool) {
	appDBCompatibilityMu.Lock()
	defer appDBCompatibilityMu.Unlock()
	if len(appDBCompatibilityExecs) == 0 {
		return appDBCompatibilityExec{}, false
	}
	item := appDBCompatibilityExecs[0]
	appDBCompatibilityExecs = appDBCompatibilityExecs[1:]
	return item, true
}

func recordAppDBCompatibilityCall(query string) {
	appDBCompatibilityMu.Lock()
	defer appDBCompatibilityMu.Unlock()
	appDBCompatibilityCalls = append(appDBCompatibilityCalls, query)
}

func (d *appDBCompatibilityDriver) Open(_ string) (driver.Conn, error) {
	return &appDBCompatibilityConn{}, nil
}
func (c *appDBCompatibilityConn) Prepare(_ string) (driver.Stmt, error) {
	return &appDBCompatibilityStmt{}, nil
}
func (c *appDBCompatibilityConn) Close() error              { return nil }
func (c *appDBCompatibilityConn) Begin() (driver.Tx, error) { return &appDBCompatibilityTx{}, nil }
func (tx *appDBCompatibilityTx) Commit() error              { return nil }
func (tx *appDBCompatibilityTx) Rollback() error            { return nil }

func (c *appDBCompatibilityConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	recordAppDBCompatibilityCall(query)
	exec, ok := popAppDBCompatibilityExec()
	if !ok {
		return nil, errors.New("mock: unexpected Exec call")
	}
	if exec.err != nil {
		return nil, exec.err
	}
	return appDBCompatibilityResult{rowsAffected: exec.rowsAffected}, nil
}

func (c *appDBCompatibilityConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	recordAppDBCompatibilityCall(query)
	item, ok := popAppDBCompatibilityQuery()
	if !ok {
		return nil, errors.New("mock: unexpected Query call")
	}
	if item.err != nil {
		return nil, item.err
	}
	return &appDBCompatibilityRows{columns: item.columns, rows: item.rows}, nil
}

func (s *appDBCompatibilityStmt) Close() error  { return nil }
func (s *appDBCompatibilityStmt) NumInput() int { return -1 }
func (s *appDBCompatibilityStmt) Exec(_ []driver.Value) (driver.Result, error) {
	return nil, errors.New("mock: unexpected Exec call")
}
func (s *appDBCompatibilityStmt) Query(_ []driver.Value) (driver.Rows, error) {
	return nil, errors.New("mock: unexpected Query call")
}

func (r *appDBCompatibilityRows) Columns() []string { return r.columns }
func (r *appDBCompatibilityRows) Close() error      { return nil }
func (r *appDBCompatibilityRows) Next(dest []driver.Value) error {
	if r.index >= len(r.rows) {
		return errors.New("EOF")
	}
	copy(dest, r.rows[r.index])
	r.index++
	return nil
}

func (r appDBCompatibilityResult) LastInsertId() (int64, error) { return 0, nil }
func (r appDBCompatibilityResult) RowsAffected() (int64, error) { return r.rowsAffected, nil }
