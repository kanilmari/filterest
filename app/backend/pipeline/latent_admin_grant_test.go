// latent_admin_grant_test.go
// Exercises administrator-only maintenance routes with an existing ordinary grant.
// Connects the registered profile to real access-control and administrator stages.
// Prevents stored grants from opening privileged translation and folder operations.
package pipeline_test

import (
	"context"
	"database/sql"
	"database/sql/driver"
	backend "easelect/backend/core_components"
	e_sessions "easelect/backend/core_components/sessions"
	"easelect/backend/pipeline"
	"easelect/backend/pipeline/access_control"
	"easelect/backend/pipeline/admin_check"
	"fmt"
	"github.com/gorilla/sessions"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type latentGrantDriver struct{ grants *int }
type latentGrantRows struct {
	values []driver.Value
	done   bool
}

func (d latentGrantDriver) Open(string) (driver.Conn, error)    { return d, nil }
func (d latentGrantDriver) Prepare(string) (driver.Stmt, error) { return nil, fmt.Errorf("no prepare") }
func (d latentGrantDriver) Close() error                        { return nil }
func (d latentGrantDriver) Begin() (driver.Tx, error)           { return nil, fmt.Errorf("no transaction") }
func (d latentGrantDriver) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	var value driver.Value
	switch {
	case strings.Contains(query, "admin_access_allowed"):
		value = false
	case strings.Contains(query, "specific_table_related"), strings.Contains(query, "login_to_browse"):
		value = false
	case strings.Contains(query, "SELECT username"):
		value = "ordinary"
	case strings.Contains(query, "FROM system_group_table_func_rights"):
		value = int64(1)
		*d.grants++
	default:
		return nil, fmt.Errorf("unexpected query: %s", query)
	}
	return &latentGrantRows{values: []driver.Value{value}}, nil
}
func (r *latentGrantRows) Columns() []string { return []string{"value"} }
func (r *latentGrantRows) Close() error      { return nil }
func (r *latentGrantRows) Next(dest []driver.Value) error {
	if r.done {
		return io.EOF
	}
	copy(dest, r.values)
	r.done = true
	return nil
}

func TestLatentAdminRoutesRefuseExistingNonAdminGrant(t *testing.T) {
	grants := 0
	sql.Register("latent_admin_grants", latentGrantDriver{&grants})
	db, err := sql.Open("latent_admin_grants", "")
	if err != nil {
		t.Fatal(err)
	}
	oldDB, oldStore, oldName := backend.Db, e_sessions.Store, e_sessions.SessionName
	backend.Db = db
	store := sessions.NewCookieStore([]byte("latent-route-test-signing-key-32!"))
	e_sessions.Store, e_sessions.SessionName = store, "latent-test"
	t.Cleanup(func() { backend.Db, e_sessions.Store, e_sessions.SessionName = oldDB, oldStore, oldName; db.Close() })
	for _, route := range []struct{ path, handler string }{
		{"/api/empty-rows", "system_table_tools.GetEmptyRowsHandler"},
		{"/api/fix-translations", "lang.FixTableTranslationsHandler"},
		{"/api/update-folder", "dtt_system_table_folders.HandleUpdateFolder"},
		{"/api/create-folder", "dtt_system_table_folders.HandleCreateFolder"},
		{"/api/delete-folder", "dtt_system_table_folders.HandleDeleteFolder"},
		{"/api/set-current-project-folder", "dtt_system_table_folders.HandleSetCurrentProjectFolder"},
	} {
		t.Run(route.path, func(t *testing.T) {
			req := httptest.NewRequest("POST", route.path, strings.NewReader(`{}`))
			cookie := httptest.NewRecorder()
			session, _ := store.Get(req, e_sessions.SessionName)
			session.Values["user_id"] = 42
			if err := session.Save(req, cookie); err != nil {
				t.Fatal(err)
			}
			for _, c := range cookie.Result().Cookies() {
				req.AddCookie(c)
			}
			called := false
			var handler http.HandlerFunc = func(http.ResponseWriter, *http.Request) { called = true }
			profile := pipeline.GetProfile(route.handler)
			if profile.AdminOnly {
				handler = admin_check.WithAdminUserCheck(handler)
			}
			handler = access_control.WithAccessControl(route.path, route.handler, handler)
			rec := httptest.NewRecorder()
			before := grants
			handler(rec, req)
			if grants == before {
				t.Fatal("existing non-admin grant was not exercised")
			}
			if called || rec.Code != 403 {
				t.Fatalf("handler=%t status=%d want=403", called, rec.Code)
			}
			if pipeline.DescribeRouteProfile(route.handler).ProfileName != "admin" {
				t.Fatal("route does not use AdminProfile")
			}
		})
	}
}
