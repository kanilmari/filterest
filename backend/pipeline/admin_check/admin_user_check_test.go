// admin_user_check_test.go
// Unit tests for the WithAdminUserCheck pipeline stage.
// Covers missing and malformed session state, database failure, denied admin access, and successful pass-through for allowed admin users.
package admin_check

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	e_sessions "easelect/backend/core_components/sessions"

	gorillaSessions "github.com/gorilla/sessions"
)

var adminUserCheckTestKey = []byte("admin-test-secret-key-32-bytes!!")

func setupTestStore(t *testing.T) *gorillaSessions.CookieStore {
	t.Helper()
	orig := e_sessions.Store
	origName := e_sessions.SessionName
	testStore := gorillaSessions.NewCookieStore(adminUserCheckTestKey)
	testStore.Options = &gorillaSessions.Options{
		Path:     "/",
		MaxAge:   3600,
		HttpOnly: true,
		Secure:   false,
	}
	e_sessions.Store = testStore
	e_sessions.SessionName = "session"
	t.Cleanup(func() {
		e_sessions.Store = orig
		e_sessions.SessionName = origName
	})
	return testStore
}

func buildReq(t *testing.T, store *gorillaSessions.CookieStore, target string, userID interface{}) *http.Request {
	t.Helper()
	cookieW := httptest.NewRecorder()
	cookieR := httptest.NewRequest(http.MethodGet, target, nil)
	sess, err := store.Get(cookieR, e_sessions.SessionName)
	if err != nil {
		t.Fatalf("setup: store.Get: %v", err)
	}
	if userID != nil {
		sess.Values["user_id"] = userID
	}
	if saveErr := sess.Save(cookieR, cookieW); saveErr != nil {
		t.Fatalf("setup: sess.Save: %v", saveErr)
	}
	req := httptest.NewRequest(http.MethodGet, target, nil)
	for _, c := range cookieW.Result().Cookies() {
		req.AddCookie(c)
	}
	return req
}

func noopHandler(called *bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		*called = true
		w.WriteHeader(http.StatusOK)
	}
}

type mockConfig struct {
	adminAllowed bool
	adminMember  bool
	queryErr     bool
}

type mockDriver struct{ cfg mockConfig }
type mockConn struct{ cfg mockConfig }
type mockTx struct{}

type mockRows struct {
	cols []string
	vals []driver.Value
	done bool
}

func (d *mockDriver) Open(_ string) (driver.Conn, error) {
	return &mockConn{cfg: d.cfg}, nil
}

func (c *mockConn) Prepare(_ string) (driver.Stmt, error) {
	return nil, fmt.Errorf("prepare not supported")
}
func (c *mockConn) Close() error              { return nil }
func (c *mockConn) Begin() (driver.Tx, error) { return &mockTx{}, nil }
func (t *mockTx) Commit() error               { return nil }
func (t *mockTx) Rollback() error             { return nil }
func (r *mockRows) Columns() []string         { return r.cols }
func (r *mockRows) Close() error              { return nil }
func (r *mockRows) Next(dest []driver.Value) error {
	if r.done {
		return io.EOF
	}
	r.done = true
	copy(dest, r.vals)
	return nil
}

func mockBoolRow(col string, val bool) driver.Rows {
	return &mockRows{cols: []string{col}, vals: []driver.Value{val}}
}

func (c *mockConn) Query(query string, args []driver.Value) (driver.Rows, error) {
	named := make([]driver.NamedValue, len(args))
	for i, v := range args {
		named[i] = driver.NamedValue{Ordinal: i + 1, Value: v}
	}
	return c.QueryContext(context.Background(), query, named)
}

func (c *mockConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	if strings.Contains(query, "admin_access_allowed") {
		if c.cfg.queryErr {
			return nil, fmt.Errorf("simulated DB error")
		}
		return mockBoolRow("admin_access_allowed", c.cfg.adminAllowed), nil
	}
	if strings.Contains(query, "FROM system_user_group_memberships") {
		if c.cfg.queryErr {
			return nil, fmt.Errorf("simulated DB error")
		}
		if !c.cfg.adminMember {
			return &mockRows{cols: []string{"?column?"}, done: true}, nil
		}
		return &mockRows{cols: []string{"?column?"}, vals: []driver.Value{int64(1)}}, nil
	}
	return nil, fmt.Errorf("unexpected query: %s", query)
}

