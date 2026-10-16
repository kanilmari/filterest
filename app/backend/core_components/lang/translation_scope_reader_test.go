// translation_scope_reader_test.go
// Exercises scoped responses, failure handling and changing request identities.
// Connects the real HTTP handler to deterministic source and permission rows.
// Proves private names cannot survive anonymous, guest or unrelated reader requests.
package lang

import (
	"context"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/auth_generation"
	e_sessions "easelect/backend/core_components/sessions"
	"github.com/gorilla/sessions"
)

var scopeFixtureValues = map[string]string{
	"login": "Login", "app_a": "A", "add_row_app_a": "Add A", "search_for_app_a": "Search A",
	"a_column": "A column", "app_b": "B", "private_folder": "Folder", "hidden_column": "Hidden",
	"shared_key": "Shared", "add_row_app_removed": "Removed", "app_help_copy": "Public help",
}

func scopeFixtureSources() queuedCleanupQuery {
	return queuedCleanupQuery{cols: []string{"key", "type", "dataset", "uid", "visible"}, rows: [][]driver.Value{
		{"app_a", "table", "app_a", int64(11), true},
		{"add_row_app_a", "table", "app_a", int64(11), true},
		{"search_for_app_a", "table", "app_a", int64(11), true},
		{"a_column", "column", "app_a", int64(11), true},
		{"app_b", "table", "app_b", int64(22), true},
		{"private_folder", "folder", "", int64(0), true},
		{"hidden_column", "column", "app_a", int64(11), false},
		{"shared_key", "column", "app_a", int64(11), true},
		{"shared_key", "column", "app_b", int64(22), true},
	}}
}

func translationRequest(t *testing.T, userID int) *http.Request {
	t.Helper()
	oldStore := e_sessions.Store
	store := sessions.NewCookieStore([]byte("sec2-offline-fixture-signing-material"))
	e_sessions.Store = store
	t.Cleanup(func() { e_sessions.Store = oldStore })
	req := httptest.NewRequest(http.MethodGet, "/api/translations?lang=en", nil)
	if userID > 0 {
		session, err := store.Get(req, e_sessions.SessionName)
		if err != nil {
			t.Fatal(err)
		}
		session.Values["user_id"] = userID
		recorder := httptest.NewRecorder()
		if err := e_sessions.Save(recorder, req, session); err != nil {
			t.Fatal(err)
		}
		for _, cookie := range recorder.Result().Cookies() {
			req.AddCookie(cookie)
		}
	}
	return req
}

func translationQueries(userID int, loginRequired, admin, tree bool, readable ...int64) []queuedCleanupQuery {
	values := queuedCleanupQuery{cols: []string{"key", "value"}}
	for key, value := range scopeFixtureValues {
		values.rows = append(values.rows, []driver.Value{key, value})
	}
	queries := []queuedCleanupQuery{values, {cols: []string{"key", "value"}}}
	if userID <= 1 {
		queries = append(queries, queuedCleanupQuery{cols: []string{"login_required"}, rows: [][]driver.Value{{loginRequired}}})
	}
	if userID > 1 || !loginRequired {
		queries = append(queries, queuedCleanupQuery{cols: []string{"admin"}, rows: [][]driver.Value{{admin}}})
		if !admin {
			readRows := queuedCleanupQuery{cols: []string{"uid"}}
			for _, uid := range readable {
				readRows.rows = append(readRows.rows, []driver.Value{uid})
			}
			permission := queuedCleanupQuery{cols: []string{"allowed"}}
			if tree {
				permission.rows = [][]driver.Value{{int64(1)}}
			}
			queries = append(queries, readRows, permission)
		}
	}
	if !admin {
		queries = append(queries, scopeFixtureSources())
	}
	return queries
}

func installTranslationDB(t *testing.T, queries []queuedCleanupQuery) *cleanupState {
	t.Helper()
	db, state := openCleanupDB(t, queries, nil)
	oldDB := backend.Db
	backend.Db = db
	t.Cleanup(func() { backend.Db = oldDB })
	return state
}

