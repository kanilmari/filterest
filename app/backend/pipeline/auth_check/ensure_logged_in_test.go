// ensure_logged_in_test.go
// Unit tests for the EnsureLoggedIn pipeline stage.
// Covers anonymous-user redirects, guest-session fallback, config-query failure, wrong-type session values, and normal authenticated pass-through behavior.
package auth_check

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
	e_sessions "easelect/backend/core_components/sessions"

	gorillaSessions "github.com/gorilla/sessions"
)

var ensureLoggedInTestKey = []byte("test-secret-key-32-bytes-padding!")

func setupTestStore(t *testing.T) *gorillaSessions.CookieStore {
	t.Helper()
	orig := e_sessions.Store
	origName := e_sessions.SessionName
	testStore := gorillaSessions.NewCookieStore(ensureLoggedInTestKey)
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

func buildReq(t *testing.T, store *gorillaSessions.CookieStore, method, target string, userID interface{}) *http.Request {
	t.Helper()
	cookieW := httptest.NewRecorder()
	cookieR := httptest.NewRequest(http.MethodGet, target, nil)
	sess, err := store.Get(cookieR, e_sessions.SessionName)
	if err != nil {
		t.Fatalf("setup: store.Get: %v", err)
	}
	if userID != nil {
		sess.Values["user_id"] = userID
		if numericUserID, ok := userID.(int); ok && numericUserID > 1 {
			sess.Values["authentication_generation"] = int64(1)
		}
	}
	if saveErr := sess.Save(cookieR, cookieW); saveErr != nil {
		t.Fatalf("setup: sess.Save: %v", saveErr)
	}
	req := httptest.NewRequest(method, target, nil)
	for _, c := range cookieW.Result().Cookies() {
		req.AddCookie(c)
	}
	return req
}

func savedSessionFromResponse(t *testing.T, store *gorillaSessions.CookieStore, target string, rr *httptest.ResponseRecorder) *gorillaSessions.Session {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, target, nil)
	// Browsers retain the last Set-Cookie for each name when one response
	// clears an identity and then establishes a public guest session.
	latest := map[string]*http.Cookie{}
	for _, cookie := range rr.Result().Cookies() {
		latest[cookie.Name] = cookie
	}
	for _, cookie := range latest {
		req.AddCookie(cookie)
	}
	sess, err := store.Get(req, e_sessions.SessionName)
	if err != nil {
		t.Fatalf("store.Get from response cookies: %v", err)
	}
	return sess
}

func noopHandler(called *bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		*called = true
		w.WriteHeader(http.StatusOK)
	}
}

type mockConfig struct {
	adminOnly         bool
	adminAllowed      bool
	adminMember       bool
	policyError       bool
	loginToBrowse     bool
	loginToBrowseErr  bool
	authGeneration    int64
	authGenerationErr bool
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

func (c *mockConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if strings.Contains(query, "FROM system_config") && len(args) == 1 {
		if c.cfg.policyError {
			return nil, fmt.Errorf("policy unavailable")
		}
		return mockBoolRow("boolean_value", c.cfg.adminOnly), nil
	}
	if strings.Contains(query, "admin_access_allowed IS TRUE") {
		return &mockRows{cols: []string{"enabled", "admin_access_allowed"}, vals: []driver.Value{true, c.cfg.adminAllowed}}, nil
	}
	if strings.Contains(query, "FROM system_user_group_memberships") {
		return &mockRows{cols: []string{"membership"}, vals: []driver.Value{int64(1)}, done: !c.cfg.adminMember}, nil
	}
	if strings.Contains(query, "login_to_browse") {
		if c.cfg.loginToBrowseErr {
			return nil, fmt.Errorf("simulated DB error")
		}
		return mockBoolRow("boolean_value", c.cfg.loginToBrowse), nil
	}
	if strings.Contains(query, "authentication_generation") {
		if c.cfg.authGenerationErr {
			return nil, fmt.Errorf("simulated authentication generation error")
		}
		generation := c.cfg.authGeneration
		if generation == 0 {
			generation = 1
		}
		return &mockRows{cols: []string{"authentication_generation"}, vals: []driver.Value{generation}}, nil
	}
	return nil, fmt.Errorf("unexpected query: %s", query)
}

var mockDriverCounter int64

func setupMockDB(t *testing.T, cfg mockConfig) {
	t.Helper()
	orig := backend.Db
	origAdmin := backend.DbAdmin
	origConfidential := backend.DbConfidential
	d := &mockDriver{cfg: cfg}
	name := fmt.Sprintf("ensure_logged_in_%d_%d", time.Now().UnixNano(), atomic.AddInt64(&mockDriverCounter, 1))
	sql.Register(name, d)
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatalf("sql.Open mock: %v", err)
	}
	backend.Db = db
	backend.DbAdmin = nil
	backend.DbConfidential = db
	t.Cleanup(func() {
		_ = db.Close()
		backend.Db = orig
		backend.DbAdmin = origAdmin
		backend.DbConfidential = origConfidential
	})
}

