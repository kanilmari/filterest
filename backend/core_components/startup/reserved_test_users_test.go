// reserved_test_users_test.go
// Verifies startup reconciliation for reserved dev-only test users.
// Bridges fake public/restricted DB executors and the reserved test-user policy.
// Exists to keep dev fixture creation and production purging safe without a live DB.
package startup

import (
	"database/sql"
	"database/sql/driver"
	"errors"
	"strings"
	"testing"
)

type reservedTestUserFakeStore struct {
	queryRows []reservedTestUserFakeRow
	execs     []reservedTestUserFakeResult
	calls     []reservedTestUserFakeCall
}

type reservedTestUserFakeCall struct {
	kind  string
	query string
	args  []interface{}
}

type reservedTestUserFakeRow struct {
	values []interface{}
	err    error
}

type reservedTestUserFakeResult struct {
	rowsAffected int64
	err          error
}

func TestReconcileReservedTestUsersDevCreatesMissingUsers(t *testing.T) {
	t.Setenv("TEST_USER_PASS", "user-secret")
	t.Setenv("TEST_ADMIN_PASS", "admin-secret")

	publicStore := &reservedTestUserFakeStore{}
	confidentialStore := &reservedTestUserFakeStore{}

	publicStore.pushQueryRow(2)
	publicStore.pushQueryErr(sql.ErrNoRows)
	publicStore.pushQueryRow(100)
	publicStore.pushExecRows(0)
	publicStore.pushExecRows(1)
	publicStore.pushQueryRow(1)
	publicStore.pushQueryErr(sql.ErrNoRows)
	publicStore.pushQueryRow(101)
	publicStore.pushExecRows(0)
	publicStore.pushExecRows(1)

	confidentialStore.pushExecRows(0)
	confidentialStore.pushExecRows(1)
	confidentialStore.pushExecRows(0)
	confidentialStore.pushExecRows(1)

	if err := reconcileReservedTestUsers(publicStore, confidentialStore, "dev"); err != nil {
		t.Fatalf("reconcileReservedTestUsers(dev): %v", err)
	}

	publicCalls := publicStore.snapshotCalls()
	if countCallsContaining(publicCalls, "INSERT INTO system_users") != 2 {
		t.Fatalf("expected two public user inserts, got calls: %#v", publicCalls)
	}
	if countCallsContaining(publicCalls, "DELETE FROM system_user_group_memberships WHERE user_id = $1 AND group_id <> $2") != 2 {
		t.Fatalf("expected stale membership cleanup for both fixtures, got calls: %#v", publicCalls)
	}
	assertPublicInsertAdminFlag(t, publicCalls, "test_user", false)
	assertPublicInsertAdminFlag(t, publicCalls, "test_admin", true)

	confidentialCalls := confidentialStore.snapshotCalls()
	if countCallsContaining(confidentialCalls, "INSERT INTO restricted.users_restricted") != 2 {
		t.Fatalf("expected two restricted credential inserts, got calls: %#v", confidentialCalls)
	}
}

func TestReconcileReservedTestUsersCanBeDisabled(t *testing.T) {
	t.Setenv("RESERVED_TEST_USERS", "disabled")

	publicStore := &reservedTestUserFakeStore{}
	confidentialStore := &reservedTestUserFakeStore{}

	if err := reconcileReservedTestUsers(publicStore, confidentialStore, "dev"); err != nil {
		t.Fatalf("reconcileReservedTestUsers(disabled): %v", err)
	}

	if calls := publicStore.snapshotCalls(); len(calls) != 0 {
		t.Fatalf("did not expect public DB calls when disabled, got calls: %#v", calls)
	}
	if calls := confidentialStore.snapshotCalls(); len(calls) != 0 {
		t.Fatalf("did not expect restricted DB calls when disabled, got calls: %#v", calls)
	}
}

func TestReconcileReservedTestUsersDevRepairsExistingUsers(t *testing.T) {
	publicStore := &reservedTestUserFakeStore{}
	confidentialStore := &reservedTestUserFakeStore{}

	publicStore.pushQueryRow(2)
	publicStore.pushQueryRow(100)
	publicStore.pushExecRows(1)
	publicStore.pushExecRows(1)
	publicStore.pushExecRows(0)
	publicStore.pushQueryRow(1)
	publicStore.pushQueryRow(101)
	publicStore.pushExecRows(1)
	publicStore.pushExecRows(1)
	publicStore.pushExecRows(0)

	confidentialStore.pushExecRows(1)
	confidentialStore.pushExecRows(1)

	if err := reconcileReservedTestUsers(publicStore, confidentialStore, "DEV"); err != nil {
		t.Fatalf("reconcileReservedTestUsers(DEV): %v", err)
	}

	publicCalls := publicStore.snapshotCalls()
	if countCallsContaining(publicCalls, "UPDATE system_users") != 2 {
		t.Fatalf("expected two public user updates, got calls: %#v", publicCalls)
	}
	if countCallsContaining(publicCalls, "INSERT INTO system_users") != 0 {
		t.Fatalf("did not expect public inserts for existing users, got calls: %#v", publicCalls)
	}
	confidentialCalls := confidentialStore.snapshotCalls()
	if countCallsContaining(confidentialCalls, "INSERT INTO restricted.users_restricted") != 0 {
		t.Fatalf("did not expect restricted inserts when updates affected rows, got calls: %#v", confidentialCalls)
	}
}

