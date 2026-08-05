// permissions_reader_test.go
// Regression tests for startup permission backfills.
// Verifies the admin safety-net keeps table-specific permissions populated for registered tables.

package backend

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
)

type queuedPermissionExec struct {
	err          error
	rowsAffected int64
}

type permissionExecDriver struct{}
type permissionExecConn struct{}
type permissionExecStmt struct{}
type permissionExecTx struct{}
type permissionExecResult struct{ rowsAffected int64 }

var (
	permissionExecMu       sync.Mutex
	permissionExecQueue    []queuedPermissionExec
	permissionExecCalls    []string
	permissionExecInitOnce sync.Once
)

func TestEnsureAdminTablePermissionsExecutesGrantQuery(t *testing.T) {
	db := newPermissionExecTestDB(t)
	defer db.Close()

	pushPermissionExec(queuedPermissionExec{rowsAffected: 3})

	if err := EnsureAdminTablePermissions(db); err != nil {
		t.Fatalf("EnsureAdminTablePermissions returned error: %v", err)
	}

	calls := snapshotPermissionExecCalls()
	if len(calls) != 1 {
		t.Fatalf("exec calls = %d, want 1", len(calls))
	}
	if !strings.Contains(calls[0], "INSERT INTO system_group_table_func_rights") {
		t.Fatalf("exec[0] = %q, want permission insert", calls[0])
	}
	if !strings.Contains(calls[0], "specific_table_related") {
		t.Fatalf("exec[0] = %q, want table-specific filter", calls[0])
	}
}

func TestEnsureAdminTablePermissionsPropagatesExecError(t *testing.T) {
	db := newPermissionExecTestDB(t)
	defer db.Close()

	pushPermissionExec(queuedPermissionExec{err: errors.New("boom")})

	err := EnsureAdminTablePermissions(db)
	if err == nil || !strings.Contains(err.Error(), "EnsureAdminTablePermissions") {
		t.Fatalf("err = %v, want wrapped EnsureAdminTablePermissions error", err)
	}
}

func TestEnsureConfidentialRolePermissionsExecutesGrantQuery(t *testing.T) {
	db := newPermissionExecTestDB(t)
	defer db.Close()

	t.Setenv("DB_CONFIDENTIAL_USER", "limited_user")
	pushPermissionExec(queuedPermissionExec{rowsAffected: 1})

	if err := EnsureConfidentialRolePermissions(db); err != nil {
		t.Fatalf("EnsureConfidentialRolePermissions returned error: %v", err)
	}

	calls := snapshotPermissionExecCalls()
	if len(calls) != 1 {
		t.Fatalf("exec calls = %d, want 1", len(calls))
	}
	if !strings.Contains(calls[0], "GRANT USAGE ON SCHEMA restricted") {
		t.Fatalf("exec[0] = %q, want restricted schema grant", calls[0])
	}
	if !strings.Contains(calls[0], "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA restricted") {
		t.Fatalf("exec[0] = %q, want restricted table grant", calls[0])
	}
}

func TestEnsureConfidentialRolePermissionsNoopsWithoutRole(t *testing.T) {
	db := newPermissionExecTestDB(t)
	defer db.Close()

	t.Setenv("DB_CONFIDENTIAL_USER", "")

	if err := EnsureConfidentialRolePermissions(db); err != nil {
		t.Fatalf("EnsureConfidentialRolePermissions returned error: %v", err)
	}

	calls := snapshotPermissionExecCalls()
	if len(calls) != 0 {
		t.Fatalf("exec calls = %d, want 0", len(calls))
	}
}

func TestEnsureConfidentialRolePermissionsPropagatesExecError(t *testing.T) {
	db := newPermissionExecTestDB(t)
	defer db.Close()

	t.Setenv("DB_CONFIDENTIAL_USER", "limited_user")
	pushPermissionExec(queuedPermissionExec{err: errors.New("boom")})

	err := EnsureConfidentialRolePermissions(db)
	if err == nil || !strings.Contains(err.Error(), "EnsureConfidentialRolePermissions") {
		t.Fatalf("err = %v, want wrapped EnsureConfidentialRolePermissions error", err)
	}
}

func newPermissionExecTestDB(t *testing.T) *sql.DB {
	t.Helper()
	permissionExecInitOnce.Do(func() {
		sql.Register("easelect-permission-exec-test", &permissionExecDriver{})
	})
	resetPermissionExecState()
	db, err := sql.Open("easelect-permission-exec-test", time.Now().Format("150405.000000000"))
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	return db
}

func pushPermissionExec(exec queuedPermissionExec) {
	permissionExecMu.Lock()
	defer permissionExecMu.Unlock()
	permissionExecQueue = append(permissionExecQueue, exec)
}

func resetPermissionExecState() {
	permissionExecMu.Lock()
	defer permissionExecMu.Unlock()
	permissionExecQueue = nil
	permissionExecCalls = nil
}

func snapshotPermissionExecCalls() []string {
	permissionExecMu.Lock()
	defer permissionExecMu.Unlock()
	out := make([]string, len(permissionExecCalls))
	copy(out, permissionExecCalls)
	return out
}

func popPermissionExec() (queuedPermissionExec, bool) {
	permissionExecMu.Lock()
	defer permissionExecMu.Unlock()
	if len(permissionExecQueue) == 0 {
		return queuedPermissionExec{}, false
	}
	item := permissionExecQueue[0]
	permissionExecQueue = permissionExecQueue[1:]
	return item, true
}

func recordPermissionExecCall(query string) {
	permissionExecMu.Lock()
	defer permissionExecMu.Unlock()
	permissionExecCalls = append(permissionExecCalls, query)
}

func (d *permissionExecDriver) Open(_ string) (driver.Conn, error) { return &permissionExecConn{}, nil }
func (c *permissionExecConn) Prepare(_ string) (driver.Stmt, error) {
	return &permissionExecStmt{}, nil
}
func (c *permissionExecConn) Close() error              { return nil }
func (c *permissionExecConn) Begin() (driver.Tx, error) { return &permissionExecTx{}, nil }
func (tx *permissionExecTx) Commit() error              { return nil }
func (tx *permissionExecTx) Rollback() error            { return nil }

func (c *permissionExecConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	recordPermissionExecCall(query)
	exec, ok := popPermissionExec()
	if !ok {
		return nil, errors.New("mock: unexpected Exec call")
	}
	if exec.err != nil {
		return nil, exec.err
	}
	return permissionExecResult{rowsAffected: exec.rowsAffected}, nil
}

func (c *permissionExecConn) QueryContext(_ context.Context, _ string, _ []driver.NamedValue) (driver.Rows, error) {
	return nil, errors.New("mock: unexpected Query call")
}

func (s *permissionExecStmt) Close() error  { return nil }
func (s *permissionExecStmt) NumInput() int { return -1 }
func (s *permissionExecStmt) Exec(_ []driver.Value) (driver.Result, error) {
	return nil, errors.New("mock: unexpected Exec call")
}
func (s *permissionExecStmt) Query(_ []driver.Value) (driver.Rows, error) {
	return nil, errors.New("mock: unexpected Query call")
}

func (r permissionExecResult) LastInsertId() (int64, error) { return 0, nil }
func (r permissionExecResult) RowsAffected() (int64, error) { return r.rowsAffected, nil }
