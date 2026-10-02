// runtime_role_write_revocations_test.go
// Verifies the startup step that removes guest writes and privilege-editing rights.
// Bridges role-setting validation, grantor-aware statement execution and the fail-closed checks.
// Exists so a mistaken role setting or a surprising catalog cannot quietly narrow other roles' rights.
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

type writeRevocationTestState struct {
	problems    string
	keptRights  []string
	revocations [][]driver.Value
	violations  string
	roleArgs    [][]string
	execs       []string
	keptReads   int
	committed   bool
	rolledBack  bool
}

type writeRevocationTestDriver struct{ state *writeRevocationTestState }
type writeRevocationTestConn struct{ state *writeRevocationTestState }
type writeRevocationTestTx struct{ state *writeRevocationTestState }
type writeRevocationTestRows struct {
	columns []string
	rows    [][]driver.Value
	index   int
}

var writeRevocationDriverCounter int64

func setWriteRevocationTestEnvironment(t *testing.T) {
	t.Helper()
	t.Setenv("DB_GUEST_USER", "site_guest")
	t.Setenv("DB_BASIC_USER", "site_basic")
	t.Setenv("DB_READONLY_USER", "site_reader")
	t.Setenv("DB_CONFIDENTIAL_USER", "site_confidential")
	t.Setenv("DB_ADMIN_USER", "site_admin")
	t.Setenv("DB_USER", "site_owner")
}

func TestRuntimeWriteRevocationRolesRequireEverySetting(t *testing.T) {
	database, state := openWriteRevocationTestDB(t, &writeRevocationTestState{})
	setWriteRevocationTestEnvironment(t)
	t.Setenv("DB_CONFIDENTIAL_USER", "")

	err := EnsureGuestAndPrivilegeViewWriteRevocations(database)
	if err == nil || !strings.Contains(err.Error(), "DB_CONFIDENTIAL_USER is not set") {
		t.Fatalf("error = %v, want the missing setting named", err)
	}
	if len(state.execs) != 0 || len(state.roleArgs) != 0 {
		t.Fatalf("a missing setting reached the database: execs=%v queries=%d", state.execs, len(state.roleArgs))
	}
}

func TestRuntimeWriteRevocationRolesRejectProtectedAndSharedRoles(t *testing.T) {
	for _, testCase := range []struct {
		name      string
		key       string
		value     string
		wantError string
	}{
		{name: "guest is the administrator connection", key: "DB_GUEST_USER", value: "site_admin", wantError: "must not equal protected role"},
		{name: "basic is the installation owner", key: "DB_BASIC_USER", value: "site_owner", wantError: "must not equal protected role"},
		{name: "readonly is the PostgreSQL superuser", key: "DB_READONLY_USER", value: "postgres", wantError: "must not equal protected role"},
		{name: "guest is the signed-in role", key: "DB_GUEST_USER", value: "site_basic", wantError: "DB_GUEST_USER must differ from DB_BASIC_USER"},
		{name: "guest is the confidential role", key: "DB_CONFIDENTIAL_USER", value: "site_guest", wantError: "DB_GUEST_USER must differ from DB_CONFIDENTIAL_USER"},
		{name: "unsafe identifier", key: "DB_GUEST_USER", value: `site_guest"; GRANT ALL TO public; --`, wantError: "invalid identifier"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			database, state := openWriteRevocationTestDB(t, &writeRevocationTestState{})
			setWriteRevocationTestEnvironment(t)
			t.Setenv(testCase.key, testCase.value)

			err := EnsureGuestAndPrivilegeViewWriteRevocations(database)
			if err == nil || !strings.Contains(err.Error(), testCase.wantError) {
				t.Fatalf("error = %v, want %q", err, testCase.wantError)
			}
			if len(state.execs) != 0 || len(state.roleArgs) != 0 {
				t.Fatalf("a refused setting reached the database: execs=%v queries=%d", state.execs, len(state.roleArgs))
			}
		})
	}
}

