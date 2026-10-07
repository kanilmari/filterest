// account_editor_guard_test.go
// Proves the generic account writers refuse before touching rows or databases.
// Bridges deliberately granted editor entry points and the shared administrator boundary.
// Exists to keep guesses about another account's private name equally unobservable.
package accountwrite_test

import (
	"context"
	"database/sql"
	"database/sql/driver"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/accountwrite"
	"easelect/backend/core_components/dbutils"
	create "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_create"
	deleteRows "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_delete"
	update "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_update"
	"easelect/backend/core_components/lang"
	sessions "easelect/backend/core_components/sessions"
	"fmt"
	gorilla "github.com/gorilla/sessions"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestAccountEditorsRefuseNonAdministratorBeforeDatabaseAccess(t *testing.T) {
	oldStore, oldName := sessions.Store, sessions.SessionName
	oldDb, oldConf := backend.Db, backend.DbConfidential
	sessions.Store = gorilla.NewCookieStore([]byte("account-editor-test-signing-secret"))
	sessions.SessionName = "session"
	backend.Db = nil
	backend.DbConfidential = nil
	t.Cleanup(func() {
		sessions.Store = oldStore
		sessions.SessionName = oldName
		backend.Db = oldDb
		backend.DbConfidential = oldConf
	})
	for _, id := range []int{1, 48} {
		seed := httptest.NewRequest("GET", "/", nil)
		session, _ := sessions.GetOrCreateSession(nil, seed)
		session.Values["user_id"] = id
		session.Values["authenticated"] = id > 1
		session.Values["user_role"] = "admin" // forged role is insufficient.
		written := httptest.NewRecorder()
		if err := sessions.Save(written, seed, session); err != nil {
			t.Fatal(err)
		}
		for _, table := range []string{"system_users", "system_user_groups", "system_user_group_memberships", "system_group_table_func_rights", "system_functions"} {
			for _, writer := range []string{"update", "add", "delete", "translations"} {
				t.Run(table+"/"+writer, func(t *testing.T) {
					body := `{"id":42,"column":"username","value":"private-canary","ids":[42],"table":"` + table + `","row_ids":[42],"columns":["username"]}`
					r := httptest.NewRequest(http.MethodPost, "/api/editor", strings.NewReader(body))
					r.AddCookie(written.Result().Cookies()[0])
					w := httptest.NewRecorder()
					switch writer {
					case "update":
						update.UpdateRowHandler(w, r, table)
					case "add":
						create.AddRowMultipartHandler(w, r, table)
					case "delete":
						deleteRows.DeleteRowsHandler(w, r, table)
					case "translations":
						lang.FixTableTranslationsHandler(w, r)
					}
					want := 403
					if id == 1 {
						want = 401
					}
					if w.Code != want || !strings.Contains(w.Body.String(), "error_identity_edit_requires_administrator") || strings.Contains(w.Body.String(), "canary") {
						t.Fatalf("response=%d %s", w.Code, w.Body.String())
					}
				})
			}
		}
	}
}

var administratorGuardDriverCount atomic.Int64

type administratorGuardDriver struct{ allowed bool }
type administratorGuardConn struct{ allowed bool }
type administratorGuardRows struct{ allowed, done bool }

func (d administratorGuardDriver) Open(string) (driver.Conn, error) {
	return &administratorGuardConn{allowed: d.allowed}, nil
}
func (*administratorGuardConn) Prepare(string) (driver.Stmt, error) {
	return nil, fmt.Errorf("not supported")
}
func (*administratorGuardConn) Close() error              { return nil }
func (*administratorGuardConn) Begin() (driver.Tx, error) { return nil, fmt.Errorf("not needed") }
func (c *administratorGuardConn) QueryContext(context.Context, string, []driver.NamedValue) (driver.Rows, error) {
	return &administratorGuardRows{allowed: c.allowed}, nil
}
func (*administratorGuardRows) Columns() []string { return []string{"allowed"} }
func (*administratorGuardRows) Close() error      { return nil }
func (r *administratorGuardRows) Next(dest []driver.Value) error {
	if r.done {
		return io.EOF
	}
	r.done = true
	dest[0] = r.allowed
	return nil
}

func TestAccountEditorAcceptsOnlyTrustedAdministratorActor(t *testing.T) {
	old := backend.Db
	t.Cleanup(func() { backend.Db = old })
	for _, allowed := range []bool{true, false} {
		name := fmt.Sprintf("account_guard_%d", administratorGuardDriverCount.Add(1))
		sql.Register(name, administratorGuardDriver{allowed: allowed})
		db, err := sql.Open(name, "")
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { db.Close() })
		backend.Db = db
		for _, actor := range []dbutils.RequestActorContext{
			dbutils.NewRequestActorContext(42, "admin"), dbutils.NewRequestActorContext(42, "basic"), dbutils.NewRequestActorContext(1, "admin"),
			{UserID: 42, UserRole: "admin", IsAdmin: false},
		} {
			request := httptest.NewRequest("POST", "/api/editor", nil)
			request = request.WithContext(dbutils.SetRequestActorContext(request.Context(), actor))
			response := httptest.NewRecorder()
			err := accountwrite.RequireAdministrator(response, request, "system_group_table_func_rights")
			want := allowed && actor.UserID > 1 && actor.IsAdmin && actor.UserRole == "admin"
			if (err == nil) != want {
				t.Fatalf("trusted actor=%+v accepted=%v", actor, err == nil)
			}
		}
	}
}
