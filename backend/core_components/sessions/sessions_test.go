// sessions_test.go
// Regression tests for session-store initialization, session recovery, and session-reset behavior.
// Covers the public helpers between Gorilla sessions, HTTP requests, and auth-cookie lifecycle so future refactors keep the session contract stable without requiring a database.
package e_sessions

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/sessions"
)

const (
	testSessionKey       = "12345678901234567890123456789012"
	testSessionSecretKey = "abcdefghijklmnopqrstuvwxyz123456"
)

func resetSessionTestGlobals() {
	Store = nil
	SessionName = "session"
}

func initSessionTestStore(t *testing.T) {
	t.Helper()
	resetSessionTestGlobals()
	t.Setenv("SESSION_KEY", testSessionKey)
	t.Setenv("SESSION_SECRET_KEY", testSessionSecretKey)
	InitSessionStore()
	t.Cleanup(resetSessionTestGlobals)
}

func newRequestWithSessionCookie(t *testing.T, mutate func(*http.Request, *sessions.Session)) *http.Request {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "https://example.com/protected", nil)
	rec := httptest.NewRecorder()
	session, err := Store.Get(req, SessionName)
	if err != nil {
		t.Fatalf("Store.Get returned error: %v", err)
	}
	mutate(req, session)
	if err := session.Save(req, rec); err != nil {
		t.Fatalf("session.Save returned error: %v", err)
	}
	for _, cookie := range rec.Result().Cookies() {
		req.AddCookie(cookie)
	}
	return req
}

func hasSetCookieContaining(values []string, want string) bool {
	for _, value := range values {
		if strings.Contains(value, want) {
			return true
		}
	}
	return false
}

func TestAllowInsecureDevProxy(t *testing.T) {
	tests := []struct {
		name  string
		value string
		want  bool
	}{
		{name: "empty", value: "", want: false},
		{name: "true", value: "true", want: true},
		{name: "numeric one", value: "1", want: true},
		{name: "yes mixed case", value: "Yes", want: true},
		{name: "on", value: "on", want: true},
		{name: "false", value: "false", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("ALLOW_INSECURE_DEV_PROXY", tt.value)
			if got := AllowInsecureDevProxy(); got != tt.want {
				t.Fatalf("AllowInsecureDevProxy() = %v, want %v", got, tt.want)
			}
			if got := ShouldUseSecureCookies(); got == tt.want {
				t.Fatalf("ShouldUseSecureCookies() = %v, expected inverse of %v", got, tt.want)
			}
		})
	}
}

func TestInitSessionStorePanicsWithoutSessionKey(t *testing.T) {
	resetSessionTestGlobals()
	t.Setenv("SESSION_KEY", "")
	t.Setenv("SESSION_SECRET_KEY", "")
	defer resetSessionTestGlobals()

	defer func() {
		if r := recover(); r == nil {
			t.Fatal("InitSessionStore() did not panic without SESSION_KEY")
		}
	}()

	InitSessionStore()
}

func TestInitSessionStoreSetsOptionsAndInstanceScopedSessionName(t *testing.T) {
	resetSessionTestGlobals()
	t.Setenv("SESSION_KEY", testSessionKey)
	t.Setenv("SESSION_SECRET_KEY", testSessionSecretKey)
	t.Setenv("INSTANCE_NAME", "demo name/with?chars")
	defer resetSessionTestGlobals()

	InitSessionStore()

	if Store == nil {
		t.Fatal("InitSessionStore() left Store nil")
	}
	if SessionName != "session_demo_name_with_chars" {
		t.Fatalf("SessionName = %q, want sanitized instance-specific name", SessionName)
	}
	if Store.Options == nil {
		t.Fatal("InitSessionStore() left Store.Options nil")
	}
	if !Store.Options.Secure {
		t.Fatal("Store.Options.Secure = false, want true by default")
	}
	if Store.Options.Path != "/" {
		t.Fatalf("Store.Options.Path = %q, want /", Store.Options.Path)
	}
	if Store.Options.SameSite != http.SameSiteLaxMode {
		t.Fatalf("Store.Options.SameSite = %v, want Lax", Store.Options.SameSite)
	}
}