var mockDriverCounter int64

func setupMockDB(t *testing.T, cfg mockConfig) {
	t.Helper()
	orig := backend.Db
	d := &mockDriver{cfg: cfg}
	name := fmt.Sprintf("admin_user_check_%d_%d", time.Now().UnixNano(), atomic.AddInt64(&mockDriverCounter, 1))
	sql.Register(name, d)
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatalf("sql.Open mock: %v", err)
	}
	backend.Db = db
	t.Cleanup(func() {
		_ = db.Close()
		backend.Db = orig
	})
}

func TestWithAdminUserCheck_MissingUserIDRedirectsToLogin(t *testing.T) {
	store := setupTestStore(t)
	req := buildReq(t, store, "/api/admin", nil)
	rr := httptest.NewRecorder()
	called := false

	WithAdminUserCheck(noopHandler(&called))(rr, req)

	if called {
		t.Error("handler must not be called when user_id is missing")
	}
	if rr.Code != http.StatusSeeOther {
		t.Fatalf("status: got %d, want %d", rr.Code, http.StatusSeeOther)
	}
	if loc := rr.Header().Get("Location"); loc != "/login" {
		t.Fatalf("Location: got %q, want /login", loc)
	}
}

func TestWithAdminUserCheck_WrongTypeUserIDReturnsAuthFailure(t *testing.T) {
	store := setupTestStore(t)
	req := buildReq(t, store, "/api/admin", "wrong-type")
	rr := httptest.NewRecorder()
	called := false

	WithAdminUserCheck(noopHandler(&called))(rr, req)

	if called {
		t.Error("handler must not be called when user_id type is invalid")
	}
	if rr.Code != http.StatusForbidden {
		t.Fatalf("status: got %d, want %d", rr.Code, http.StatusForbidden)
	}
	var body map[string]interface{}
	if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
		t.Fatalf("decode auth failure body: %v", err)
	}
	if body["auth_failure"] != true {
		t.Fatalf("expected auth_failure=true, got %#v", body)
	}
}

func TestWithAdminUserCheck_DBErrorReturnsForbidden(t *testing.T) {
	store := setupTestStore(t)
	setupMockDB(t, mockConfig{queryErr: true})
	req := buildReq(t, store, "/api/admin", 7)
	rr := httptest.NewRecorder()
	called := false

	WithAdminUserCheck(noopHandler(&called))(rr, req)

	if called {
		t.Error("handler must not be called when admin check query fails")
	}
	if rr.Code != http.StatusForbidden {
		t.Fatalf("status: got %d, want %d", rr.Code, http.StatusForbidden)
	}
}

func TestWithAdminUserCheck_AdminAccessDeniedReturnsForbidden(t *testing.T) {
	store := setupTestStore(t)
	setupMockDB(t, mockConfig{adminAllowed: false})
	req := buildReq(t, store, "/api/admin", 7)
	rr := httptest.NewRecorder()
	called := false

	WithAdminUserCheck(noopHandler(&called))(rr, req)

	if called {
		t.Error("handler must not be called when admin access is denied")
	}
	if rr.Code != http.StatusForbidden {
		t.Fatalf("status: got %d, want %d", rr.Code, http.StatusForbidden)
	}
	var body map[string]interface{}
	if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
		t.Fatalf("decode forbidden body: %v", err)
	}
	if body["error"] != "403 - Forbidden (admin access not allowed)" {
		t.Fatalf("unexpected error body: %#v", body)
	}
}

func TestWithAdminUserCheck_AdminAllowedCallsNextHandler(t *testing.T) {
	store := setupTestStore(t)
	setupMockDB(t, mockConfig{adminAllowed: true, adminMember: true})
	req := buildReq(t, store, "/api/admin", 7)
	rr := httptest.NewRecorder()
	called := false

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		actor, ok := dbutils.GetRequestActorContext(r.Context())
		if !ok {
			t.Fatal("request actor missing from context")
		}
		if actor.UserID != 7 || actor.UserRole != "admin" || !actor.IsAdmin {
			t.Fatalf("actor = %#v, want admin actor for user 7", actor)
		}
		w.WriteHeader(http.StatusOK)
	})

	WithAdminUserCheck(handler)(rr, req)

	if !called {
		t.Fatal("handler must be called for admin-allowed user")
	}
	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d, want %d", rr.Code, http.StatusOK)
	}
}
