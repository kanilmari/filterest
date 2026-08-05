// get_auth_modes_test.go
// Regression tests for auth bootstrap session handling around login_to_browse.
// Ensures auth-modes does not silently recreate guest sessions when login is required.
package auth

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

var authModesTestKey = []byte("test-secret-key-32-bytes-padding!")

func setupAuthModesTestStore(t *testing.T) *gorillaSessions.CookieStore {
	t.Helper()
	orig := e_sessions.Store
	origName := e_sessions.SessionName
	testStore := gorillaSessions.NewCookieStore(authModesTestKey)
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

func buildAuthModesReq(t *testing.T, store *gorillaSessions.CookieStore, target string, values map[interface{}]interface{}) *http.Request {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, target, nil)
	if values == nil {
		return req
	}

	cookieW := httptest.NewRecorder()
	cookieR := httptest.NewRequest(http.MethodGet, target, nil)
	sess, err := store.Get(cookieR, e_sessions.SessionName)
	if err != nil {
		t.Fatalf("setup: store.Get: %v", err)
	}
	for key, value := range values {
		sess.Values[key] = value
	}
	if saveErr := sess.Save(cookieR, cookieW); saveErr != nil {
		t.Fatalf("setup: sess.Save: %v", saveErr)
	}
	for _, c := range cookieW.Result().Cookies() {
		req.AddCookie(c)
	}
	return req
}

func savedAuthModesSessionFromResponse(t *testing.T, store *gorillaSessions.CookieStore, target string, rr *httptest.ResponseRecorder) *gorillaSessions.Session {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, target, nil)
	for _, c := range rr.Result().Cookies() {
		req.AddCookie(c)
	}
	sess, err := store.Get(req, e_sessions.SessionName)
	if err != nil {
		t.Fatalf("store.Get from response cookies: %v", err)
	}
	return sess
}

type authModesMockConfig struct {
	loginToBrowse      bool
	registrationEnable bool
	userExists         bool
	adminMember        bool
}

type authModesMockDriver struct{ cfg authModesMockConfig }
type authModesMockConn struct{ cfg authModesMockConfig }
type authModesMockTx struct{}

type authModesMockRows struct {
	cols  []string
	vals  []driver.Value
	done  bool
	empty bool
}

func (d *authModesMockDriver) Open(_ string) (driver.Conn, error) {
	return &authModesMockConn{cfg: d.cfg}, nil
}

func (c *authModesMockConn) Prepare(_ string) (driver.Stmt, error) {
	return nil, fmt.Errorf("prepare not supported")
}
func (c *authModesMockConn) Close() error              { return nil }
func (c *authModesMockConn) Begin() (driver.Tx, error) { return &authModesMockTx{}, nil }
func (t *authModesMockTx) Commit() error               { return nil }
func (t *authModesMockTx) Rollback() error             { return nil }
func (r *authModesMockRows) Columns() []string         { return r.cols }
func (r *authModesMockRows) Close() error              { return nil }
func (r *authModesMockRows) Next(dest []driver.Value) error {
	if r.empty || r.done {
		return io.EOF
	}
	r.done = true
	copy(dest, r.vals)
	return nil
}

func authModesBoolRow(col string, val bool) driver.Rows {
	return &authModesMockRows{cols: []string{col}, vals: []driver.Value{val}}
}

func authModesOneRow() driver.Rows {
	return &authModesMockRows{cols: []string{"?column?"}, vals: []driver.Value{1}}
}

func authModesEmptyRow(col string) driver.Rows {
	return &authModesMockRows{cols: []string{col}, empty: true}
}

func (c *authModesMockConn) Query(query string, args []driver.Value) (driver.Rows, error) {
	named := make([]driver.NamedValue, len(args))
	for i, v := range args {
		named[i] = driver.NamedValue{Ordinal: i + 1, Value: v}
	}
	return c.QueryContext(context.Background(), query, named)
}

func (c *authModesMockConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	switch {
	case strings.Contains(query, "login_to_browse"):
		return authModesBoolRow("boolean_value", c.cfg.loginToBrowse), nil
	case strings.Contains(query, "registration_enabled"):
		return authModesBoolRow("boolean_value", c.cfg.registrationEnable), nil
	case strings.Contains(query, "FROM system_users"):
		if c.cfg.userExists {
			return authModesOneRow(), nil
		}
		return authModesEmptyRow("?column?"), nil
	case strings.Contains(query, "FROM system_user_group_memberships"):
		if c.cfg.adminMember {
			return authModesOneRow(), nil
		}
		return authModesEmptyRow("?column?"), nil
	default:
		return nil, fmt.Errorf("unexpected query: %s", query)
	}
}

var authModesDriverCounter int64