func TestInitSessionStorePrefersExplicitSessionCookieName(t *testing.T) {
	resetSessionTestGlobals()
	t.Setenv("SESSION_KEY", testSessionKey)
	t.Setenv("SESSION_SECRET_KEY", testSessionSecretKey)
	t.Setenv("INSTANCE_NAME", "replica-a")
	t.Setenv("SESSION_COOKIE_NAME", "lb pool session")
	defer resetSessionTestGlobals()

	InitSessionStore()

	if SessionName != "lb_pool_session" {
		t.Fatalf("SessionName = %q, want explicit shared cookie name", SessionName)
	}
}

func TestGetOrCreateSessionReturnsExistingSessionValues(t *testing.T) {
	initSessionTestStore(t)

	req := newRequestWithSessionCookie(t, func(_ *http.Request, session *sessions.Session) {
		session.Values["user_id"] = 42
	})
	rec := httptest.NewRecorder()

	session, err := GetOrCreateSession(rec, req)
	if err != nil {
		t.Fatalf("GetOrCreateSession() returned error: %v", err)
	}
	if got := session.Values["user_id"]; got != 42 {
		t.Fatalf("session.Values[user_id] = %v, want 42", got)
	}
}

func TestGetOrCreateSessionClearsCorruptedCookie(t *testing.T) {
	resetSessionTestGlobals()
	oldStore := sessions.NewCookieStore([]byte("oldoldoldoldoldoldoldoldoldold12"))
	SessionName = "session"

	oldReq := httptest.NewRequest(http.MethodGet, "https://example.com/protected", nil)
	oldRec := httptest.NewRecorder()
	oldSession, err := oldStore.Get(oldReq, SessionName)
	if err != nil {
		t.Fatalf("oldStore.Get returned error: %v", err)
	}
	oldSession.Values["user_id"] = 7
	if err := oldSession.Save(oldReq, oldRec); err != nil {
		t.Fatalf("oldSession.Save returned error: %v", err)
	}

	t.Setenv("SESSION_KEY", testSessionKey)
	t.Setenv("SESSION_SECRET_KEY", testSessionSecretKey)
	InitSessionStore()
	t.Cleanup(resetSessionTestGlobals)

	req := httptest.NewRequest(http.MethodGet, "https://example.com/protected", nil)
	for _, cookie := range oldRec.Result().Cookies() {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()

	session, err := GetOrCreateSession(rec, req)
	if err != nil {
		t.Fatalf("GetOrCreateSession() returned error: %v", err)
	}
	if got := session.Values["user_id"]; got != nil {
		t.Fatalf("session.Values[user_id] = %v, want cleared value after securecookie error", got)
	}
	if !hasSetCookieContaining(rec.Header().Values("Set-Cookie"), "session=; Path=/; Max-Age=0") {
		t.Fatalf("Set-Cookie headers %v do not contain a clearing cookie", rec.Header().Values("Set-Cookie"))
	}
}

func TestGetUserIDFromSessionHandlesSuccessAndValidationErrors(t *testing.T) {
	initSessionTestStore(t)

	successReq := newRequestWithSessionCookie(t, func(_ *http.Request, session *sessions.Session) {
		session.Values["user_id"] = 99
	})
	userID, err := GetUserIDFromSession(successReq)
	if err != nil {
		t.Fatalf("GetUserIDFromSession() returned error: %v", err)
	}
	if userID != 99 {
		t.Fatalf("GetUserIDFromSession() = %d, want 99", userID)
	}

	missingReq := newRequestWithSessionCookie(t, func(_ *http.Request, session *sessions.Session) {})
	if _, err := GetUserIDFromSession(missingReq); err == nil || !strings.Contains(err.Error(), "user_id missing") {
		t.Fatalf("GetUserIDFromSession() missing user_id error = %v, want missing error", err)
	}

	wrongTypeReq := newRequestWithSessionCookie(t, func(_ *http.Request, session *sessions.Session) {
		session.Values["user_id"] = "99"
	})
	if _, err := GetUserIDFromSession(wrongTypeReq); err == nil || !strings.Contains(err.Error(), "not an int") {
		t.Fatalf("GetUserIDFromSession() wrong-type error = %v, want type error", err)
	}
}

func TestResetSessionHandlerRejectsInvalidRequests(t *testing.T) {
	initSessionTestStore(t)

	getReq := httptest.NewRequest(http.MethodGet, "https://example.com/api/reset-session", nil)
	getReq.Host = "example.com"
	getRec := httptest.NewRecorder()
	ResetSessionHandler(getRec, getReq)
	if getRec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET ResetSessionHandler status = %d, want 405", getRec.Code)
	}

	postReq := httptest.NewRequest(http.MethodPost, "https://example.com/api/reset-session", nil)
	postReq.Host = "example.com"
	postReq.Header.Set("Origin", "https://evil.example")
	postRec := httptest.NewRecorder()
	ResetSessionHandler(postRec, postReq)
	if postRec.Code != http.StatusForbidden {
		t.Fatalf("origin mismatch status = %d, want 403", postRec.Code)
	}
}

