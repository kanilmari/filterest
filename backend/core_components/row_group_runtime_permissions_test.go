// row_group_runtime_permissions_test.go
// Verifies startup reconciliation for instance-specific row-group reader roles.
// Bridges protected-role validation, bootstrap-object checks, and least-privilege grants.
// Exists so a mistaken role setting cannot revoke administrator rights during startup.
package backend

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync/atomic"
	"testing"
)

type rowGroupPermissionTestState struct {
	currentRole    string
	relationsExist bool
	safeRoles      map[string]bool
	queries        []string
	execs          []string
	committed      bool
	rolledBack     bool
}

type rowGroupPermissionTestDriver struct{ state *rowGroupPermissionTestState }
type rowGroupPermissionTestConn struct{ state *rowGroupPermissionTestState }
type rowGroupPermissionTestTx struct{ state *rowGroupPermissionTestState }
type rowGroupPermissionTestRows struct {
	columns []string
	rows    [][]driver.Value
	index   int
}

var rowGroupPermissionDriverCounter int64

func TestRowGroupRuntimeRoleGrantSQLIsSelectOnly(t *testing.T) {
	grantSQL, err := rowGroupRuntimeRoleGrantSQL("filterest_guest_123")
	if err != nil {
		t.Fatalf("rowGroupRuntimeRoleGrantSQL returned error: %v", err)
	}
	for _, fragment := range []string{
		`GRANT USAGE ON SCHEMA public TO "filterest_guest_123"`,
		"REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER",
		"REVOKE USAGE, UPDATE",
		"GRANT SELECT",
	} {
		if !strings.Contains(grantSQL, fragment) {
			t.Fatalf("grant SQL lacks %q: %s", fragment, grantSQL)
		}
	}
	if strings.Contains(grantSQL, "GRANT INSERT") || strings.Contains(grantSQL, "GRANT USAGE, UPDATE ON SEQUENCE") {
		t.Fatalf("grant SQL broadens runtime write access: %s", grantSQL)
	}
}

func TestRowGroupRuntimeRoleGrantSQLRejectsUnsafeIdentifier(t *testing.T) {
	if _, err := rowGroupRuntimeRoleGrantSQL(`guest_user"; GRANT ALL TO public; --`); err == nil {
		t.Fatal("rowGroupRuntimeRoleGrantSQL accepted an unsafe role identifier")
	}
}

func TestEnsureRowGroupRuntimeRolePermissionsCommitsValidatedRoles(t *testing.T) {
	database, state := openRowGroupPermissionTestDB(t, &rowGroupPermissionTestState{
		currentRole:    "filterest_admin_123",
		relationsExist: true,
		safeRoles:      map[string]bool{"filterest_guest_123": true},
	})
	setRowGroupPermissionTestEnvironment(t)
	t.Setenv("DB_GUEST_USER", "filterest_guest_123")
	t.Setenv("DB_READONLY_USER", "filterest_guest_123")
	t.Setenv("DB_ADMIN_USER", "filterest_admin_123")

	if err := EnsureRowGroupRuntimeRolePermissions(database); err != nil {
		t.Fatalf("EnsureRowGroupRuntimeRolePermissions returned error: %v", err)
	}
	if len(state.execs) != 1 {
		t.Fatalf("exec count = %d, want one deduplicated grant", len(state.execs))
	}
	if !state.committed || state.rolledBack {
		t.Fatalf("transaction state: committed=%v rolledBack=%v", state.committed, state.rolledBack)
	}
}

func TestEnsureRowGroupRuntimeRolePermissionsRejectsProtectedRoleBeforeQueryOrExec(t *testing.T) {
	database, state := openRowGroupPermissionTestDB(t, &rowGroupPermissionTestState{})
	setRowGroupPermissionTestEnvironment(t)
	t.Setenv("DB_BASIC_USER", "filterest_admin_123")
	t.Setenv("DB_ADMIN_USER", "filterest_admin_123")

	err := EnsureRowGroupRuntimeRolePermissions(database)
	if err == nil || !strings.Contains(err.Error(), "must not equal protected role") {
		t.Fatalf("error = %v, want protected-role rejection", err)
	}
	if len(state.queries) != 0 || len(state.execs) != 0 {
		t.Fatalf("protected role reached database: queries=%d execs=%d", len(state.queries), len(state.execs))
	}
}

