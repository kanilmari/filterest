// route_security_fixture_test.go
// Supplies deterministic SQL rows for real agent-tools handlers and security stages.
// Bridges HTTP regression tests and database/sql without sockets or stored data.
// Exists so authorization and error-disclosure proofs run without PostgreSQL.
package agent_tools

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	appregistry "easelect/backend/core_components/app_registry"
	"easelect/backend/pipeline"
)

type agentToolRouteFixture struct {
	path, name string
	handler    http.HandlerFunc
	methods    []string
}

func agentToolRegisteredRoutes() []agentToolRouteFixture {
	Register()
	var routes []agentToolRouteFixture
	appregistry.RegisterRoutes(func(path string, handler http.HandlerFunc, name string, methods ...string) {
		if strings.HasPrefix(path, "/api/app/agent-tools/") {
			routes = append(routes, agentToolRouteFixture{path, name, handler, methods})
		}
	})
	return routes
}

type agentToolSQLFixture struct {
	admin, grant, loginToBrowse bool
	businessCalls, grantChecks  int
	fail                        bool
	rowFault                    string
}

type agentToolFixtureConnector struct{ fixture *agentToolSQLFixture }
type agentToolFixtureConn struct{ fixture *agentToolSQLFixture }
type agentToolFixtureDriver struct{}
type agentToolFixtureTx struct{}
type agentToolFixtureRows struct {
	values  []driver.Value
	done    bool
	nextErr error
}

func (c agentToolFixtureConnector) Connect(context.Context) (driver.Conn, error) {
	return agentToolFixtureConn{c.fixture}, nil
}
func (agentToolFixtureConnector) Driver() driver.Driver { return agentToolFixtureDriver{} }
func (agentToolFixtureDriver) Open(string) (driver.Conn, error) {
	return nil, fmt.Errorf("use the in-memory connector")
}
func (agentToolFixtureConn) Prepare(string) (driver.Stmt, error) {
	return nil, fmt.Errorf("unexpected prepared statement")
}
func (agentToolFixtureConn) Close() error { return nil }
func (c agentToolFixtureConn) Begin() (driver.Tx, error) {
	if err := c.fixture.businessCall(); err != nil {
		return nil, err
	}
	return agentToolFixtureTx{}, nil
}
func (agentToolFixtureTx) Commit() error   { return nil }
func (agentToolFixtureTx) Rollback() error { return nil }
func (r *agentToolFixtureRows) Columns() []string {
	columns := make([]string, len(r.values))
	for i := range columns {
		columns[i] = fmt.Sprintf("column_%d", i)
	}
	return columns
}
func (*agentToolFixtureRows) Close() error { return nil }
func (r *agentToolFixtureRows) Next(dest []driver.Value) error {
	if r.nextErr != nil {
		return r.nextErr
	}
	if r.done {
		return io.EOF
	}
	r.done = true
	copy(dest, r.values)
	return nil
}

const agentToolForcedDBError = "forced database failure: internal relation sec1_fixture missing"

func (f *agentToolSQLFixture) businessCall() error {
	f.businessCalls++
	if f.fail {
		return fmt.Errorf("%s", agentToolForcedDBError)
	}
	return nil
}

func fixtureRow(values ...driver.Value) driver.Rows {
	return &agentToolFixtureRows{values: values}
}

