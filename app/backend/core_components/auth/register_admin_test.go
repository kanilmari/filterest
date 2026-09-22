// register_admin_test.go
// Verifies administrator creation of ordinary users while public signup stays closed.
// Exercises signed sessions, current authorization, CSRF and the existing registration SQL.
// Keeps the administrator identity intact and never substitutes plaintext credential storage.
package auth

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	e_sessions "easelect/backend/core_components/sessions"
	"golang.org/x/crypto/bcrypt"
)

type registerAdminState struct {
	enabled, adminMember, adminAllowed bool
	generation                         int64
	failQuery                          string
	inserts                            int
	passwordHash                       string
	verification                       string
	newEnabled                         bool
	membershipUser, membershipGroup    int64
}
type registerAdminDriver struct{ state *registerAdminState }
type registerAdminConn struct{ state *registerAdminState }

func (d *registerAdminDriver) Open(string) (driver.Conn, error) {
	return &registerAdminConn{d.state}, nil
}
func (c *registerAdminConn) Prepare(string) (driver.Stmt, error) {
	return nil, fmt.Errorf("unexpected prepare")
}
func (c *registerAdminConn) Close() error { return nil }
func (c *registerAdminConn) Begin() (driver.Tx, error) {
	return nil, fmt.Errorf("unexpected transaction")
}
func (c *registerAdminConn) QueryContext(_ context.Context, q string, args []driver.NamedValue) (driver.Rows, error) {
	s := c.state
	if s.failQuery != "" && strings.Contains(q, s.failQuery) {
		return nil, fmt.Errorf("configured read failure")
	}
	switch {
	case strings.Contains(q, "SELECT ur.authentication_generation"):
		if !s.enabled {
			return authModesEmptyRow("authentication_generation"), nil
		}
		return &authModesMockRows{cols: []string{"authentication_generation"}, vals: []driver.Value{s.generation}}, nil
	case strings.Contains(q, "SELECT boolean_value FROM system_config"):
		return authModesBoolRow("boolean_value", false), nil
	case strings.Contains(q, "SELECT 1 FROM system_user_group_memberships"):
		if !s.adminMember {
			return authModesEmptyRow("one"), nil
		}
		return authModesOneRow(), nil
	case strings.Contains(q, "SELECT COALESCE(admin_access_allowed, false)"):
		return authModesBoolRow("admin_access_allowed", s.adminAllowed), nil
	case strings.Contains(q, "SELECT id FROM system_users WHERE username"):
		return authModesEmptyRow("id"), nil
	case strings.Contains(q, "SELECT id FROM restricted.users_restricted WHERE email"):
		return authModesEmptyRow("id"), nil
	case strings.Contains(q, "INSERT INTO system_users"):
		s.inserts++
		s.newEnabled = args[2].Value.(bool)
		if !strings.Contains(q, "$3, false") {
			return nil, fmt.Errorf("ordinary creation must force privileged false")
		}
		return &authModesMockRows{cols: []string{"id"}, vals: []driver.Value{int64(901)}}, nil
	case strings.Contains(q, "SELECT id FROM system_user_groups"):
		if args[0].Value != "users" {
			return nil, fmt.Errorf("must select ordinary users group")
		}
		return &authModesMockRows{cols: []string{"id"}, vals: []driver.Value{int64(2)}}, nil
	}
	return nil, fmt.Errorf("unexpected registration query: %s", q)
}
func (c *registerAdminConn) ExecContext(_ context.Context, q string, args []driver.NamedValue) (driver.Result, error) {
	switch {
	case strings.Contains(q, "INSERT INTO restricted.users_restricted"):
		c.state.passwordHash = args[1].Value.(string)
		c.state.verification = args[3].Value.(string)
	case strings.Contains(q, "INSERT INTO system_user_group_memberships"):
		c.state.membershipUser = args[0].Value.(int64)
		c.state.membershipGroup = args[1].Value.(int64)
	default:
		return nil, fmt.Errorf("unexpected registration mutation")
	}
	return driver.RowsAffected(1), nil
}
func setupRegisterAdmin(t *testing.T) *registerAdminState {
	t.Helper()
	t.Setenv("ENVIRONMENT_TYPE", "prod")
	oldEnabled := registrationEnabledFunc
	registrationEnabledFunc = func() bool { return false }
	t.Cleanup(func() { registrationEnabledFunc = oldEnabled })
	state := &registerAdminState{enabled: true, adminMember: true, adminAllowed: true, generation: 7}
	name := fmt.Sprintf("register_admin_%d", atomic.AddInt64(&authModesDriverCounter, 1))
	sql.Register(name, &registerAdminDriver{state})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	old, oldConf, oldGuest := backend.Db, backend.DbConfidential, backend.DbGuest
	backend.Db, backend.DbConfidential, backend.DbGuest = db, db, db
	t.Cleanup(func() { backend.Db, backend.DbConfidential, backend.DbGuest = old, oldConf, oldGuest; db.Close() })
	authRateLimiter.Lock()
	oldAttempts := authRateLimiter.attempts
	authRateLimiter.attempts = make(map[string]*loginAttempt)
	authRateLimiter.Unlock()
	t.Cleanup(func() { authRateLimiter.Lock(); authRateLimiter.attempts = oldAttempts; authRateLimiter.Unlock() })
	return state
}
func registerAdminRequest(t *testing.T, values map[interface{}]interface{}, csrf string) *http.Request {
	t.Helper()
	store := setupAuthModesTestStore(t)
	req := buildAuthModesReq(t, store, "/api/register_ndYOyXV0INOK3F", values)
	form := url.Values{"username": {"ordinary_fixture"}, "password": {"test-only-strong-password-987!"}, "email": {"fixture@example.invalid"}, "verification_method": {"none"}, "csrf_token": {csrf}}
	req.Method = http.MethodPost
	req.Body = http.NoBody
	req = withRegistrationFormBody(req, form.Encode())
	req.RemoteAddr = "192.0.2.42:1234"
	return req
}
func withRegistrationFormBody(req *http.Request, body string) *http.Request {
	next := httptest.NewRequest(req.Method, req.URL.String(), strings.NewReader(body))
	next.Header = req.Header.Clone()
	next.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	return next
}
func validRegistrationAdminSession() map[interface{}]interface{} {
	return map[interface{}]interface{}{"user_id": 42, "authenticated": true, "user_role": "admin", "username": "original_admin", "authentication_generation": int64(7), "csrf_token": "test-csrf"}
}
func TestClosedRegistrationAllowsCurrentAdminWithoutReplacingSession(t *testing.T) {
	state := setupRegisterAdmin(t)
	req := registerAdminRequest(t, validRegistrationAdminSession(), "test-csrf")
	rr := httptest.NewRecorder()
	RegisterAPIHandler(rr, req)
	if rr.Code != http.StatusSeeOther || rr.Header().Get("Location") != "/login" {
		t.Fatalf("registration status=%d, want303", rr.Code)
	}
	if state.inserts != 1 || state.newEnabled || state.membershipUser != 901 || state.membershipGroup != 2 {
		t.Fatalf("not an ordinary disabled production account: %+v", state)
	}
	if state.passwordHash == "" || state.passwordHash == "test-only-strong-password-987!" || bcrypt.CompareHashAndPassword([]byte(state.passwordHash), []byte("test-only-strong-password-987!")) != nil {
		t.Fatal("password not bcrypt hashed")
	}
	if state.verification != "none" {
		t.Fatal("unexpected factor")
	}
	session, err := e_sessions.Store.Get(req, e_sessions.SessionName)
	if err != nil {
		t.Fatal(err)
	}
	for key, want := range validRegistrationAdminSession() {
		if session.Values[key] != want {
			t.Fatalf("administrator session field %v changed", key)
		}
	}
	if len(rr.Result().Cookies()) != 0 {
		t.Fatal("successful registration must not replace administrator cookie")
	}
	if registrationEnabledFunc() {
		t.Fatal("public signup policy changed")
	}
}
func TestClosedRegistrationRejectsUntrustedOrStaleAdministratorClaims(t *testing.T) {
	cases := []struct {
		name  string
		alter func(*registerAdminState, map[interface{}]interface{})
	}{
		{"anonymous", func(_ *registerAdminState, v map[interface{}]interface{}) {
			for k := range v {
				delete(v, k)
			}
		}},
		{"guest", func(_ *registerAdminState, v map[interface{}]interface{}) { v["user_id"] = 1 }},
		{"wrong_id_type", func(_ *registerAdminState, v map[interface{}]interface{}) { v["user_id"] = "42" }},
		{"not_authenticated", func(_ *registerAdminState, v map[interface{}]interface{}) { v["authenticated"] = false }},
		{"forged_admin_role", func(s *registerAdminState, _ map[interface{}]interface{}) { s.adminMember = false }},
		{"stale_generation", func(s *registerAdminState, _ map[interface{}]interface{}) { s.generation = 8 }},
		{"disabled", func(s *registerAdminState, _ map[interface{}]interface{}) { s.enabled = false }},
		{"admin_access_revoked", func(s *registerAdminState, _ map[interface{}]interface{}) { s.adminAllowed = false }},
		{"generation_read_failed", func(s *registerAdminState, _ map[interface{}]interface{}) {
			s.failQuery = "SELECT ur.authentication_generation"
		}},
		{"role_read_failed", func(s *registerAdminState, _ map[interface{}]interface{}) {
			s.failQuery = "SELECT 1 FROM system_user_group_memberships"
		}},
		{"admin_access_read_failed", func(s *registerAdminState, _ map[interface{}]interface{}) {
			s.failQuery = "SELECT COALESCE(admin_access_allowed, false)"
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			state := setupRegisterAdmin(t)
			values := validRegistrationAdminSession()
			tc.alter(state, values)
			rr := httptest.NewRecorder()
			RegisterAPIHandler(rr, registerAdminRequest(t, values, "test-csrf"))
			if rr.Code != http.StatusForbidden || state.inserts != 0 {
				t.Fatalf("status=%d inserts=%d", rr.Code, state.inserts)
			}
		})
	}
}
func TestClosedAdminRegistrationKeepsCSRFAndRateLimit(t *testing.T) {
	for _, limited := range []bool{false, true} {
		t.Run(fmt.Sprint(limited), func(t *testing.T) {
			state := setupRegisterAdmin(t)
			token := "wrong-token"
			want := http.StatusForbidden
			if limited {
				token = "test-csrf"
				want = http.StatusTooManyRequests
				authRateLimiter.Lock()
				authRateLimiter.attempts["192.0.2.42"] = &loginAttempt{count: loginRateLimitMax, windowStart: time.Now()}
				authRateLimiter.Unlock()
			}
			rr := httptest.NewRecorder()
			RegisterAPIHandler(rr, registerAdminRequest(t, validRegistrationAdminSession(), token))
			if rr.Code != want || state.inserts != 0 {
				t.Fatalf("status=%d want=%d inserts=%d", rr.Code, want, state.inserts)
			}
		})
	}
}
func TestClosedRegistrationGetStaysClosedForAdministrator(t *testing.T) {
	state := setupRegisterAdmin(t)
	req := registerAdminRequest(t, validRegistrationAdminSession(), "test-csrf")
	req.Method = http.MethodGet
	for _, handler := range []http.HandlerFunc{RegisterHandler, RegisterAPIHandler} {
		rr := httptest.NewRecorder()
		handler(rr, req)
		if rr.Code != http.StatusForbidden || state.inserts != 0 {
			t.Fatalf("GETstatus=%d inserts=%d", rr.Code, state.inserts)
		}
	}
}

