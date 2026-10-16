// db_role_management_handlers_test.go
// Exercises role handlers with an in-memory SQL driver and HTTP requests.
// Connects protection decisions to query ordering and the connection doing DDL.
// Proves request-time connection identity and fail-closed behavior without PostgreSQL.
package db_admin

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
)

type roleQueryStep struct {
	query string
	args  []driver.NamedValue
	value driver.Value
	err   error
}

type roleSQLFixture struct {
	t            *testing.T
	currentUser  string
	identityErr  error
	queries      []string
	steps        []roleQueryStep
	executions   []string
	identityRead int
}

type roleFixtureConn struct {
	fixture *roleSQLFixture
	checked bool
}

func (f *roleSQLFixture) Connect(context.Context) (driver.Conn, error) {
	return &roleFixtureConn{fixture: f}, nil
}
func (f *roleSQLFixture) Driver() driver.Driver { return f }
func (f *roleSQLFixture) Open(string) (driver.Conn, error) {
	return f.Connect(context.Background())
}
func (*roleFixtureConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepare")
}
func (*roleFixtureConn) Close() error { return nil }
func (*roleFixtureConn) Begin() (driver.Tx, error) {
	return nil, errors.New("unexpected transaction")
}
func (c *roleFixtureConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	f := c.fixture
	f.queries = append(f.queries, query)
	if query == "SELECT current_user" {
		if len(args) != 0 {
			f.t.Error("identity query must not use request data")
		}
		f.identityRead++
		c.checked = true
		if f.identityErr != nil {
			return nil, f.identityErr
		}
		return &roleFixtureRows{value: f.currentUser}, nil
	}
	if len(f.steps) == 0 {
		f.t.Error("unexpected database query after protection check")
		return nil, errors.New("unexpected query")
	}
	step := f.steps[0]
	f.steps = f.steps[1:]
	if strings.Join(strings.Fields(query), " ") != step.query || !reflect.DeepEqual(args, step.args) {
		f.t.Error("query or bound arguments differ from expected role lookup")
	}
	if step.err != nil {
		return nil, step.err
	}
	return &roleFixtureRows{value: step.value}, nil
}
func (c *roleFixtureConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	if !c.checked {
		c.fixture.t.Error("DDL used a connection whose current_user was not checked")
	}
	c.fixture.executions = append(c.fixture.executions, query)
	return driver.RowsAffected(1), nil
}

type roleFixtureRows struct {
	value driver.Value
	done  bool
}

func (*roleFixtureRows) Columns() []string { return []string{"value"} }
func (*roleFixtureRows) Close() error      { return nil }
func (r *roleFixtureRows) Next(values []driver.Value) error {
	if r.done {
		return io.EOF
	}
	values[0], r.done = r.value, true
	return nil
}

func installRoleSQLFixture(t *testing.T) *roleSQLFixture {
	t.Helper()
	f := &roleSQLFixture{t: t, currentUser: "site_connection"}
	db := sql.OpenDB(f)
	// Force pool-based operations to use different connections. A permitted
	// mutation must retain the connection used for its identity check.
	db.SetMaxIdleConns(0)
	previousDB := backend.Db
	backend.Db = db
	t.Cleanup(func() { backend.Db = previousDB; db.Close() })
	return f
}

func roleMutationHandlers() map[string]http.HandlerFunc {
	return map[string]http.HandlerFunc{
		"create": CreateRoleHandler,
		"update": UpdateRoleHandler,
		"delete": DeleteRoleHandler,
	}
}

func invokeRoleMutation(t *testing.T, operation string, handler http.HandlerFunc, name string) *httptest.ResponseRecorder {
	t.Helper()
	// Fixed fixture copy only; no real credential is read or logged.
	body, err := json.Marshal(map[string]any{"name": name, "password": "fixture-only", "can_login": false})
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	handler(w, httptest.NewRequest(http.MethodPost, "/api/db-roles/"+operation, strings.NewReader(string(body))))
	return w
}

