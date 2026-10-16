// child_tab_config_test.go
// Verifies per-dataset referring-tab persistence, refusals and input validation.
// Connects real save/read handlers and the registered administrator gate to PostgreSQL.
// Uses only the opt-in disposable cluster; never an installation database.
package system_table_tools

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	e_sessions "easelect/backend/core_components/sessions"
	"easelect/backend/pipeline"
	"easelect/backend/pipeline/admin_check"
	"github.com/gorilla/sessions"
)

var invalidChildTabConfigBodies = []struct{ name, body, message string }{
	{"empty body", "", "invalid request body"},
	{"malformed JSON", "{", "invalid request body"},
	{"wrong shape", "[]", "invalid request body"},
	{"wrong order type", `{"parent_table":"parent","tabs":[{"tab_key":"child","tab_order":"first"}]}`, "invalid request body"},
	{"wrong hidden type", `{"parent_table":"parent","tabs":[{"tab_key":"child","hidden":"yes"}]}`, "invalid request body"},
	{"missing parent", `{"tabs":[{"tab_key":"child"}]}`, "parent_table and tabs are required"},
	{"empty parent", `{"parent_table":"","tabs":[{"tab_key":"child"}]}`, "parent_table and tabs are required"},
	{"missing tabs", `{"parent_table":"parent"}`, "parent_table and tabs are required"},
	{"null tabs", `{"parent_table":"parent","tabs":null}`, "parent_table and tabs are required"},
	{"empty tabs", `{"parent_table":"parent","tabs":[]}`, "parent_table and tabs are required"},
}

func assertChildTabConfigError(t *testing.T, response *httptest.ResponseRecorder, message string) {
	t.Helper()
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status=%d want=400: %s", response.Code, response.Body)
	}
	var payload struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Error != message {
		t.Fatalf("error=%q want=%q", payload.Error, message)
	}
}

func TestChildTabConfigHandlersRejectInvalidInput(t *testing.T) {
	// No transaction or database is needed: validation must happen before writes.
	for _, input := range invalidChildTabConfigBodies {
		t.Run(input.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			SaveChildTabConfigHandler(response, httptest.NewRequest(http.MethodPost,
				"/api/child-tab-config/save", strings.NewReader(input.body)))
			assertChildTabConfigError(t, response, input.message)
		})
	}
	response := httptest.NewRecorder()
	GetChildTabConfigHandler(response, httptest.NewRequest(http.MethodGet, "/api/child-tab-config/", nil))
	assertChildTabConfigError(t, response, "parent table name is required")
}

func TestChildTabConfigSaveProfileRequiresAdministrator(t *testing.T) {
	if !pipeline.GetProfile("system_table_tools.SaveChildTabConfigHandler").AdminOnly {
		t.Fatal("the registered save route must enforce the administrator gate")
	}
}