func TestRuntimeWriteRevocationRolesAllowReadOnlyRoleSharedWithGuest(t *testing.T) {
	setWriteRevocationTestEnvironment(t)
	t.Setenv("DB_READONLY_USER", "site_guest")
	roles, err := configuredRuntimeWriteRevocationRoles()
	if err != nil {
		t.Fatalf("a read-only role shared with the guest was refused: %v", err)
	}
	if strings.Join(roles, ",") != "site_guest,site_basic,site_guest,site_confidential" {
		t.Fatalf("roles = %v, want guest, basic, readonly, confidential order", roles)
	}
}

func TestEnsureGuestAndPrivilegeViewWriteRevocationsRevokesAsEachGrantor(t *testing.T) {
	database, state := openWriteRevocationTestDB(t, &writeRevocationTestState{
		keptRights: []string{"basic public.notes INSERT", "basic public.notes INSERT"},
		revocations: [][]driver.Value{
			{"guest_relation", "", `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.notes FROM site_guest`},
			{"guest_relation", "granting_editor", `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.tickets FROM site_guest`},
			{"default_privilege", "", `ALTER DEFAULT PRIVILEGES FOR ROLE site_owner IN SCHEMA public REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM site_guest`},
		},
	})
	setWriteRevocationTestEnvironment(t)

	if err := EnsureGuestAndPrivilegeViewWriteRevocations(database); err != nil {
		t.Fatalf("EnsureGuestAndPrivilegeViewWriteRevocations returned error: %v", err)
	}
	want := []string{
		"SELECT pg_advisory_xact_lock(hashtext('filterest.runtime_role_write_revocations'))",
		`REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.notes FROM site_guest`,
		`SET LOCAL ROLE "granting_editor"`,
		`REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.tickets FROM site_guest`,
		"RESET ROLE",
		`ALTER DEFAULT PRIVILEGES FOR ROLE site_owner IN SCHEMA public REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM site_guest`,
	}
	if strings.Join(state.execs, "\n") != strings.Join(want, "\n") {
		t.Fatalf("executed statements:\n%s\nwant:\n%s", strings.Join(state.execs, "\n"), strings.Join(want, "\n"))
	}
	for _, arguments := range state.roleArgs {
		if strings.Join(arguments, ",") != "site_guest,site_basic,site_reader,site_confidential" {
			t.Fatalf("catalog query role arguments = %v, want guest, basic, readonly, confidential", arguments)
		}
	}
	if !state.committed || state.rolledBack {
		t.Fatalf("transaction state: committed=%v rolledBack=%v", state.committed, state.rolledBack)
	}
}

func TestEnsureGuestAndPrivilegeViewWriteRevocationsFailsClosed(t *testing.T) {
	revokeNotes := []driver.Value{"guest_relation", "", `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.notes FROM site_guest`}
	for _, testCase := range []struct {
		name        string
		state       writeRevocationTestState
		wantError   string
		wantRevokes int
	}{
		{
			name:      "unsafe role setup",
			state:     writeRevocationTestState{problems: "role is a superuser: basic", revocations: [][]driver.Value{revokeNotes}},
			wantError: "unsafe runtime role setup: role is a superuser: basic",
		},
		{
			name: "other roles would lose a right",
			state: writeRevocationTestState{
				keptRights:  []string{"basic public.notes INSERT\nreadonly public.notes INSERT", "basic public.notes INSERT"},
				revocations: [][]driver.Value{{"guest_relation", "", `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.notes FROM PUBLIC`}},
			},
			wantError:   "would lose readonly public.notes INSERT; would gain nothing",
			wantRevokes: 1,
		},
		{
			name: "a right survives",
			state: writeRevocationTestState{
				revocations: [][]driver.Value{revokeNotes},
				violations:  "the guest role can still write 1 table(s) or view(s), for example public.notes",
			},
			wantError:   "rights remain after the revocations (the guest role can still write 1 table(s)",
			wantRevokes: 1,
		},
		{
			name:      "an unexpected statement",
			state:     writeRevocationTestState{revocations: [][]driver.Value{{"guest_relation", "", "GRANT ALL ON TABLE public.notes TO site_guest"}}},
			wantError: "refused unexpected statement",
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			state := testCase.state
			database, _ := openWriteRevocationTestDB(t, &state)
			setWriteRevocationTestEnvironment(t)

			err := EnsureGuestAndPrivilegeViewWriteRevocations(database)
			if err == nil || !strings.Contains(err.Error(), testCase.wantError) {
				t.Fatalf("error = %v, want %q", err, testCase.wantError)
			}
			revokes := 0
			for _, statement := range state.execs {
				if strings.HasPrefix(statement, "REVOKE ") || strings.HasPrefix(statement, "GRANT ") {
					revokes++
				}
			}
			if revokes != testCase.wantRevokes {
				t.Fatalf("executed %d grant statement(s), want %d: %v", revokes, testCase.wantRevokes, state.execs)
			}
			if state.committed || !state.rolledBack {
				t.Fatalf("transaction state: committed=%v rolledBack=%v, want rolled back", state.committed, state.rolledBack)
			}
		})
	}
}

