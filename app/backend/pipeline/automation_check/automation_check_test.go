// automation_check_test.go
// Exercises signed cookies against a deterministic protected-identity SQL driver.
// Bridges the always-enforced request guard with real Gorilla cookie verification.
// Exists to prevent PublicProfile, renamed users, stale generations, and header-only grants.
package automation_check

import (
	"context"
	"database/sql"
	"database/sql/driver"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/auth_generation"
	e_sessions "easelect/backend/core_components/sessions"
	"errors"
	"fmt"
	"github.com/gorilla/sessions"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

type policyDriver struct {
	api, enabled, missing, fail bool
	generation                  int64
	queries                     int
}
type policyConn struct{ state *policyDriver }
type policyRows struct {
	values []driver.Value
	done   bool
}

func (d *policyDriver) Open(string) (driver.Conn, error)  { return &policyConn{d}, nil }
func (c *policyConn) Prepare(string) (driver.Stmt, error) { return nil, errors.New("unsupported") }
func (c *policyConn) Close() error                        { return nil }
func (c *policyConn) Begin() (driver.Tx, error)           { return nil, errors.New("unsupported") }
func (c *policyConn) QueryContext(_ context.Context, q string, args []driver.NamedValue) (driver.Rows, error) {
	c.state.queries++
	if !strings.Contains(q, "ur.api_only") || !strings.Contains(q, "WHERE u.id = $1") || len(args) != 1 || args[0].Value != int64(42) {
		return nil, errors.New("unexpected query or identity")
	}
	if c.state.fail {
		return nil, errors.New("private database error must not be exposed")
	}
	return &policyRows{[]driver.Value{c.state.api, c.state.generation, c.state.enabled}, c.state.missing}, nil
}
func (r *policyRows) Columns() []string {
	return []string{"api_only", "authentication_generation", "enabled"}
}
func (r *policyRows) Close() error { return nil }
func (r *policyRows) Next(dst []driver.Value) error {
	if r.done {
		return io.EOF
	}
	r.done = true
	copy(dst, r.values)
	return nil
}

var policyCounter atomic.Int64

func TestAutomationGuardSignedCookieMatrix(t *testing.T) {
	for _, tc := range []struct {
		name, path, pattern, header         string
		api, enabled, marker, fail, missing bool
		generation, stored                  int64
		userID                              int
		status                              int
	}{
		{"valid", "/api/profile", "/api/profile", "1", true, true, true, false, false, 4, 4, 42, 200},
		{"legacy cookie", "/api/profile", "/api/profile", "1", true, true, false, false, false, 4, 4, 42, 401},
		{"missing header", "/api/profile", "/api/profile", "", true, true, true, false, false, 4, 4, 42, 403},
		{"wrong header", "/api/profile", "/api/profile", "true", true, true, true, false, false, 4, 4, 42, 403},
		{"public HTML", "/app", "/", "1", true, true, true, false, false, 4, 4, 42, 403},
		{"HTML catchall", "/api/unknown", "/", "1", true, true, true, false, false, 4, 4, 42, 403},
		{"stale", "/api/profile", "/api/profile", "1", true, true, true, false, false, 5, 4, 42, 401},
		{"legacy no generation", "/app", "/", "1", true, true, true, false, false, 4, 0, 42, 401},
		{"disabled", "/api/profile", "/api/profile", "1", true, false, true, false, false, 4, 4, 42, 401},
		{"missing identity", "/api/profile", "/api/profile", "1", true, true, true, false, true, 4, 4, 42, 401},
		{"policy failure", "/app", "/", "1", true, true, true, true, false, 4, 4, 42, 503},
		{"ordinary human HTML", "/app", "/", "", false, true, false, false, false, 4, 0, 42, 200},
		{"guest no lookup", "/app", "/", "", false, false, false, true, false, 0, 0, 1, 200},
		{"anonymous csrf bootstrap", "/api/csrf-token", "/api/csrf-token", "1", false, false, false, true, false, 0, 0, 0, 200},
		{"header alone", "/api/profile", "/api/profile", "1", false, false, false, true, false, 0, 0, 0, 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			state := &policyDriver{api: tc.api, enabled: tc.enabled, missing: tc.missing, fail: tc.fail, generation: tc.generation}
			name := fmt.Sprintf("api_policy_%d", policyCounter.Add(1))
			sql.Register(name, state)
			db, err := sql.Open(name, "")
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			oldDB, oldStore, oldName := backend.DbConfidential, e_sessions.Store, e_sessions.SessionName
			backend.DbConfidential = db
			e_sessions.Store = sessions.NewCookieStore([]byte("test-key-test-key-test-key-test-key"))
			e_sessions.SessionName = "policy-test"
			defer func() { backend.DbConfidential = oldDB; e_sessions.Store = oldStore; e_sessions.SessionName = oldName }()
			r := httptest.NewRequest("GET", tc.path, nil)
			if tc.header != "" {
				r.Header.Set(auth_generation.AutomationHeader, tc.header)
			}
			if tc.userID > 0 {
				seed := httptest.NewRequest("GET", "/", nil)
				s, _ := e_sessions.Store.New(seed, e_sessions.SessionName)
				s.Values["user_id"] = tc.userID
				s.Values["username"] = "renamed-public-profile"
				s.Values["authenticated"] = true
				s.Values[auth_generation.SessionKey] = tc.stored
				s.Values[auth_generation.AutomationSessionKey] = tc.marker
				cookies := httptest.NewRecorder()
				if err = s.Save(seed, cookies); err != nil {
					t.Fatal(err)
				}
				for _, cookie := range cookies.Result().Cookies() {
					r.AddCookie(cookie)
				}
			}
			reached := false
			w := httptest.NewRecorder()
			WithAutomationCheck(tc.pattern, func(w http.ResponseWriter, r *http.Request) { reached = true; w.WriteHeader(200) })(w, r)
			if w.Code != tc.status || reached != (tc.status == 200) {
				t.Fatalf("status=%d reached=%v body=%s", w.Code, reached, w.Body)
			}
			if strings.Contains(w.Body.String(), "private database") {
				t.Fatal("database error leaked")
			}
			if tc.userID <= 1 && state.queries != 0 {
				t.Fatal("anonymous or guest bootstrap queried protected credentials")
			}
			if tc.status == 401 {
				check := httptest.NewRequest("GET", "/", nil)
				for _, cookie := range w.Result().Cookies() {
					check.AddCookie(cookie)
				}
				s, err := e_sessions.Store.Get(check, e_sessions.SessionName)
				if err != nil {
					t.Fatal(err)
				}
				if _, exists := s.Values["user_id"]; exists {
					t.Fatal("rejected identity not cleared")
				}
				if _, exists := s.Values[auth_generation.AutomationSessionKey]; exists {
					t.Fatal("rejected API marker not cleared")
				}
			}
		})
	}
}