func TestEnabledRegistrationStillAcceptsOrdinarySelfRegistration(t *testing.T) {
	state := setupRegisterAdmin(t)
	registrationEnabledFunc = func() bool { return true }
	req := registerAdminRequest(t, map[interface{}]interface{}{"csrf_token": "test-csrf"}, "test-csrf")
	rr := httptest.NewRecorder()
	RegisterAPIHandler(rr, req)
	if rr.Code != http.StatusSeeOther || state.inserts != 1 || state.membershipGroup != 2 || state.newEnabled {
		t.Fatalf("ordinary public signup changed: status=%d inserts=%d", rr.Code, state.inserts)
	}
	session, err := e_sessions.Store.Get(req, e_sessions.SessionName)
	if err != nil {
		t.Fatal(err)
	}
	if session.Values["authenticated"] == true || session.Values["user_id"] != nil {
		t.Fatal("registration must not authenticate or replace the caller")
	}
}

func TestClosedRegistrationIgnoresStaleBasicRoleWhenCurrentRoleIsAdmin(t *testing.T) {
	state := setupRegisterAdmin(t)
	values := validRegistrationAdminSession()
	values["user_role"] = "basic"
	req := registerAdminRequest(t, values, "test-csrf")
	rr := httptest.NewRecorder()
	RegisterAPIHandler(rr, req)
	if rr.Code != http.StatusSeeOther || state.inserts != 1 {
		t.Fatalf("current canonical role not used: status=%d", rr.Code)
	}
}