func TestResetSessionHandlerClearsAuthCookiesOnValidPost(t *testing.T) {
	initSessionTestStore(t)
	SessionName = "session_demo"

	req := httptest.NewRequest(http.MethodPost, "https://example.com/api/reset-session", nil)
	req.Host = "example.com"
	req.Header.Set("Origin", "https://example.com")
	req.AddCookie(&http.Cookie{Name: "session_demo", Value: "abc"})
	req.AddCookie(&http.Cookie{Name: "session_other", Value: "def"})
	req.AddCookie(&http.Cookie{Name: "device_id", Value: "dev"})
	req.AddCookie(&http.Cookie{Name: "fingerprint", Value: "fp"})
	rec := httptest.NewRecorder()

	ResetSessionHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("ResetSessionHandler status = %d, want 200", rec.Code)
	}

	setCookies := rec.Header().Values("Set-Cookie")
	for _, expected := range []string{
		"session_demo=;",
		"session=;",
		"session_other=;",
		"device_id=;",
		"fingerprint=;",
	} {
		if !hasSetCookieContaining(setCookies, expected) {
			t.Fatalf("Set-Cookie headers %v do not contain %q", setCookies, expected)
		}
	}
	if !strings.Contains(rec.Body.String(), `"success": true`) {
		t.Fatalf("response body = %q, want success json", rec.Body.String())
	}
}

func TestResetSessionHandlerAllowsHTTPOriginForInsecureDevProxy(t *testing.T) {
	initSessionTestStore(t)
	t.Setenv("ALLOW_INSECURE_DEV_PROXY", "true")

	req := httptest.NewRequest(http.MethodPost, "https://example.com/api/reset-session", nil)
	req.Host = "example.com"
	req.Header.Set("Origin", "http://192.168.1.20:8082")
	rec := httptest.NewRecorder()

	ResetSessionHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("ResetSessionHandler status = %d, want 200 when insecure dev proxy is enabled", rec.Code)
	}
}

func TestResetSessionHandlerAllowsLocalViteOriginInDev(t *testing.T) {
	initSessionTestStore(t)
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	t.Setenv("VITE_DEV_PORT", "5173")

	req := httptest.NewRequest(http.MethodPost, "https://localhost:8082/api/reset-session", nil)
	req.Host = "localhost:8082"
	req.Header.Set("Origin", "http://localhost:5173")
	rec := httptest.NewRecorder()

	ResetSessionHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("ResetSessionHandler status = %d, want 200 for local Vite dev origin", rec.Code)
	}
}

func TestResetSessionHandlerRejectsLocalViteOriginOutsideDev(t *testing.T) {
	initSessionTestStore(t)
	t.Setenv("ENVIRONMENT_TYPE", "prod")
	t.Setenv("VITE_DEV_PORT", "5173")

	req := httptest.NewRequest(http.MethodPost, "https://localhost:8082/api/reset-session", nil)
	req.Host = "localhost:8082"
	req.Header.Set("Origin", "http://localhost:5173")
	rec := httptest.NewRecorder()

	ResetSessionHandler(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("ResetSessionHandler status = %d, want 403 outside dev", rec.Code)
	}
}
