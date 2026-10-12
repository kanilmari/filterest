// view_data_admin_profile_test.go
// Proves raw view reads require server-owned administrator status after a route grant.
// Bridges the actual route profile, pipeline stage selection and administrator middleware.
// Prevents a future capability grant from exposing administrator-connection view data.
package pipeline_test

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	e_sessions "easelect/backend/core_components/sessions"
	"easelect/backend/pipeline"
	"easelect/backend/reusable_components/vanilla_tree"
	"github.com/gorilla/sessions"
)

type viewAdminConnector struct{ allowed bool }
type viewAdminConn struct{ allowed bool }
type viewAdminRows struct {
	columns []string
	values  []driver.Value
	done    bool
}

func (c viewAdminConnector) Connect(context.Context) (driver.Conn, error) {
	return viewAdminConn{allowed: c.allowed}, nil
}
func (c viewAdminConnector) Driver() driver.Driver { return viewAdminDriver{} }

type viewAdminDriver struct{}

func (viewAdminDriver) Open(string) (driver.Conn, error) {
	return nil, fmt.Errorf("connector required")
}
func (viewAdminConn) Prepare(string) (driver.Stmt, error) {
	return nil, fmt.Errorf("unexpected prepare")
}
func (viewAdminConn) Close() error              { return nil }
func (viewAdminConn) Begin() (driver.Tx, error) { return nil, fmt.Errorf("unexpected transaction") }
func (c viewAdminConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	switch {
	case strings.Contains(query, "admin_access_allowed"):
		return &viewAdminRows{columns: []string{"admin_access_allowed"}, values: []driver.Value{c.allowed}}, nil
	case strings.Contains(query, "information_schema.views"):
		return &viewAdminRows{columns: []string{"exists"}, values: []driver.Value{true}}, nil
	case strings.Contains(query, `SELECT * FROM "example_view" LIMIT 10000`):
		return &viewAdminRows{columns: []string{"id", "title"}, values: []driver.Value{int64(7), "Visible view row"}}, nil
	}
	// The real middleware's existing role-lookup fallback is exercised too.
	return nil, fmt.Errorf("role lookup unavailable")
}
func (r *viewAdminRows) Columns() []string { return r.columns }
func (*viewAdminRows) Close() error        { return nil }
func (r *viewAdminRows) Next(dest []driver.Value) error {
	if r.done {
		return io.EOF
	}
	r.done = true
	copy(dest, r.values)
	return nil
}

func TestGetViewDataRequiresAdministratorEvenWithRouteRight(t *testing.T) {
	name := "vanilla_tree.GetViewDataHandler"
	profile := pipeline.GetProfile(name)
	descriptor := pipeline.DescribeRouteProfile(name)
	if descriptor.ProfileName != "admin" || !descriptor.AdminOnly {
		t.Fatalf("raw view profile = %+v, want administrator boundary", descriptor)
	}
	containsAll(t, pipeline.DescribePipeline(pipeline.RouteContext{}, profile),
		[]string{"auth", "csrf", "access_control", "admin_check", "transaction"})

	originalDB, originalStore, originalName, originalStages := backend.Db, e_sessions.Store, e_sessions.SessionName, pipeline.PipelineOrder
	t.Cleanup(func() {
		backend.Db, e_sessions.Store, e_sessions.SessionName, pipeline.PipelineOrder = originalDB, originalStore, originalName, originalStages
	})
	store := sessions.NewCookieStore([]byte("wl33-view-data-admin-test-key-32!"))
	e_sessions.Store, e_sessions.SessionName = store, "wl33-view-admin"

	for _, allowed := range []bool{false, true} {
		t.Run(fmt.Sprintf("administrator=%t", allowed), func(t *testing.T) {
			db := sql.OpenDB(viewAdminConnector{allowed: allowed})
			defer db.Close()
			backend.Db = db
			// Exercise composition after successful route authorization, using
			// the actual admin stage and the route's unchanged profile. Other
			// authentication middleware has separate existing regression tests.
			granted := false
			pipeline.PipelineOrder = []pipeline.Stage{{Name: "access_control", Fn: func(next http.HandlerFunc, _ pipeline.RouteContext) http.HandlerFunc {
				return func(w http.ResponseWriter, r *http.Request) { granted = true; next(w, r) }
			}}}
			for _, stage := range originalStages {
				if stage.Name == "admin_check" {
					pipeline.PipelineOrder = append(pipeline.PipelineOrder, stage)
				}
			}
			req := httptest.NewRequest(http.MethodGet, "/api/get-view-data?view=example_view", nil)
			cookieResponse := httptest.NewRecorder()
			session, err := store.Get(req, e_sessions.SessionName)
			if err != nil {
				t.Fatal(err)
			}
			session.Values["user_id"], session.Values["user_role"] = 8, "basic"
			if err := session.Save(req, cookieResponse); err != nil {
				t.Fatal(err)
			}
			for _, cookie := range cookieResponse.Result().Cookies() {
				req.AddCookie(cookie)
			}
			called := false
			handler := pipeline.BuildHandler(func(w http.ResponseWriter, r *http.Request) { called = true; vanilla_tree.GetViewDataHandler(w, r) },
				pipeline.RouteContext{HandlerName: name, URLPattern: "/api/get-view-data"}, profile)
			response := httptest.NewRecorder()
			handler(response, req)
			wantStatus := http.StatusForbidden
			if allowed {
				wantStatus = http.StatusOK
			}
			if !granted || called != allowed || response.Code != wantStatus {
				t.Fatalf("route granted=%t handler called=%t status=%d, want called=%t status=%d", granted, called, response.Code, allowed, wantStatus)
			}
			if allowed && (!strings.Contains(response.Body.String(), `"row_count":1`) || !strings.Contains(response.Body.String(), "Visible view row")) {
				t.Fatalf("administrator lost view response: %s", response.Body.String())
			}
		})
	}
}