func TestEnsureRowGroupRuntimeRolePermissionsRejectsCurrentOrPrivilegedRoleWithoutExec(t *testing.T) {
	for _, testCase := range []struct {
		name        string
		currentRole string
		safe        bool
		wantError   string
	}{
		{name: "current database role", currentRole: "runtime_reader", safe: true, wantError: "current database role"},
		{name: "privileged database role", currentRole: "separate_admin", safe: false, wantError: "protected database privileges"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			database, state := openRowGroupPermissionTestDB(t, &rowGroupPermissionTestState{
				currentRole:    testCase.currentRole,
				relationsExist: true,
				safeRoles:      map[string]bool{"runtime_reader": testCase.safe},
			})
			setRowGroupPermissionTestEnvironment(t)
			t.Setenv("DB_BASIC_USER", "runtime_reader")

			err := EnsureRowGroupRuntimeRolePermissions(database)
			if err == nil || !strings.Contains(err.Error(), testCase.wantError) {
				t.Fatalf("error = %v, want %q", err, testCase.wantError)
			}
			if len(state.execs) != 0 {
				t.Fatalf("unsafe role executed %d statement(s)", len(state.execs))
			}
		})
	}
}

func TestEnsureRowGroupRuntimeRolePermissionsRejectsPartialBootstrapBeforeRoleGrant(t *testing.T) {
	database, state := openRowGroupPermissionTestDB(t, &rowGroupPermissionTestState{
		currentRole:    "filterest_admin_123",
		relationsExist: false,
		safeRoles:      map[string]bool{"runtime_reader": true},
	})
	setRowGroupPermissionTestEnvironment(t)
	t.Setenv("DB_READONLY_USER", "runtime_reader")

	err := EnsureRowGroupRuntimeRolePermissions(database)
	if err == nil || !strings.Contains(err.Error(), "tables or identity sequences are missing") {
		t.Fatalf("error = %v, want partial-bootstrap rejection", err)
	}
	if len(state.queries) != 1 || len(state.execs) != 0 {
		t.Fatalf("partial bootstrap continued: queries=%d execs=%d", len(state.queries), len(state.execs))
	}
}

func setRowGroupPermissionTestEnvironment(t *testing.T) {
	t.Helper()
	allKeys := append([]string{}, rowGroupRuntimeRoleEnvironmentKeys...)
	allKeys = append(allKeys, rowGroupProtectedRoleEnvironmentKeys...)
	for _, key := range allKeys {
		t.Setenv(key, "")
	}
}

func openRowGroupPermissionTestDB(t *testing.T, state *rowGroupPermissionTestState) (*sql.DB, *rowGroupPermissionTestState) {
	t.Helper()
	driverName := fmt.Sprintf("row_group_permission_%d", atomic.AddInt64(&rowGroupPermissionDriverCounter, 1))
	sql.Register(driverName, &rowGroupPermissionTestDriver{state: state})
	database, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	database.SetMaxOpenConns(1)
	database.SetMaxIdleConns(1)
	t.Cleanup(func() { _ = database.Close() })
	return database, state
}

func (driverInstance *rowGroupPermissionTestDriver) Open(string) (driver.Conn, error) {
	return &rowGroupPermissionTestConn{state: driverInstance.state}, nil
}

func (*rowGroupPermissionTestConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("prepare is not supported")
}

func (*rowGroupPermissionTestConn) Close() error { return nil }

func (connection *rowGroupPermissionTestConn) Begin() (driver.Tx, error) {
	return &rowGroupPermissionTestTx{state: connection.state}, nil
}

func (connection *rowGroupPermissionTestConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	connection.state.queries = append(connection.state.queries, query)
	if strings.Contains(query, "to_regclass('public.system_row_groups')") {
		exists := connection.state.relationsExist
		return &rowGroupPermissionTestRows{
			columns: []string{"current_user", "groups", "memberships", "groups_sequence", "memberships_sequence"},
			rows:    [][]driver.Value{{connection.state.currentRole, exists, exists, exists, exists}},
		}, nil
	}
	if strings.Contains(query, "FROM pg_roles AS candidate") {
		roleName, _ := args[0].Value.(string)
		return &rowGroupPermissionTestRows{
			columns: []string{"exists"},
			rows:    [][]driver.Value{{connection.state.safeRoles[roleName]}},
		}, nil
	}
	return nil, fmt.Errorf("unexpected query: %s", query)
}

func (connection *rowGroupPermissionTestConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	connection.state.execs = append(connection.state.execs, query)
	return driver.RowsAffected(1), nil
}

func (transaction *rowGroupPermissionTestTx) Commit() error {
	transaction.state.committed = true
	return nil
}

func (transaction *rowGroupPermissionTestTx) Rollback() error {
	if !transaction.state.committed {
		transaction.state.rolledBack = true
	}
	return nil
}

func (rows *rowGroupPermissionTestRows) Columns() []string { return rows.columns }
func (*rowGroupPermissionTestRows) Close() error           { return nil }
func (rows *rowGroupPermissionTestRows) Next(values []driver.Value) error {
	if rows.index >= len(rows.rows) {
		return io.EOF
	}
	copy(values, rows.rows[rows.index])
	rows.index++
	return nil
}