func TestRoleMutationsRefuseNamedProtectedRoles(t *testing.T) {
	for operation, handler := range roleMutationHandlers() {
		for _, name := range []string{"mcpuser", "postgres", "admin_user", "MCPUSER", "POSTGRES", "ADMIN_USER"} {
			t.Run(operation+"/"+name, func(t *testing.T) {
				f := installRoleSQLFixture(t)
				w := invokeRoleMutation(t, operation, handler, name)
				if w.Code != http.StatusForbidden || len(f.executions) != 0 {
					t.Fatalf("status=%d executions=%d, want 403 without DDL", w.Code, len(f.executions))
				}
			})
		}
	}
}

func TestRoleMutationsRefuseCurrentUserOnEveryConnection(t *testing.T) {
	for operation, handler := range roleMutationHandlers() {
		t.Run(operation, func(t *testing.T) {
			f := installRoleSQLFixture(t)
			for _, name := range []string{"first_connection_role", "second_connection_role", "FIRST_CONNECTION_ROLE"} {
				f.currentUser = strings.ToLower(name)
				w := invokeRoleMutation(t, operation, handler, name)
				if w.Code != http.StatusForbidden {
					t.Errorf("status=%d, want 403 for current_user", w.Code)
				}
			}
			if f.identityRead != 3 || len(f.executions) != 0 || len(f.queries) != 3 {
				t.Fatalf("identity reads=%d queries=%d DDL=%d, want 3/3/0", f.identityRead, len(f.queries), len(f.executions))
			}
		})
	}
}

func TestRoleMutationsFailClosedWhenCurrentUserUnavailable(t *testing.T) {
	for operation, handler := range roleMutationHandlers() {
		t.Run(operation, func(t *testing.T) {
			f := installRoleSQLFixture(t)
			f.identityErr = errors.New("fixture identity unavailable")
			w := invokeRoleMutation(t, operation, handler, "ordinary_role")
			if w.Code != http.StatusInternalServerError || f.identityRead != 1 || len(f.queries) != 1 || len(f.executions) != 0 {
				t.Fatalf("status=%d identity reads=%d queries=%d DDL=%d", w.Code, f.identityRead, len(f.queries), len(f.executions))
			}
		})
	}
}

func TestRoleMutationsAllowOtherRolesOnCheckedConnection(t *testing.T) {
	for operation, handler := range roleMutationHandlers() {
		t.Run(operation, func(t *testing.T) {
			f := installRoleSQLFixture(t)
			value := driver.Value(true)
			query := "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1)"
			wantStatus := http.StatusOK
			wantSQL := "ALTER ROLE ordinary_role WITH NOLOGIN"
			if operation == "create" {
				value, wantStatus = false, http.StatusCreated
				wantSQL = "CREATE ROLE ordinary_role WITH NOLOGIN PASSWORD 'fixture-only'"
			} else if operation == "delete" {
				query = "SELECT count(*) FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = $1 AND c.relkind = 'r'"
				value = int64(0)
				wantSQL = "DROP ROLE IF EXISTS ordinary_role"
			}
			f.steps = []roleQueryStep{{query: query, args: []driver.NamedValue{{Ordinal: 1, Value: "ordinary_role"}}, value: value}}
			w := invokeRoleMutation(t, operation, handler, "ordinary_role")
			if w.Code != wantStatus || f.identityRead != 1 || len(f.steps) != 0 || !reflect.DeepEqual(f.executions, []string{wantSQL}) {
				t.Fatalf("status=%d identity reads=%d remaining queries=%d DDL count=%d", w.Code, f.identityRead, len(f.steps), len(f.executions))
			}
		})
	}
}

func TestRoleMutationsRejectOverlengthNamesBeforeDatabaseAccess(t *testing.T) {
	currentUser := strings.Repeat("c", 63)
	for operation, handler := range roleMutationHandlers() {
		for label, name := range map[string]string{
			"connection_64_bytes": currentUser + "x",
			"connection_suffix":   currentUser + "_suffix",
			"ordinary_64_bytes":   strings.Repeat("r", 64),
		} {
			t.Run(operation+"/"+label, func(t *testing.T) {
				f := installRoleSQLFixture(t)
				f.currentUser = currentUser
				w := invokeRoleMutation(t, operation, handler, name)
				if w.Code != http.StatusBadRequest || len(f.queries) != 0 || len(f.executions) != 0 {
					t.Fatalf("status=%d queries=%d DDL=%d, want 400 without database access", w.Code, len(f.queries), len(f.executions))
				}
			})
		}
	}
}