func TestReconcileReservedTestUsersProductionPurgesReservedUsers(t *testing.T) {
	publicStore := &reservedTestUserFakeStore{}
	confidentialStore := &reservedTestUserFakeStore{}

	publicStore.pushQueryRow(100)
	publicStore.pushExecRows(1)
	publicStore.pushExecRows(1)
	publicStore.pushExecRows(1)
	publicStore.pushQueryRow(101)
	publicStore.pushExecRows(1)
	publicStore.pushExecRows(1)
	publicStore.pushExecRows(1)

	confidentialStore.pushExecRows(1)
	confidentialStore.pushExecRows(1)

	if err := reconcileReservedTestUsers(publicStore, confidentialStore, "production"); err != nil {
		t.Fatalf("reconcileReservedTestUsers(production): %v", err)
	}

	publicCalls := publicStore.snapshotCalls()
	if countCallsContaining(publicCalls, "UPDATE system_users") != 2 {
		t.Fatalf("expected both public users disabled before purge, got calls: %#v", publicCalls)
	}
	if countCallsContaining(publicCalls, "DELETE FROM system_users WHERE id = $1") != 2 {
		t.Fatalf("expected both public users deleted, got calls: %#v", publicCalls)
	}
	if countCallsContaining(publicCalls, "INSERT INTO system_users") != 0 {
		t.Fatalf("did not expect production-like mode to insert users, got calls: %#v", publicCalls)
	}

	confidentialCalls := confidentialStore.snapshotCalls()
	if countCallsContaining(confidentialCalls, "DELETE FROM restricted.users_restricted") != 2 {
		t.Fatalf("expected both restricted credentials deleted, got calls: %#v", confidentialCalls)
	}
}

func TestReconcileReservedTestUsersUnsetEnvironmentPurgesProductionLike(t *testing.T) {
	publicStore := &reservedTestUserFakeStore{}
	confidentialStore := &reservedTestUserFakeStore{}

	publicStore.pushQueryErr(sql.ErrNoRows)
	publicStore.pushQueryErr(sql.ErrNoRows)

	if err := reconcileReservedTestUsers(publicStore, confidentialStore, ""); err != nil {
		t.Fatalf("reconcileReservedTestUsers(empty env): %v", err)
	}

	if calls := confidentialStore.snapshotCalls(); len(calls) != 0 {
		t.Fatalf("did not expect restricted writes when reserved users are absent, got calls: %#v", calls)
	}
}

func (s *reservedTestUserFakeStore) QueryRow(query string, args ...interface{}) reservedTestUserRow {
	s.calls = append(s.calls, reservedTestUserFakeCall{
		kind:  "query",
		query: query,
		args:  append([]interface{}{}, args...),
	})
	if len(s.queryRows) == 0 {
		return reservedTestUserFakeRow{err: errors.New("unexpected QueryRow call")}
	}
	row := s.queryRows[0]
	s.queryRows = s.queryRows[1:]
	return row
}

func (s *reservedTestUserFakeStore) Exec(query string, args ...interface{}) (sql.Result, error) {
	s.calls = append(s.calls, reservedTestUserFakeCall{
		kind:  "exec",
		query: query,
		args:  append([]interface{}{}, args...),
	})
	if len(s.execs) == 0 {
		return nil, errors.New("unexpected Exec call")
	}
	result := s.execs[0]
	s.execs = s.execs[1:]
	if result.err != nil {
		return nil, result.err
	}
	return reservedTestUserFakeSQLResult{rowsAffected: result.rowsAffected}, nil
}

func (s *reservedTestUserFakeStore) pushQueryRow(values ...interface{}) {
	s.queryRows = append(s.queryRows, reservedTestUserFakeRow{values: values})
}

func (s *reservedTestUserFakeStore) pushQueryErr(err error) {
	s.queryRows = append(s.queryRows, reservedTestUserFakeRow{err: err})
}

func (s *reservedTestUserFakeStore) pushExecRows(rowsAffected int64) {
	s.execs = append(s.execs, reservedTestUserFakeResult{rowsAffected: rowsAffected})
}

func (s *reservedTestUserFakeStore) snapshotCalls() []reservedTestUserFakeCall {
	return append([]reservedTestUserFakeCall{}, s.calls...)
}

func (r reservedTestUserFakeRow) Scan(dest ...interface{}) error {
	if r.err != nil {
		return r.err
	}
	if len(dest) != len(r.values) {
		return errors.New("scan destination count mismatch")
	}
	for i, value := range r.values {
		switch target := dest[i].(type) {
		case *int64:
			v, ok := value.(int)
			if ok {
				*target = int64(v)
				continue
			}
			int64Value, ok := value.(int64)
			if !ok {
				return errors.New("scan value is not int64")
			}
			*target = int64Value
		default:
			return errors.New("unsupported scan destination")
		}
	}
	return nil
}

type reservedTestUserFakeSQLResult struct {
	rowsAffected int64
}

func (r reservedTestUserFakeSQLResult) LastInsertId() (int64, error) {
	return 0, driver.ErrSkip
}

func (r reservedTestUserFakeSQLResult) RowsAffected() (int64, error) {
	return r.rowsAffected, nil
}

func countCallsContaining(calls []reservedTestUserFakeCall, needle string) int {
	count := 0
	for _, call := range calls {
		if strings.Contains(call.query, needle) {
			count++
		}
	}
	return count
}

func assertPublicInsertAdminFlag(t *testing.T, calls []reservedTestUserFakeCall, username string, want bool) {
	t.Helper()
	for _, call := range calls {
		if !strings.Contains(call.query, "INSERT INTO system_users") {
			continue
		}
		if len(call.args) < 3 || call.args[0] != username {
			continue
		}
		got, ok := call.args[2].(bool)
		if !ok {
			t.Fatalf("admin flag for %s was not bool in call %#v", username, call)
		}
		if got != want {
			t.Fatalf("admin flag for %s = %v, want %v", username, got, want)
		}
		return
	}
	t.Fatalf("did not find public insert call for %s in %#v", username, calls)
}