func TestTranslationsHandlerScopesEveryIdentityAndOrphans(t *testing.T) {
	for _, tc := range []struct {
		name                       string
		user                       int
		loginRequired, admin, tree bool
		readable                   []int64
		want                       []string
	}{
		{"anonymous", 0, false, false, false, nil, []string{"login"}},
		{"guest", 1, false, false, false, nil, []string{"login"}},
		{"public reader", 0, false, false, false, []int64{11}, []string{"login", "app_a", "add_row_app_a", "search_for_app_a", "a_column"}},
		{"reader A", 42, false, false, false, []int64{11}, []string{"login", "app_a", "add_row_app_a", "search_for_app_a", "a_column"}},
		{"reader B", 43, false, false, false, []int64{22}, []string{"login", "app_b"}},
		{"tree reader", 44, false, false, true, nil, []string{"login", "private_folder"}},
		{"login required guest", 1, true, false, false, nil, []string{"login"}},
		{"admin", 99, false, true, false, nil, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("DEV_MODE", "true")
			queries := translationQueries(tc.user, tc.loginRequired, tc.admin, tc.tree, tc.readable...)
			queries = append(queries, queuedCleanupQuery{cols: []string{"key"}, rows: [][]driver.Value{{"app_a"}, {"app_b"}, {"login"}}})
			state := installTranslationDB(t, queries)
			oldMatches := translationSessionMatches
			translationSessionMatches = func(context.Context, auth_generation.Querier, *sessions.Session, int) (bool, error) { return true, nil }
			t.Cleanup(func() { translationSessionMatches = oldMatches })
			response := httptest.NewRecorder()
			GetTranslationsHandler(response, translationRequest(t, tc.user))
			var body struct {
				Translations map[string]string `json:"translations"`
				Orphans      []string          `json:"orphan_keys"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			want := map[string]string{}
			// A technical-looking UI key is still public when it has no object.
			want["app_help_copy"] = scopeFixtureValues["app_help_copy"]
			for _, key := range tc.want {
				want[key] = scopeFixtureValues[key]
			}
			if tc.admin {
				want = scopeFixtureValues
			}
			if response.Code != 200 || !reflect.DeepEqual(body.Translations, want) {
				t.Fatalf("status=%d map=%v want=%v", response.Code, body.Translations, want)
			}
			for _, key := range body.Orphans {
				if _, ok := want[key]; !ok {
					t.Fatalf("orphan leaked %q", key)
				}
			}
			if len(state.queries) != 0 {
				t.Fatal("expected lookup not consumed", state.queries)
			}
			if response.Header().Get("Cache-Control") != "private, no-store" || response.Header().Get("Vary") != "Cookie" {
				t.Fatal(response.Header())
			}
		})
	}
}

func TestTranslationsFailClosedOnAssociationLookupError(t *testing.T) {
	t.Setenv("DEV_MODE", "false")
	queries := translationQueries(0, true, false, false)
	queries[len(queries)-1] = queuedCleanupQuery{err: errors.New("injected association lookup failure")}
	installTranslationDB(t, queries)
	response := httptest.NewRecorder()
	GetTranslationsHandler(response, translationRequest(t, 0))
	var body map[string]string
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if response.Code != 200 || len(body) != 0 {
		t.Fatalf("failed lookup exposed names: %s", response.Body.String())
	}
}

func TestTranslationPrincipalDropsRevokedAndExpiredIdentity(t *testing.T) {
	oldMatches := translationSessionMatches
	translationSessionMatches = func(context.Context, auth_generation.Querier, *sessions.Session, int) (bool, error) {
		return false, nil
	}
	t.Cleanup(func() { translationSessionMatches = oldMatches })
	installTranslationDB(t, []queuedCleanupQuery{{cols: []string{"login_required"}, rows: [][]driver.Value{{true}}}})
	user, err := translationPrincipal(translationRequest(t, 99))
	if err != nil || user != 0 {
		t.Fatal("stale administrator identity retained", user, err)
	}
}

func TestDisplayTranslationReaderRemainsUnscoped(t *testing.T) {
	installTranslationDB(t, translationQueries(0, true, false, false)[:2])
	values, err := ReadDisplayTranslations("en")
	if err != nil || !reflect.DeepEqual(values, scopeFixtureValues) {
		t.Fatal("other authorized internal readers changed", values, err)
	}
}

func TestTranslationsScopesAreRecomputedForTwoReadersAndRevocation(t *testing.T) {
	t.Setenv("DEV_MODE", "false")
	oldMatches := translationSessionMatches
	translationSessionMatches = func(context.Context, auth_generation.Querier, *sessions.Session, int) (bool, error) { return true, nil }
	t.Cleanup(func() { translationSessionMatches = oldMatches })
	var queries []queuedCleanupQuery
	for index, user := range []int{0, 42, 43, 42, 0} {
		var uids []int64
		if index == 1 {
			uids = []int64{11}
		}
		if user == 43 {
			uids = []int64{22}
		}
		queries = append(queries, translationQueries(user, true, false, false, uids...)...)
	}
	state := installTranslationDB(t, queries)
	for index, user := range []int{0, 42, 43, 42, 0} {
		response := httptest.NewRecorder()
		GetTranslationsHandler(response, translationRequest(t, user))
		var body map[string]string
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		_, hasA := body["app_a"]
		_, hasB := body["app_b"]
		if hasA != (index == 1) || hasB != (index == 2) {
			t.Fatalf("request %d user %d retained another scope: %v", index, user, body)
		}
	}
	if len(state.queries) != 0 {
		t.Fatal("cached a previous response")
	}
}