func (c agentToolFixtureConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	q := strings.Join(strings.Fields(query), " ")
	f := c.fixture
	// These are the actual authentication, CSRF-adjacent session, route-grant
	// and admin middleware reads. Unknown reads fail, never silently authorize.
	switch {
	case strings.Contains(q, "public.system_revoked_sign_ins"):
		return fixtureRow(true), nil
	case strings.Contains(q, "ur.authentication_generation"):
		return fixtureRow(int64(1), nil, nil), nil
	case q == "SELECT boolean_value FROM system_config WHERE key = $1":
		return fixtureRow(false), nil // only_admin_can_login is disabled
	case strings.Contains(q, "key = 'login_to_browse'"):
		return fixtureRow(f.loginToBrowse), nil
	case strings.HasPrefix(q, "SELECT username FROM system_users"):
		return fixtureRow("sec1 fixture user"), nil
	case strings.Contains(q, "COALESCE(specific_table_related, true)"):
		return fixtureRow(false), nil
	case strings.Contains(q, "FROM system_group_table_func_rights"):
		f.grantChecks++
		if !f.grant {
			return &agentToolFixtureRows{values: []driver.Value{int64(1)}, done: true}, nil
		}
		return fixtureRow(int64(1)), nil
	case strings.Contains(q, "COALESCE(admin_access_allowed, false)"):
		return fixtureRow(f.admin), nil
	case strings.Contains(q, "SELECT 1 FROM system_user_group_memberships"):
		return fixtureRow(int64(1)), nil
	}
	if !strings.Contains(q, "dev_agent_") {
		return nil, fmt.Errorf("unexpected middleware query: %s", q)
	}
	if err := f.businessCall(); err != nil {
		return nil, err
	}
	now := time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC)
	switch {
	case strings.HasPrefix(q, "SELECT id FROM dev_agent_task_queues"), strings.HasPrefix(q, "SELECT id, slug FROM dev_agent_task_groups"):
		if f.rowFault == "iteration" {
			return &agentToolFixtureRows{values: []driver.Value{nil}, nextErr: fmt.Errorf("%s", agentToolForcedDBError)}, nil
		}
		return &agentToolFixtureRows{values: []driver.Value{nil}, done: true}, nil
	case strings.HasPrefix(q, "SELECT EXISTS (SELECT 1 FROM dev_agent_worklines"):
		return fixtureRow(true, true), nil
	case strings.HasPrefix(q, "SELECT EXISTS (SELECT 1 FROM dev_agent_tasks"):
		return fixtureRow(true), nil
	case strings.Contains(q, " ORDER BY ") && !strings.Contains(q, "WHERE w.id = $1"):
		if f.rowFault == "scan" {
			return fixtureRow("malformed SQL row"), nil
		}
		if f.rowFault == "iteration" {
			return &agentToolFixtureRows{values: []driver.Value{nil}, nextErr: fmt.Errorf("%s", agentToolForcedDBError)}, nil
		}
		return &agentToolFixtureRows{values: []driver.Value{nil}, done: true}, nil
	case strings.Contains(q, "FOR UPDATE OF r, w"):
		return fixtureRow("Fixture workline", "active", int64(4), "final", int64(2), "3-4", int64(4), "active", "Continue verification.", "fixture hash"), nil
	case strings.HasPrefix(q, "SELECT status, status_revision"):
		return fixtureRow("active", int64(1)), nil
	case strings.HasPrefix(q, "SELECT status FROM dev_agent_worklines"):
		return fixtureRow("active"), nil
	case strings.HasPrefix(q, "INSERT INTO dev_agent_tasks "):
		return fixtureRow(int64(4), now, now), nil
	case strings.HasPrefix(q, "INSERT INTO dev_agent_task_groups "):
		return fixtureRow(int64(4), now, now), nil
	case strings.HasPrefix(q, "INSERT INTO dev_agent_task_runs "), strings.HasPrefix(q, "UPDATE dev_agent_task_runs "):
		return fixtureRow(int64(4), "sec1-run", int64(4), "manual", nil, "queued", nil, nil, nil, nil, nil, nil, now, nil, nil, nil), nil
	case strings.HasPrefix(q, "INSERT INTO "), strings.HasPrefix(q, "DELETE FROM "):
		return fixtureRow(int64(4)), nil
	case strings.HasPrefix(q, "UPDATE dev_agent_worklines "):
		return fixtureRow(int64(4)), nil
	case strings.HasPrefix(q, "UPDATE dev_agent_tasks "), strings.HasPrefix(q, "UPDATE dev_agent_task_todos "):
		return fixtureRow(now), nil
	case strings.HasPrefix(q, "UPDATE dev_agent_task_groups "):
		return fixtureRow(int64(4), "sec1-group", "Fixture group", nil, int64(0), now, now), nil
	case strings.HasPrefix(q, "SELECT "+taskColumns):
		return fixtureRow(int64(4), "Fixture task", "task", "new", now, now, "", "normal", "{}", nil, nil, nil, nil, nil), nil
	case strings.HasPrefix(q, "SELECT "+taskTodoColumns):
		return fixtureRow(int64(4), int64(4), nil, "Fixture todo", "todo", int64(10), int64(42), nil, "Fixture user", "", now, now, nil), nil
	case strings.HasPrefix(q, "SELECT "+strings.Join(strings.Fields(worklineColumns), " ")):
		return fixtureRow(int64(4), "Fixture workline", "active", int64(42), "Fixture user", now, "creation", int64(1), "{}", int64(42), "Fixture user", now, now, int64(0), nil, "{}"), nil
	case strings.HasPrefix(q, "SELECT "+strings.Join(strings.Fields(worklineReportColumns), " ")):
		return fixtureRow(int64(4), int64(4), "Fixture workline", "Fixture report", "checkpoint", "success", "final", "Fixture content", "codex", "", "{}", "{}", "fixture hash", int64(2), "3-4", int64(4), "active", true, "Context", "Delivered", "Implementation", "Continue verification.", "{}", strings.Repeat("a", 40), "clean", false, "{}", nil, "", int64(42), "Fixture user", now, now), nil
	case strings.HasPrefix(q, "SELECT "+strings.Join(strings.Fields(handoverReportColumns), " ")):
		return fixtureRow(int64(4), "Fixture handover", "final", "codex", "", "{}", "{}", "fixture hash", nil, int64(42), "Fixture user", now, now), nil
	case strings.HasPrefix(q, "SELECT link.id, link.workline_id"):
		return fixtureRow(int64(4), int64(4), "Fixture workline", int64(4), "Fixture task", int64(42), now), nil
	}
	return nil, fmt.Errorf("unexpected business query: %s", q)
}

