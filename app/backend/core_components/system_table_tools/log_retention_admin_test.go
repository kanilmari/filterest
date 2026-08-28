// log_retention_admin_test.go
// Unit tests for admin log-retention helpers and prune execution.
// Covers cutoff parsing, log-table allowlist validation, and dry-run vs delete behavior with a lightweight DB driver double.
// Exists to keep the maintenance retention path safe without requiring a live PostgreSQL instance.
package system_table_tools

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"easelect/backend/core_components/dbutils"
)

type logRetentionQueryCall struct {
	query string
	args  []driver.NamedValue
}

type logRetentionExecCall struct {
	query string
	args  []driver.NamedValue
}

type logRetentionMockState struct {
	mu sync.Mutex

	counts map[string]int64
	calls  []logRetentionQueryCall
	execs  []logRetentionExecCall
}

type logRetentionMockDriver struct{ state *logRetentionMockState }
type logRetentionMockConn struct{ state *logRetentionMockState }
type logRetentionMockTx struct{}

type logRetentionMockRows struct {
	cols []string
	rows [][]driver.Value
	idx  int
}

var logRetentionDriverCounter int64

func (d *logRetentionMockDriver) Open(string) (driver.Conn, error) {
	return &logRetentionMockConn{state: d.state}, nil
}

func (c *logRetentionMockConn) Prepare(string) (driver.Stmt, error) {
	return nil, fmt.Errorf("prepare not implemented in log retention mock")
}

func (c *logRetentionMockConn) Close() error { return nil }
func (c *logRetentionMockConn) Begin() (driver.Tx, error) {
	return &logRetentionMockTx{}, nil
}
func (c *logRetentionMockConn) BeginTx(context.Context, driver.TxOptions) (driver.Tx, error) {
	return &logRetentionMockTx{}, nil
}

func (*logRetentionMockTx) Commit() error   { return nil }
func (*logRetentionMockTx) Rollback() error { return nil }

func (r *logRetentionMockRows) Columns() []string { return append([]string(nil), r.cols...) }
func (r *logRetentionMockRows) Close() error      { return nil }

func (r *logRetentionMockRows) Next(dest []driver.Value) error {
	if r.idx >= len(r.rows) {
		return io.EOF
	}
	copy(dest, r.rows[r.idx])
	r.idx++
	return nil
}

func (c *logRetentionMockConn) Query(query string, args []driver.Value) (driver.Rows, error) {
	named := make([]driver.NamedValue, len(args))
	for i, arg := range args {
		named[i] = driver.NamedValue{Ordinal: i + 1, Value: arg}
	}
	return c.QueryContext(context.Background(), query, named)
}

func (c *logRetentionMockConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	c.state.mu.Lock()
	defer c.state.mu.Unlock()

	c.state.calls = append(c.state.calls, logRetentionQueryCall{
		query: query,
		args:  append([]driver.NamedValue(nil), args...),
	})

	if strings.Contains(query, "information_schema.tables") {
		return &logRetentionMockRows{
			cols: []string{"exists"},
			rows: [][]driver.Value{{true}},
		}, nil
	}

	for tableName, count := range c.state.counts {
		if strings.Contains(query, fmt.Sprintf(`FROM "%s"`, tableName)) {
			return &logRetentionMockRows{
				cols: []string{"count"},
				rows: [][]driver.Value{{count}},
			}, nil
		}
	}

	return nil, fmt.Errorf("unexpected query: %s", query)
}

func (c *logRetentionMockConn) Exec(query string, args []driver.Value) (driver.Result, error) {
	named := make([]driver.NamedValue, len(args))
	for i, arg := range args {
		named[i] = driver.NamedValue{Ordinal: i + 1, Value: arg}
	}
	return c.ExecContext(context.Background(), query, named)
}

func (c *logRetentionMockConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	c.state.mu.Lock()
	defer c.state.mu.Unlock()

	c.state.execs = append(c.state.execs, logRetentionExecCall{
		query: query,
		args:  append([]driver.NamedValue(nil), args...),
	})

	for tableName, count := range c.state.counts {
		if strings.Contains(query, fmt.Sprintf(`DELETE FROM "%s"`, tableName)) {
			return driver.RowsAffected(count), nil
		}
	}

	return nil, fmt.Errorf("unexpected exec: %s", query)
}

func openLogRetentionMockDB(t *testing.T, counts map[string]int64) (*sql.DB, *logRetentionMockState) {
	t.Helper()
	state := &logRetentionMockState{counts: counts}
	driverName := fmt.Sprintf("log_retention_%d", atomic.AddInt64(&logRetentionDriverCounter, 1))
	sql.Register(driverName, &logRetentionMockDriver{state: state})

	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open returned error: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db, state
}

func withLogRetentionTx(req *http.Request, db *sql.DB) *http.Request {
	lt := dbutils.NewLazyTx(db)
	return req.WithContext(dbutils.SetLazyTx(req.Context(), lt))
}

func TestParseLogRetentionCutoffAcceptsDateOnly(t *testing.T) {
	got, err := parseLogRetentionCutoff("2026-03-29")
	if err != nil {
		t.Fatalf("parseLogRetentionCutoff returned error: %v", err)
	}
	if got.Year() != 2026 || got.Month() != time.March || got.Day() != 29 {
		t.Fatalf("unexpected parsed date: %v", got)
	}
}

func TestResolveRequestedLogTablesRejectsUnknown(t *testing.T) {
	if _, err := resolveRequestedLogTables([]string{"system_audit_log", "bogus_log"}); err == nil {
		t.Fatal("expected unknown log table error")
	}
}

func TestRunLogRetentionDryRunCountsWithoutDelete(t *testing.T) {
	db, state := openLogRetentionMockDB(t, map[string]int64{
		"system_audit_log":       12,
		"system_transaction_log": 7,
	})

	before := time.Date(2026, time.March, 29, 0, 0, 0, 0, time.Local)
	resp, err := runLogRetention(db, before, []string{"system_audit_log", "system_transaction_log"}, true)
	if err != nil {
		t.Fatalf("runLogRetention returned error: %v", err)
	}

	if !resp.DryRun {
		t.Fatal("expected dry_run response")
	}
	if resp.TotalMatched != 19 {
		t.Fatalf("TotalMatched = %d, want 19", resp.TotalMatched)
	}
	if resp.TotalDeleted != 0 {
		t.Fatalf("TotalDeleted = %d, want 0", resp.TotalDeleted)
	}

	state.mu.Lock()
	defer state.mu.Unlock()
	if len(state.execs) != 0 {
		t.Fatalf("exec count = %d, want 0 in dry run", len(state.execs))
	}
}

func TestPruneLogRetentionHandlerDeletesRows(t *testing.T) {
	db, state := openLogRetentionMockDB(t, map[string]int64{
		"system_audit_log": 5,
		"system_log":       0,
	})

	body := strings.NewReader(`{"before":"2026-03-29","tables":["system_audit_log","system_log"],"dry_run":false}`)
	req := httptest.NewRequest(http.MethodPost, "/api/log-retention/prune", body)
	req = withLogRetentionTx(req, db)
	rec := httptest.NewRecorder()

	PruneLogRetentionHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	state.mu.Lock()
	defer state.mu.Unlock()
	if len(state.execs) != 1 {
		t.Fatalf("exec count = %d, want 1", len(state.execs))
	}
	if !strings.Contains(state.execs[0].query, `DELETE FROM "system_audit_log"`) {
		t.Fatalf("unexpected delete query: %s", state.execs[0].query)
	}
}
