// password_reset_handler_test.go
// Covers the login-surface password reset handlers with focused session and DB mocks.
// Bridges the unauthenticated auth endpoints and the reusable password reset helpers.
// Exists to keep the forgot-password slice working without a live database or server.

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

	backend "easelect/backend/core_components"
	e_sessions "easelect/backend/core_components/sessions"

	"github.com/gorilla/sessions"
)

type passwordResetMockConfig struct {
	userLookupFound bool
	userID          int
	execOK          bool
}

type passwordResetMockDriver struct{ cfg passwordResetMockConfig }
type passwordResetMockConn struct{ cfg passwordResetMockConfig }
type passwordResetMockRows struct {
	cols []string
	vals []driver.Value
	done bool
}

var passwordResetDriverCounter atomic.Int64

func (d *passwordResetMockDriver) Open(_ string) (driver.Conn, error) {
	return &passwordResetMockConn{cfg: d.cfg}, nil
}
func (c *passwordResetMockConn) Prepare(_ string) (driver.Stmt, error) {
	return nil, fmt.Errorf("prepare not supported")
}
func (c *passwordResetMockConn) Close() error { return nil }
func (c *passwordResetMockConn) Begin() (driver.Tx, error) {
	return nil, fmt.Errorf("transactions not supported")
}
func (r *passwordResetMockRows) Columns() []string { return r.cols }
func (r *passwordResetMockRows) Close() error      { return nil }
func (r *passwordResetMockRows) Next(dest []driver.Value) error {
	if r.done {
		return io.EOF
	}
	r.done = true
	copy(dest, r.vals)
	return nil
}

func (c *passwordResetMockConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	switch {
	case strings.Contains(query, "FROM system_users WHERE LOWER(username)"):
		if !c.cfg.userLookupFound {
			return &passwordResetMockRows{cols: []string{"id"}, done: true}, nil
		}
		return &passwordResetMockRows{cols: []string{"id"}, vals: []driver.Value{int64(c.cfg.userID)}}, nil
	default:
		return &passwordResetMockRows{cols: []string{"value"}, done: true}, nil
	}
}

func (c *passwordResetMockConn) Query(query string, args []driver.Value) (driver.Rows, error) {
	named := make([]driver.NamedValue, len(args))
	for i, arg := range args {
		named[i] = driver.NamedValue{Ordinal: i + 1, Value: arg}
	}
	return c.QueryContext(context.Background(), query, named)
}

func (c *passwordResetMockConn) ExecContext(_ context.Context, _ string, _ []driver.NamedValue) (driver.Result, error) {
	if !c.cfg.execOK {
		return nil, fmt.Errorf("exec disabled")
	}
	return driver.RowsAffected(1), nil
}

func openPasswordResetMockDB(t *testing.T, cfg passwordResetMockConfig) *sql.DB {
	t.Helper()
	name := fmt.Sprintf("password_reset_%d", passwordResetDriverCounter.Add(1))
	sql.Register(name, &passwordResetMockDriver{cfg: cfg})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatalf("sql.Open mock: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})
	return db
}

func decodeAuthJSONBody(t *testing.T, rr *httptest.ResponseRecorder) map[string]interface{} {
	t.Helper()
	var payload map[string]interface{}
	if err := json.NewDecoder(rr.Body).Decode(&payload); err != nil {
		t.Fatalf("decode json body: %v", err)
	}
	return payload
}

func initTestSessionStore() {
	e_sessions.Store = sessions.NewCookieStore([]byte("0123456789abcdef0123456789abcdef"))
	e_sessions.Store.Options = &sessions.Options{
		Path:     "/",
		MaxAge:   86400,
		HttpOnly: true,
		Secure:   false,
		SameSite: http.SameSiteLaxMode,
	}
	e_sessions.SessionName = "session"
}

func seedSessionCookie(t *testing.T, values map[interface{}]interface{}) *http.Cookie {
	t.Helper()
	initTestSessionStore()
	req := httptest.NewRequest(http.MethodGet, "/login", nil)
	rr := httptest.NewRecorder()
	session, err := e_sessions.GetOrCreateSession(rr, req)
	if err != nil {
		t.Fatalf("GetOrCreateSession: %v", err)
	}
	for key, value := range values {
		session.Values[key] = value
	}
	if err := saveSession(rr, req, session); err != nil {
		t.Fatalf("saveSession: %v", err)
	}
	result := rr.Result()
	if len(result.Cookies()) == 0 {
		t.Fatal("expected seeded session cookie")
	}
	return result.Cookies()[0]
}

func TestRequestPasswordResetOTPHandler_UnknownIdentifierStillReturnsGenericSuccess(t *testing.T) {
	origDB := backend.Db
	origConf := backend.DbConfidential
	backend.Db = openPasswordResetMockDB(t, passwordResetMockConfig{userLookupFound: false})
	backend.DbConfidential = openPasswordResetMockDB(t, passwordResetMockConfig{})
	t.Cleanup(func() {
		backend.Db = origDB
		backend.DbConfidential = origConf
	})

	cookie := seedSessionCookie(t, map[interface{}]interface{}{"csrf_token": "csrf-123"})
	req := httptest.NewRequest(http.MethodPost, "/api/request-password-reset-otp", strings.NewReader(`{"identifier":"ghost-user","csrf_token":"csrf-123"}`))
	req.AddCookie(cookie)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	RequestPasswordResetOTPHandler(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d, want %d", rr.Code, http.StatusOK)
	}
	body := decodeAuthJSONBody(t, rr)
	if body["password_reset_requested"] != true {
		t.Fatalf("unexpected body: %#v", body)
	}
}

func TestResetPasswordWithOTPHandler_DoesNotAcceptLegacyStaticCode(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	t.Setenv("LOGIN_OTP_CODE", "334726")
	t.Setenv("POSTMARK_API_KEY", "")

	origConf := backend.DbConfidential
	backend.DbConfidential = openPasswordResetMockDB(t, passwordResetMockConfig{execOK: true})
	t.Cleanup(func() {
		backend.DbConfidential = origConf
	})

	cookie := seedSessionCookie(t, map[interface{}]interface{}{
		"csrf_token":                     "csrf-456",
		"password_reset_pending_user_id": 77,
	})
	req := httptest.NewRequest(http.MethodPost, "/api/reset-password", strings.NewReader(`{"otp_code":"334726","new_password":"new-secret","csrf_token":"csrf-456"}`))
	req.AddCookie(cookie)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	ResetPasswordWithOTPHandler(rr, req)

	if rr.Code == http.StatusOK {
		t.Fatalf("legacy LOGIN_OTP_CODE must not reset a password without an email challenge: %#v", decodeAuthJSONBody(t, rr))
	}
}
