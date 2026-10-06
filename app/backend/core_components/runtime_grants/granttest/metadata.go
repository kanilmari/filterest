// metadata.go
// Supplies an empty, valid grant catalogue to focused handler driver tests.
// Keeps their row-validation queues independent of the new mutation preflight.
// Real ACL and response-commit behaviour are proved by separate integration tests.
package granttest

import (
	"database/sql/driver"
	"io"
	"net/http/httptest"
	"strings"
	"testing"
)

func ConfigureRoles(t *testing.T) {
	t.Helper()
	for _, key := range []string{"DB_BASIC_USER", "DB_GUEST_USER", "DB_READONLY_USER", "DB_CONFIDENTIAL_USER"} {
		t.Setenv(key, key)
	}
}

// Recorder represents the explicitly buffered writer capability in direct
// transaction tests. It is never used for commit/error-delivery assertions.
type Recorder struct{ *httptest.ResponseRecorder }

func (r Recorder) EnableCommitBuffer() error { return nil }

type rows struct {
	columns int
	values  [][]driver.Value
}

func (r *rows) Columns() []string { return make([]string, r.columns) }
func (r *rows) Close() error      { return nil }
func (r *rows) Next(dest []driver.Value) error {
	if len(r.values) == 0 {
		return io.EOF
	}
	copy(dest, r.values[0])
	r.values = r.values[1:]
	return nil
}

// SnapshotQuery answers only the exact loader-shaped reads. Business SQL keeps
// going to the test's existing queue, so expected refusal queries still matter.
func SnapshotQuery(query string, args []driver.NamedValue) (driver.Rows, bool) {
	var columns int
	var values [][]driver.Value
	switch {
	case strings.Contains(query, "COALESCE(bool_or(protected),false)"):
		return &rows{columns: 1, values: [][]driver.Value{{false}}}, true
	case strings.Contains(query, "FROM pg_roles WHERE rolname=$1"):
		columns = 2
		for i, key := range []string{"DB_BASIC_USER", "DB_GUEST_USER", "DB_READONLY_USER", "DB_CONFIDENTIAL_USER"} {
			if args[0].Value == key {
				values = [][]driver.Value{{int64(i + 1), false}}
			}
		}
	case strings.Contains(query, "WITH RECURSIVE protected(oid)"):
		columns = 6
	case strings.Contains(query, "SELECT a.attrelid,a.attname"):
		columns = 4
	case strings.Contains(query, "SELECT to_regclass('public.system_db_tables')"):
		columns = 1
		values = [][]driver.Value{{true}}
	case strings.Contains(query, "FROM public.system_db_tables d ORDER BY d.id"):
		columns = 6
	case strings.Contains(query, "FROM public.system_functions ORDER BY id"):
		columns = 5
	case strings.Contains(query, "SELECT id,name FROM public.system_user_groups"):
		columns = 2
		values = [][]driver.Value{{int64(1), "admins"}, {int64(2), "users"}, {int64(3), "guests"}}
	case strings.Contains(query, "FROM public.system_user_group_memberships WHERE user_id=1"):
		columns = 2
	case strings.Contains(query, "SELECT id,user_group_id,function_id,target_table_uid FROM public.system_group_table_func_rights"):
		columns = 4
	case strings.Contains(query, "SELECT a.oid,a.adrelid,d.refobjid"):
		columns = 6
	case strings.Contains(query, "SELECT c.oid,c.conrelid"):
		columns = 5
	case strings.Contains(query, "SELECT t.oid,t.tgrelid,md5"):
		columns = 4
	case strings.Contains(query, "SELECT a.oid,a.adrelid,att.attname,p.oid"):
		columns = 8
	case strings.Contains(query, "SECURITY DEFINER execution requires review"):
		columns = 5
	default:
		return nil, false
	}
	return &rows{columns, values}, true
}
func IsPolicyLock(query string) bool {
	return strings.HasPrefix(query, "SET LOCAL lock_timeout") || strings.Contains(query, "pg_advisory_xact_lock(hashtext('filterest.runtime_role_write_revocations'))") || strings.Contains(query, "pg_advisory_xact_lock_shared(hashtext($1))")
}
