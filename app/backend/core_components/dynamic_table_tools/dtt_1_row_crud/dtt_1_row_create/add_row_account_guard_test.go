// add_row_account_guard_test.go
// Proves account-row insertion refuses an ordinary cookie before inspecting payloads.
// Bridges the add-row orchestration function and the shared administrator-only boundary.
// Exists to verify the application boundary independently of database write revocations.
package dtt_1_row_create

import (
	backend "easelect/backend/core_components"
	sessions "easelect/backend/core_components/sessions"
	gorilla "github.com/gorilla/sessions"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAddAccountRowRequiresTrustedAdministratorBeforeAnyWrite(t *testing.T) {
	oldStore, oldName := sessions.Store, sessions.SessionName
	oldDb, oldConf := backend.Db, backend.DbConfidential
	sessions.Store = gorilla.NewCookieStore([]byte("add-account-test-signing-key-12345"))
	sessions.SessionName = "session"
	backend.Db = nil
	backend.DbConfidential = nil
	t.Cleanup(func() {
		sessions.Store = oldStore
		sessions.SessionName = oldName
		backend.Db = oldDb
		backend.DbConfidential = oldConf
	})
	seed := httptest.NewRequest("GET", "/", nil)
	session, _ := sessions.GetOrCreateSession(nil, seed)
	session.Values["user_id"] = 48
	session.Values["authenticated"] = true
	written := httptest.NewRecorder()
	if err := sessions.Save(written, seed, session); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"system_users", "system_user_groups", "system_user_group_memberships", "system_group_table_func_rights", "system_functions"} {
		r := httptest.NewRequest("POST", "/api/add-row", nil)
		r.AddCookie(written.Result().Cookies()[0])
		w := httptest.NewRecorder()
		id, _, err := insertDataAccordingToPayload(w, r, table, "", map[string]interface{}{"username": "private-canary"}, nil)
		if err == nil || id != 0 || w.Code != 403 || !strings.Contains(w.Body.String(), "error_identity_edit_requires_administrator") {
			t.Fatalf("%s gave %d %s", table, w.Code, w.Body.String())
		}
	}
}