func TestRoleMutationsRefuse63ByteCurrentUser(t *testing.T) {
	for operation, handler := range roleMutationHandlers() {
		for _, name := range []string{strings.Repeat("c", 63), strings.Repeat("C", 63)} {
			t.Run(operation+"/"+name, func(t *testing.T) {
				f := installRoleSQLFixture(t)
				f.currentUser = strings.ToLower(name)
				w := invokeRoleMutation(t, operation, handler, name)
				if w.Code != http.StatusForbidden || f.identityRead != 1 || len(f.queries) != 1 || len(f.executions) != 0 {
					t.Fatalf("status=%d identity reads=%d queries=%d DDL=%d, want 403/1/1/0", w.Code, f.identityRead, len(f.queries), len(f.executions))
				}
			})
		}
	}
}

func TestRoleMutationsAllow63ByteRoles(t *testing.T) {
	name := strings.Repeat("r", 63)
	for operation, handler := range roleMutationHandlers() {
		t.Run(operation, func(t *testing.T) {
			f := installRoleSQLFixture(t)
			value := driver.Value(true)
			query := "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1)"
			wantStatus := http.StatusOK
			wantSQL := "ALTER ROLE " + name + " WITH NOLOGIN"
			if operation == "create" {
				value, wantStatus = false, http.StatusCreated
				wantSQL = "CREATE ROLE " + name + " WITH NOLOGIN PASSWORD 'fixture-only'"
			} else if operation == "delete" {
				query = "SELECT count(*) FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = $1 AND c.relkind = 'r'"
				value = int64(0)
				wantSQL = "DROP ROLE IF EXISTS " + name
			}
			f.steps = []roleQueryStep{{query: query, args: []driver.NamedValue{{Ordinal: 1, Value: name}}, value: value}}
			w := invokeRoleMutation(t, operation, handler, name)
			if w.Code != wantStatus || f.identityRead != 1 || len(f.steps) != 0 || !reflect.DeepEqual(f.executions, []string{wantSQL}) {
				t.Fatalf("status=%d identity reads=%d remaining queries=%d DDL count=%d", w.Code, f.identityRead, len(f.steps), len(f.executions))
			}
		})
	}
}

func TestNamedRoleProtectionMatchesTruncatedNames(t *testing.T) {
	name := strings.Repeat("n", 63)
	protectedRoles[name] = true
	t.Cleanup(func() { delete(protectedRoles, name) })
	for _, alias := range []string{name + "x", strings.ToUpper(name) + "_suffix"} {
		if !isProtectedRole(alias) {
			t.Errorf("63-byte named protected role was not protected from a truncation alias (%d bytes)", len(alias))
		}
	}
}

func TestRoleChangeConnectionRefusesTruncatedCurrentUserAliases(t *testing.T) {
	// Call the connection guard directly, bypassing request validation, to
	// prove protection still holds if the request length check moves later.
	for label, currentUser := range map[string]string{
		"ascii":             strings.Repeat("c", 63),
		"utf8_at_boundary":  strings.Repeat("c", 61) + "é",
		"utf8_across_limit": strings.Repeat("c", 62),
	} {
		t.Run(label, func(t *testing.T) {
			f := installRoleSQLFixture(t)
			f.currentUser = currentUser
			alias := strings.ToUpper(currentUser) + "é_suffix"
			conn, err := openRoleChangeConnection(context.Background(), alias)
			if conn != nil {
				conn.Close()
			}
			if !errors.Is(err, errProtectedRole) || conn != nil || f.identityRead != 1 || len(f.queries) != 1 || len(f.executions) != 0 {
				t.Fatalf("error=%v connection returned=%v identity reads=%d queries=%d DDL=%d", err, conn != nil, f.identityRead, len(f.queries), len(f.executions))
			}
		})
	}
}