// TestNewAccountAutoEnableIsLocalDevelopmentOnly guards the narrowed
// auto-approval. A newly registered account used to be enabled automatically in
// every environment whose name was not literally "prod", so an unset, misspelled
// or staging value silently created usable accounts, and a development server
// reached over the network auto-approved strangers.
func TestNewAccountAutoEnableIsLocalDevelopmentOnly(t *testing.T) {
	cases := []struct {
		name            string
		environmentType string
		remoteAddr      string
		wantEnabled     bool
	}{
		{name: "local development", environmentType: "dev", remoteAddr: "127.0.0.1:1234", wantEnabled: true},
		{name: "local development ipv6", environmentType: "dev", remoteAddr: "[::1]:1234", wantEnabled: true},
		{name: "development server reached from the network", environmentType: "dev", remoteAddr: "203.0.113.5:1234", wantEnabled: false},
		{name: "environment name unset", environmentType: "", remoteAddr: "127.0.0.1:1234", wantEnabled: false},
		{name: "environment name misspelled", environmentType: "develop", remoteAddr: "127.0.0.1:1234", wantEnabled: false},
		{name: "staging", environmentType: "staging", remoteAddr: "127.0.0.1:1234", wantEnabled: false},
		{name: "production", environmentType: "prod", remoteAddr: "127.0.0.1:1234", wantEnabled: false},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			state := setupRegisterAdmin(t)
			registrationEnabledFunc = func() bool { return true }
			t.Setenv("ENVIRONMENT_TYPE", testCase.environmentType)
			req := registerAdminRequest(t, map[interface{}]interface{}{"csrf_token": "test-csrf"}, "test-csrf")
			req.RemoteAddr = testCase.remoteAddr
			rr := httptest.NewRecorder()

			RegisterAPIHandler(rr, req)

			if rr.Code != http.StatusSeeOther || state.inserts != 1 {
				t.Fatalf("registration did not complete: status=%d inserts=%d", rr.Code, state.inserts)
			}
			if state.newEnabled != testCase.wantEnabled {
				t.Fatalf("new account enabled = %v, want %v", state.newEnabled, testCase.wantEnabled)
			}
		})
	}
}