func childTabConfigPostgres(t *testing.T) *sql.DB {
	t.Helper()
	db := sitePresentationDisposableDB(t)
	// Take the table definition from the shipped bootstrap, including its unique
	// parent/key constraint, rather than reproducing the upsert contract here.
	schema, err := os.ReadFile("../../../server_tools/public_bootstrap/source/runtime.schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	start := strings.Index(string(schema), "CREATE TABLE IF NOT EXISTS public.system_child_tab_config (")
	if start < 0 {
		t.Fatal("child-tab configuration table missing from bootstrap")
	}
	tableDefinition, _, found := strings.Cut(string(schema[start:]), "\n\nCREATE OR REPLACE FUNCTION")
	if !found {
		t.Fatal("child-tab configuration definition boundary missing")
	}
	if _, err := db.Exec(tableDefinition); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
CREATE TABLE system_users (id integer PRIMARY KEY, admin_access_allowed boolean);
CREATE TABLE system_user_group_memberships (user_id integer, group_id integer);
INSERT INTO system_users VALUES (42, true), (43, false);
INSERT INTO system_user_group_memberships VALUES (42, 1), (43, 2);
`); err != nil {
		t.Fatal(err)
	}
	previousDB, previousGuest := backend.Db, backend.DbGuest
	previousStore, previousName := e_sessions.Store, e_sessions.SessionName
	backend.Db, backend.DbGuest = db, db
	e_sessions.Store = sessions.NewCookieStore([]byte("child-tab-config-test-cookie-key-32"))
	e_sessions.SessionName = "child-tab-config-test"
	t.Cleanup(func() {
		backend.Db, backend.DbGuest = previousDB, previousGuest
		e_sessions.Store, e_sessions.SessionName = previousStore, previousName
	})
	return db
}

func saveChildTabConfigForTest(t *testing.T, db *sql.DB, body string, userID int) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/api/child-tab-config/save", strings.NewReader(body))
	session, err := e_sessions.Store.Get(request, e_sessions.SessionName)
	if err != nil {
		t.Fatal(err)
	}
	session.Values["user_id"] = userID
	cookies := httptest.NewRecorder()
	if err := session.Save(request, cookies); err != nil {
		t.Fatal(err)
	}
	for _, cookie := range cookies.Result().Cookies() {
		request.AddCookie(cookie)
	}
	lazy := dbutils.NewLazyTx(db)
	defer lazy.Rollback()
	request = request.WithContext(dbutils.SetLazyTx(request.Context(), lazy))
	// Exercise the production gate selected by the real route profile. Other
	// pipeline stages (CSRF, fingerprint, etc.) are outside this handler proof.
	save := http.HandlerFunc(SaveChildTabConfigHandler)
	if pipeline.GetProfile("system_table_tools.SaveChildTabConfigHandler").AdminOnly {
		save = admin_check.WithAdminUserCheck(save)
	}
	response := httptest.NewRecorder()
	save(response, request)
	if response.Code == http.StatusOK {
		if err := lazy.Commit(); err != nil {
			t.Fatal(err)
		}
	} else if lazy.WasStarted() {
		t.Fatal("refused request started a write transaction")
	}
	return response
}

func readChildTabConfigForTest(t *testing.T, dataset string) []childTabConfigRow {
	t.Helper()
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/child-tab-config/"+dataset, nil)
	request = request.WithContext(dbutils.SetRequestActorContext(request.Context(), dbutils.NewRequestActorContext(42, "admin")))
	GetChildTabConfigHandler(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("read status=%d: %s", response.Code, response.Body)
	}
	var rows []childTabConfigRow
	if err := json.Unmarshal(response.Body.Bytes(), &rows); err != nil {
		t.Fatal(err)
	}
	if rows == nil {
		t.Fatal("missing configuration must return an empty JSON array")
	}
	return rows
}

func TestChildTabConfigSaveReadAndUpdatePostgres(t *testing.T) {
	db := childTabConfigPostgres(t)
	if rows := readChildTabConfigForTest(t, "parent"); len(rows) != 0 {
		t.Fatalf("new dataset already configured: %+v", rows)
	}
	savedIDs := make(map[string]int)
	for index, body := range []string{
		`{"parent_table":"parent","tabs":[{"tab_key":"child_a","tab_order":20,"hidden":false},{"tab_key":"child_b","tab_order":10,"hidden":true},{"tab_key":"__comments","tab_order":30,"hidden":false}]}`,
		`{"parent_table":"parent","tabs":[{"tab_key":"child_a","tab_order":5,"hidden":true},{"tab_key":"child_b","tab_order":40,"hidden":false},{"tab_key":"__comments","tab_order":15,"hidden":true}]}`,
	} {
		response := saveChildTabConfigForTest(t, db, body, 42)
		if response.Code != http.StatusOK {
			t.Fatalf("save %d status=%d: %s", index, response.Code, response.Body)
		}
		var status map[string]string
		if err := json.Unmarshal(response.Body.Bytes(), &status); err != nil || status["status"] != "ok" {
			t.Fatalf("save response=%s err=%v", response.Body, err)
		}
		// Expected values are independent of the handler's SQL and JSON parsing.
		want := [][]childTabConfigRow{
			{{ParentTable: "parent", TabKey: "child_b", TabOrder: 10, Hidden: true}, {ParentTable: "parent", TabKey: "child_a", TabOrder: 20}, {ParentTable: "parent", TabKey: "__comments", TabOrder: 30}},
			{{ParentTable: "parent", TabKey: "child_a", TabOrder: 5, Hidden: true}, {ParentTable: "parent", TabKey: "__comments", TabOrder: 15, Hidden: true}, {ParentTable: "parent", TabKey: "child_b", TabOrder: 40}},
		}[index]
		got := readChildTabConfigForTest(t, "parent")
		for i := range got {
			if got[i].ID <= 0 {
				t.Fatal("saved configuration has no row identity")
			}
			if index == 0 {
				savedIDs[got[i].TabKey] = got[i].ID
			} else if savedIDs[got[i].TabKey] != got[i].ID {
				t.Fatalf("update replaced row identity for %s", got[i].TabKey)
			}
			got[i].ID = 0
		}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("save %d read=%+v want=%+v", index, got, want)
		}
	}
	// The same key on another dataset must neither conflict nor inherit settings.
	response := saveChildTabConfigForTest(t, db,
		`{"parent_table":"other","tabs":[{"tab_key":"child_a","tab_order":99,"hidden":false}]}`, 42)
	if response.Code != http.StatusOK {
		t.Fatalf("other dataset save: %d %s", response.Code, response.Body)
	}
	other := readChildTabConfigForTest(t, "other")
	if len(other) != 1 || other[0].ParentTable != "other" || other[0].TabOrder != 99 || other[0].Hidden {
		t.Fatalf("other dataset config=%+v", other)
	}
	parent := readChildTabConfigForTest(t, "parent")
	if len(parent) != 3 || parent[0].TabOrder != 5 || !parent[0].Hidden {
		t.Fatalf("other dataset changed parent: %+v", parent)
	}
	if len(readChildTabConfigForTest(t, "unconfigured")) != 0 {
		t.Fatal("configuration leaked into an unconfigured dataset")
	}
}

func TestChildTabConfigRefusalsPreserveSavedConfigPostgres(t *testing.T) {
	db := childTabConfigPostgres(t)
	body := `{"parent_table":"parent","tabs":[{"tab_key":"child","tab_order":7,"hidden":true}]}`
	if response := saveChildTabConfigForTest(t, db, body, 42); response.Code != http.StatusOK {
		t.Fatalf("initial save: %d %s", response.Code, response.Body)
	}
	before := readChildTabConfigForTest(t, "parent")
	response := saveChildTabConfigForTest(t, db,
		`{"parent_table":"parent","tabs":[{"tab_key":"child","tab_order":1,"hidden":false},{"tab_key":"new_child","tab_order":2}]}`, 43)
	if response.Code != http.StatusForbidden {
		t.Fatalf("non-administrator status=%d want=403: %s", response.Code, response.Body)
	}
	if after := readChildTabConfigForTest(t, "parent"); !reflect.DeepEqual(after, before) {
		t.Fatalf("denied save changed configuration: %+v", after)
	}
	for _, input := range invalidChildTabConfigBodies {
		t.Run(input.name, func(t *testing.T) {
			assertChildTabConfigError(t, saveChildTabConfigForTest(t, db, input.body, 42), input.message)
			if after := readChildTabConfigForTest(t, "parent"); !reflect.DeepEqual(after, before) {
				t.Fatalf("invalid save changed configuration: %+v", after)
			}
		})
	}
}