func openWriteRevocationTestDB(t *testing.T, state *writeRevocationTestState) (*sql.DB, *writeRevocationTestState) {
	t.Helper()
	driverName := fmt.Sprintf("runtime_write_revocation_%d", atomic.AddInt64(&writeRevocationDriverCounter, 1))
	sql.Register(driverName, &writeRevocationTestDriver{state: state})
	database, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	database.SetMaxOpenConns(1)
	database.SetMaxIdleConns(1)
	t.Cleanup(func() { _ = database.Close() })
	return database, state
}

func (driverInstance *writeRevocationTestDriver) Open(string) (driver.Conn, error) {
	return &writeRevocationTestConn{state: driverInstance.state}, nil
}

func (*writeRevocationTestConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("prepare is not supported")
}

func (*writeRevocationTestConn) Close() error { return nil }

func (connection *writeRevocationTestConn) Begin() (driver.Tx, error) {
	return &writeRevocationTestTx{state: connection.state}, nil
}

func (connection *writeRevocationTestConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	state := connection.state
	roleArguments := make([]string, 0, len(args))
	for _, argument := range args {
		value, _ := argument.Value.(string)
		roleArguments = append(roleArguments, value)
	}
	state.roleArgs = append(state.roleArgs, roleArguments)

	single := func(value string) driver.Rows {
		return &writeRevocationTestRows{columns: []string{"result"}, rows: [][]driver.Value{{value}}}
	}
	switch {
	case strings.Contains(query, "'role not found: '"):
		return single(state.problems), nil
	case strings.Contains(query, "kept_roles AS"):
		kept := ""
		if state.keptReads < len(state.keptRights) {
			kept = state.keptRights[state.keptReads]
		}
		state.keptReads++
		return single(kept), nil
	case strings.Contains(query, "revocations (category, acting_role, statement)"):
		return &writeRevocationTestRows{columns: []string{"category", "acting_role", "statement"}, rows: state.revocations}, nil
	case strings.Contains(query, "the guest role can still write"):
		return single(state.violations), nil
	}
	return nil, fmt.Errorf("unexpected query: %s", query)
}

func (connection *writeRevocationTestConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	connection.state.execs = append(connection.state.execs, query)
	return driver.RowsAffected(0), nil
}

func (transaction *writeRevocationTestTx) Commit() error {
	transaction.state.committed = true
	return nil
}

func (transaction *writeRevocationTestTx) Rollback() error {
	if !transaction.state.committed {
		transaction.state.rolledBack = true
	}
	return nil
}

func (rows *writeRevocationTestRows) Columns() []string { return rows.columns }
func (*writeRevocationTestRows) Close() error           { return nil }
func (rows *writeRevocationTestRows) Next(values []driver.Value) error {
	if rows.index >= len(rows.rows) {
		return io.EOF
	}
	copy(values, rows.rows[rows.index])
	rows.index++
	return nil
}