func (c agentToolFixtureConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	if !strings.Contains(query, "dev_agent_") {
		return nil, fmt.Errorf("unexpected exec outside agent tools")
	}
	if err := c.fixture.businessCall(); err != nil {
		return nil, err
	}
	return driver.RowsAffected(1), nil
}

func setupAgentToolSecurityStages(t *testing.T) {
	t.Helper()
	originalStages := pipeline.PipelineOrder
	originalDB, originalConfidential, originalGuest := backend.Db, backend.DbConfidential, backend.DbGuest
	originalLog := log.Writer()
	log.SetOutput(io.Discard) // Middleware otherwise logs synthetic session-cookie prefixes.
	t.Cleanup(func() {
		pipeline.PipelineOrder = originalStages
		backend.Db, backend.DbConfidential, backend.DbGuest = originalDB, originalConfidential, originalGuest
		log.SetOutput(originalLog)
	})
	// Keep the production authentication, forgery, grant and admin stages intact.
	// Unrelated rate-limit, audit, device binding and transaction hooks have their
	// own tests; the profile/stage assertions separately cover the complete chain.
	pipeline.PipelineOrder = nil
	for _, stage := range originalStages {
		switch stage.Name {
		case "auth", "csrf", "access_control", "admin_check":
			pipeline.PipelineOrder = append(pipeline.PipelineOrder, stage)
		}
	}
	t.Setenv("FILTEREST_ADMIN_PERMISSION_RECOVERY_MODE", "false")
}

func installAgentToolSQLFixture(t *testing.T, fixture *agentToolSQLFixture) {
	t.Helper()
	db := sql.OpenDB(agentToolFixtureConnector{fixture})
	t.Cleanup(func() { _ = db.Close() })
	backend.Db, backend.DbConfidential, backend.DbGuest = db, db, db
}