func TestEnsureLoggedIn_AnonymousUser_LoginRequired(t *testing.T) {
	store := setupTestStore(t)
	setupMockDB(t, mockConfig{loginToBrowse: true})
	req := buildReq(t, store, http.MethodGet, "/api/get-results", nil)
	rr := httptest.NewRecorder()
	called := false

	EnsureLoggedIn(noopHandler(&called))(rr, req)

	if called {
		t.Error("handler must not be called for anonymous user when login is required")
	}
	if rr.Code != http.StatusSeeOther {
		t.Fatalf("status: got %d, want %d", rr.Code, http.StatusSeeOther)
	}
	if loc := rr.Header().Get("Location"); loc != "/login" {
		t.Fatalf("Location: got %q, want /login", loc)
	}
}

func TestEnsureLoggedIn_AnonymousUser_GuestAllowed(t *testing.T) {
	store := setupTestStore(t)
	setupMockDB(t, mockConfig{loginToBrowse: false})
	req := buildReq(t, store, http.MethodGet, "/api/get-results", nil)
	rr := httptest.NewRecorder()
	called := false

	EnsureLoggedIn(noopHandler(&called))(rr, req)

	if !called {
		t.Fatal("handler must be called when guest browsing is allowed")
	}
	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d, want %d", rr.Code, http.StatusOK)
	}
	sess := savedSessionFromResponse(t, store, "/api/get-results", rr)
	userID, ok := sess.Values["user_id"].(int)
	if !ok {
		t.Fatalf("expected saved session user_id to be int, got %#v", sess.Values["user_id"])
	}
	if userID != 1 {
		t.Fatalf("expected guest session user_id=1, got %d", userID)
	}
}

func TestEnsureLoggedIn_StaleGuestSession_LoginRequired(t *testing.T) {
	store := setupTestStore(t)
	setupMockDB(t, mockConfig{loginToBrowse: true})
	req := buildReq(t, store, http.MethodGet, "/api/get-results", 1)
	rr := httptest.NewRecorder()
	called := false

	EnsureLoggedIn(noopHandler(&called))(rr, req)

	if called {
		t.Error("handler must not be called for stale guest session when login is required")
	}
	if rr.Code != http.StatusSeeOther {
		t.Fatalf("status: got %d, want %d", rr.Code, http.StatusSeeOther)
	}
	if loc := rr.Header().Get("Location"); loc != "/login" {
		t.Fatalf("Location: got %q, want /login", loc)
	}
	sess := savedSessionFromResponse(t, store, "/api/get-results", rr)
	if _, ok := sess.Values["user_id"]; ok {
		t.Fatalf("expected user_id to be cleared, got %#v", sess.Values["user_id"])
	}
}

func TestEnsureLoggedIn_AnonymousUser_ConfigErrorFailsClosed(t *testing.T) {
	store := setupTestStore(t)
	setupMockDB(t, mockConfig{loginToBrowseErr: true})
	req := buildReq(t, store, http.MethodGet, "/api/get-results", nil)
	rr := httptest.NewRecorder()
	called := false

	EnsureLoggedIn(noopHandler(&called))(rr, req)

	if called {
		t.Error("handler must not be called when login_to_browse lookup fails")
	}
	if rr.Code != http.StatusSeeOther {
		t.Fatalf("status: got %d, want %d", rr.Code, http.StatusSeeOther)
	}
	if loc := rr.Header().Get("Location"); loc != "/login" {
		t.Fatalf("Location: got %q, want /login", loc)
	}
}

