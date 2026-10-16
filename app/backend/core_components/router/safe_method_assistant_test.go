// safe_method_assistant_test.go
// Exercises delegated and ordinary sessions against real maintenance registrations.
// Connects method contracts, CSRF and assistant approval with a recording database.
// Proves GET/HEAD without CSRF cannot reach maintenance writes.
package router

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	e_sessions "easelect/backend/core_components/sessions"
	"easelect/backend/core_components/site_assistant"
	"easelect/backend/pipeline"
	"easelect/backend/pipeline/csrf_check"
	"easelect/backend/pipeline/site_assistant_guard"
	"github.com/gorilla/sessions"
)

type safeMethodDB struct{ reads, writes int }
type safeMethodConn struct{ state *safeMethodDB }
type safeMethodRows struct{}

func (s *safeMethodDB) Connect(context.Context) (driver.Conn, error) { return &safeMethodConn{s}, nil }
func (s *safeMethodDB) Driver() driver.Driver                        { return s }
func (s *safeMethodDB) Open(string) (driver.Conn, error)             { return s.Connect(context.Background()) }
func (*safeMethodConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepare")
}
func (*safeMethodConn) Close() error { return nil }
func (c *safeMethodConn) Begin() (driver.Tx, error) {
	c.state.writes++
	return nil, errors.New("unexpected transaction")
}
func (c *safeMethodConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	if !strings.HasPrefix(strings.TrimSpace(query), "SELECT") {
		c.state.writes++
		return nil, errors.New("non-read query")
	}
	c.state.reads++
	return safeMethodRows{}, nil
}
func (c *safeMethodConn) ExecContext(context.Context, string, []driver.NamedValue) (driver.Result, error) {
	c.state.writes++
	return driver.RowsAffected(1), nil
}
func (safeMethodRows) Columns() []string         { return []string{"empty"} }
func (safeMethodRows) Close() error              { return nil }
func (safeMethodRows) Next([]driver.Value) error { return io.EOF }

func TestMaintenanceSafeMethodsAndAssistantApproval(t *testing.T) {
	oldDB, oldStore, oldName := backend.Db, e_sessions.Store, e_sessions.SessionName
	state := &safeMethodDB{}
	db := sql.OpenDB(state)
	backend.Db = nil // Keep route discovery independent of payment initialization.
	e_sessions.Store = sessions.NewCookieStore([]byte("sec5-test-session-signing-material"))
	e_sessions.SessionName = "sec5_session"
	t.Cleanup(func() {
		backend.Db, e_sessions.Store, e_sessions.SessionName = oldDB, oldStore, oldName
		_ = db.Close()
		ResetRouteDefinitions()
		pipeline.ResetRouteProfiles()
	})
	store := site_assistant.NewStore()
	_, delegation, err := store.Issue(42, "sec5-regression", "localhost", 10*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	request := func(method, target string, assistant, csrf bool) *http.Request {
		r := httptest.NewRequest(method, target, nil)
		s, err := e_sessions.Load(r)
		if err != nil {
			t.Fatal(err)
		}
		s.Values["user_id"], s.Values["csrf_token"] = 42, "fixture-csrf"
		if assistant {
			s.Values[site_assistant.SessionDelegationKey] = delegation.ID
		}
		w := httptest.NewRecorder()
		if err := e_sessions.Save(w, r, s); err != nil {
			t.Fatal(err)
		}
		for _, cookie := range w.Result().Cookies() {
			r.AddCookie(cookie)
		}
		if csrf {
			r.Header.Set("X-CSRF-Token", "fixture-csrf")
		}
		return r
	}
	RegisterRoutes(t.TempDir(), t.TempDir())
	backend.Db = db
	for _, route := range GetRouteDefinitions() {
		if !slices.Contains([]string{"/api/embedding_stream_handler", "/api/check-db-consistency", "/api/scan-lang-sources"}, route.UrlPattern) {
			continue
		}
		stages := pipeline.DescribePipeline(pipeline.RouteContext{}, pipeline.GetProfile(route.HandlerName))
		for _, required := range []string{"site_assistant_guard", "csrf", "admin_check"} {
			if !slices.Contains(stages, required) {
				t.Fatalf("%s missing %s", route.UrlPattern, required)
			}
		}
		protected := site_assistant_guard.WithSiteAssistantGuardStore(store, csrf_check.WithCSRFCheck(route.HandlerFunc))
		for _, assistant := range []bool{false, true} {
			for _, method := range []string{http.MethodGet, http.MethodHead} {
				before := state.writes
				w := httptest.NewRecorder()
				protected(w, request(method, route.UrlPattern+"?dataset=plain", assistant, false))
				want := http.StatusMethodNotAllowed
				if route.UrlPattern == "/api/check-db-consistency" {
					want = http.StatusOK
				}
				if w.Code != want || state.writes != before {
					t.Fatalf("%s %s assistant=%v: status=%d writes=%d→%d", method, route.UrlPattern, assistant, w.Code, before, state.writes)
				}
			}
		}
		if route.UrlPattern == "/api/check-db-consistency" {
			continue
		}
		for _, assistant := range []bool{false, true} {
			before := state.writes
			w := httptest.NewRecorder()
			protected(w, request(http.MethodPost, route.UrlPattern+"?dataset=plain", assistant, assistant))
			if w.Code != http.StatusForbidden || state.writes != before {
				t.Fatalf("unguarded POST %s: %d %s", route.UrlPattern, w.Code, w.Body)
			}
			if assistant && !strings.Contains(w.Body.String(), "site_assistant_approval_required") {
				t.Fatal("assistant was refused for another reason", w.Body)
			}
		}
	}
}