func setupAuthModesMockDB(t *testing.T, cfg authModesMockConfig) {
	t.Helper()
	orig := backend.Db
	d := &authModesMockDriver{cfg: cfg}
	name := fmt.Sprintf("auth_modes_%d_%d", time.Now().UnixNano(), atomic.AddInt64(&authModesDriverCounter, 1))
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

func TestGetAuthModesHandler_LoginRequiredDoesNotCreateGuestSession(t *testing.T) {
	_ = setupAuthModesTestStore(t)
	setupAuthModesMockDB(t, authModesMockConfig{
		loginToBrowse:      true,
		registrationEnable: true,
	})
	req := httptest.NewRequest(http.MethodGet, "/api/auth-modes", nil)
	rr := httptest.NewRecorder()

	GetAuthModesHandler(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d, want %d", rr.Code, http.StatusOK)
	}
	var body AuthModesResponse
	if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body.NeedsButton != "login" {
		t.Fatalf("needs_button = %q, want %q", body.NeedsButton, "login")
	}
	if !body.RegistrationEnabled {
		t.Fatal("registration_enabled = false, want true")
	}
	if !body.LoginRequiredForBrowse {
		t.Fatal("login_required_for_browse = false, want true")
	}
	if len(rr.Result().Cookies()) != 0 {
		t.Fatalf("expected no session cookie to be set, got %d cookies", len(rr.Result().Cookies()))
	}
}

func TestGetAuthModesHandler_LoginRequiredClearsStaleGuestSession(t *testing.T) {
	store := setupAuthModesTestStore(t)
	setupAuthModesMockDB(t, authModesMockConfig{
		loginToBrowse:      true,
		registrationEnable: false,
	})
	req := buildAuthModesReq(t, store, "/api/auth-modes", map[interface{}]interface{}{
		"user_id":       1,
		"user_role":     "guest",
		"authenticated": true,
		"username":      "guest-user",
	})
	rr := httptest.NewRecorder()

	GetAuthModesHandler(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d, want %d", rr.Code, http.StatusOK)
	}
	var body AuthModesResponse
	if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body.NeedsButton != "login" {
		t.Fatalf("needs_button = %q, want %q", body.NeedsButton, "login")
	}
	if !body.LoginRequiredForBrowse {
		t.Fatal("login_required_for_browse = false, want true")
	}
	sess := savedAuthModesSessionFromResponse(t, store, "/api/auth-modes", rr)
	if _, ok := sess.Values["user_id"]; ok {
		t.Fatalf("expected user_id to be cleared, got %#v", sess.Values["user_id"])
	}
	if _, ok := sess.Values["user_role"]; ok {
		t.Fatalf("expected user_role to be cleared, got %#v", sess.Values["user_role"])
	}
	if _, ok := sess.Values["authenticated"]; ok {
		t.Fatalf("expected authenticated to be cleared, got %#v", sess.Values["authenticated"])
	}
	if _, ok := sess.Values["username"]; ok {
		t.Fatalf("expected username to be cleared, got %#v", sess.Values["username"])
	}
}

func TestGetAuthModesHandler_ClearsDeletedLoggedInUserSession(t *testing.T) {
	store := setupAuthModesTestStore(t)
	setupAuthModesMockDB(t, authModesMockConfig{
		loginToBrowse:      false,
		registrationEnable: false,
		userExists:         false,
	})
	req := buildAuthModesReq(t, store, "/api/auth-modes", map[interface{}]interface{}{
		"user_id":       999,
		"user_role":     "basic",
		"authenticated": true,
		"username":      "deleted-user",
	})
	rr := httptest.NewRecorder()

	GetAuthModesHandler(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d, want %d", rr.Code, http.StatusOK)
	}
	var body AuthModesResponse
	if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body.NeedsButton != "login" {
		t.Fatalf("needs_button = %q, want %q", body.NeedsButton, "login")
	}
	sess := savedAuthModesSessionFromResponse(t, store, "/api/auth-modes", rr)
	if _, ok := sess.Values["user_id"]; ok {
		t.Fatalf("expected user_id to be cleared, got %#v", sess.Values["user_id"])
	}
	if _, ok := sess.Values["user_role"]; ok {
		t.Fatalf("expected user_role to be cleared, got %#v", sess.Values["user_role"])
	}
	if _, ok := sess.Values["authenticated"]; ok {
		t.Fatalf("expected authenticated to be cleared, got %#v", sess.Values["authenticated"])
	}
	if _, ok := sess.Values["username"]; ok {
		t.Fatalf("expected username to be cleared, got %#v", sess.Values["username"])
	}
}

func TestGetAuthModesHandler_GuestBrowsingAllowedCreatesGuestSession(t *testing.T) {
	store := setupAuthModesTestStore(t)
	setupAuthModesMockDB(t, authModesMockConfig{
		loginToBrowse:      false,
		registrationEnable: false,
	})
	req := httptest.NewRequest(http.MethodGet, "/api/auth-modes", nil)
	rr := httptest.NewRecorder()

	GetAuthModesHandler(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d, want %d", rr.Code, http.StatusOK)
	}
	var body AuthModesResponse
	if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body.NeedsButton != "login" {
		t.Fatalf("needs_button = %q, want %q", body.NeedsButton, "login")
	}
	if body.LoginRequiredForBrowse {
		t.Fatal("login_required_for_browse = true, want false")
	}
	sess := savedAuthModesSessionFromResponse(t, store, "/api/auth-modes", rr)
	userID, ok := sess.Values["user_id"].(int)
	if !ok {
		t.Fatalf("expected saved session user_id to be int, got %#v", sess.Values["user_id"])
	}
	if userID != 1 {
		t.Fatalf("expected guest session user_id=1, got %d", userID)
	}
	if role := sess.Values["user_role"]; role != "guest" {
		t.Fatalf("expected guest session user_role=guest, got %#v", role)
	}
}