func TestEnsureLoggedIn_WrongTypeUserID(t *testing.T) {
	store := setupTestStore(t)
	req := buildReq(t, store, http.MethodGet, "/api/get-results", "wrong-type")
	rr := httptest.NewRecorder()
	called := false

	EnsureLoggedIn(noopHandler(&called))(rr, req)

	if called {
		t.Error("handler must not be called for wrong-type user_id")
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

func TestEnsureLoggedIn_AuthenticatedUserUsesConfidentialGenerationRead(t *testing.T) {
	store := setupTestStore(t)
	setupMockDB(t, mockConfig{authGeneration: 1})
	req := buildReq(t, store, http.MethodGet, "/api/get-results", 42)
	rr := httptest.NewRecorder()
	called := false

	EnsureLoggedIn(noopHandler(&called))(rr, req)

	if !called {
		t.Fatal("handler must be called for authenticated user")
	}
	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d, want %d", rr.Code, http.StatusOK)
	}
}

func TestEnsureLoggedIn_StaleAuthenticatedSessionIsCleared(t *testing.T) {
	store := setupTestStore(t)
	setupMockDB(t, mockConfig{loginToBrowse: true, authGeneration: 2})
	req := buildReq(t, store, http.MethodGet, "/api/get-results", 42)
	rr := httptest.NewRecorder()
	called := false

	EnsureLoggedIn(noopHandler(&called))(rr, req)

	if called || rr.Code != http.StatusSeeOther || rr.Header().Get("Location") != "/login" {
		t.Fatalf("stale session result: called=%v status=%d location=%q", called, rr.Code, rr.Header().Get("Location"))
	}
	session := savedSessionFromResponse(t, store, "/api/get-results", rr)
	if _, exists := session.Values["user_id"]; exists {
		t.Fatal("stale authenticated identity was not cleared")
	}
}

func TestEnsureLoggedIn_AuthenticationGenerationDatabaseErrorFailsClosed(t *testing.T) {
	store := setupTestStore(t)
	setupMockDB(t, mockConfig{authGenerationErr: true})
	req := buildReq(t, store, http.MethodGet, "/api/get-results", 42)
	rr := httptest.NewRecorder()
	called := false

	EnsureLoggedIn(noopHandler(&called))(rr, req)

	if called || rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("database failure result: called=%v status=%d", called, rr.Code)
	}
}

func TestAdminOnlyModeDowngradesExistingBasicSessionToPublicGuest(t *testing.T) {
	store := setupTestStore(t)
	setupMockDB(t, mockConfig{adminOnly: true, adminAllowed: false, loginToBrowse: false})
	req := buildReq(t, store, http.MethodGet, "/api/get-results", 42)
	rr := httptest.NewRecorder()
	called := false
	EnsureLoggedIn(noopHandler(&called))(rr, req)
	if !called {
		t.Fatal("public browsing stopped after basic sign-in was revoked")
	}
	session := savedSessionFromResponse(t, store, "/api/get-results", rr)
	if session.Values["user_id"] != 1 {
		t.Fatalf("expected guest principal, got %#v", session.Values["user_id"])
	}
	if _, ok := session.Values["authentication_generation"]; ok {
		t.Fatal("basic authentication generation remains")
	}
}

func TestAdminOnlyModePreservesExistingGuestBrowsing(t *testing.T) {
	store := setupTestStore(t)
	setupMockDB(t, mockConfig{adminOnly: true, loginToBrowse: false})
	req := buildReq(t, store, http.MethodGet, "/api/get-results", 1)
	rr := httptest.NewRecorder()
	called := false
	EnsureLoggedIn(noopHandler(&called))(rr, req)
	if !called || rr.Code != http.StatusOK {
		t.Fatalf("guest incorrectly subject to sign-in restriction: %d", rr.Code)
	}
}

func TestAuthenticatedSessionFailsClosedOnAdmissionReadFailure(t *testing.T) {
	store := setupTestStore(t)
	setupMockDB(t, mockConfig{policyError: true})
	req := buildReq(t, store, http.MethodGet, "/api/get-results", 42)
	rr := httptest.NewRecorder()
	called := false
	EnsureLoggedIn(noopHandler(&called))(rr, req)
	if called || rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("unverifiable admission passed: %d", rr.Code)
	}
}
