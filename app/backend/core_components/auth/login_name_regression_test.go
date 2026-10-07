// login_name_regression_test.go
// Proves equal credential failures and private reset cookies without a database server.
// Bridges handler responses, password comparison and the central session serializer.
// Exists to catch enumeration and retired-key regressions before PostgreSQL integration runs.
package auth

import (
	backend "easelect/backend/core_components"
	e_sessions "easelect/backend/core_components/sessions"
	"github.com/gorilla/securecookie"
	"github.com/gorilla/sessions"
	"golang.org/x/crypto/bcrypt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLoginNameFailuresCompareOnceAndHaveEqualBodies(t *testing.T) {
	hash, _ := bcrypt.GenerateFromPassword([]byte("valid-password-123"), bcrypt.DefaultCost)
	oldConf := backend.DbConfidential
	originalCompare := compareLoginPassword
	t.Cleanup(func() { backend.DbConfidential = oldConf; compareLoginPassword = originalCompare })
	var first string
	for _, fixture := range []struct {
		name     string
		cfg      credentialMockConfig
		password string
	}{
		{"unknown", credentialMockConfig{}, "wrong"},
		{"disabled", credentialMockConfig{userLookupOK: true, userID: 42, disabled: true, hashedPassword: string(hash)}, "valid-password-123"},
		{"wrong password", credentialMockConfig{userLookupOK: true, userID: 42, hashedPassword: string(hash)}, "wrong"},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			backend.DbConfidential = openCredentialMockDB(t, fixture.cfg)
			comparisons := 0
			compareLoginPassword = func(hash, password []byte) error { comparisons++; return bcrypt.CompareHashAndPassword(hash, password) }
			r := httptest.NewRequest(http.MethodPost, "/api/login", nil)
			w := httptest.NewRecorder()
			session := &sessions.Session{Values: map[interface{}]interface{}{}}
			handleLoginCredentials(w, r, session, loginJSONRequest{Username: "private-login-canary", Password: fixture.password})
			if comparisons != 1 || w.Code != 401 || len(w.Result().Cookies()) != 0 {
				t.Fatalf("comparison/status/cookies=%d/%d/%d", comparisons, w.Code, len(w.Result().Cookies()))
			}
			if first == "" {
				first = w.Body.String()
			}
			if w.Body.String() != first {
				t.Fatalf("unequal body=%s", w.Body.String())
			}
		})
	}
}

func TestResetPendingCookieHasEqualLengthWithoutCookieEncryption(t *testing.T) {
	t.Setenv("SESSION_KEY", "reset-signing-secret-for-tests")
	store := prepareLoginHandlerSessionStore(t)
	var cookieLength int
	for _, id := range []int{0, 42, 1234567} {
		r := httptest.NewRequest("POST", "/api/request-password-reset-otp", nil)
		session, err := e_sessions.GetOrCreateSession(nil, r)
		if err != nil {
			t.Fatal(err)
		}
		session.Values["csrf_token"] = "fixed-csrf"
		session.Values["username"] = "retired-canary"
		// Loading an old cookie is what removes the retired keys; make that old cookie explicitly.
		encoded, err := securecookie.EncodeMulti(e_sessions.SessionName, session.Values, store.Codecs...)
		if err != nil {
			t.Fatal(err)
		}
		request := httptest.NewRequest("POST", "/api/request-password-reset-otp", nil)
		request.AddCookie(&http.Cookie{Name: e_sessions.SessionName, Value: encoded})
		loaded, err := e_sessions.Load(request)
		if err != nil {
			t.Fatal(err)
		}
		if err = setPendingPasswordResetState(loaded, id, int64(id)); err != nil {
			t.Fatal(err)
		}
		w := httptest.NewRecorder()
		if err = e_sessions.Save(w, request, loaded); err != nil {
			t.Fatal(err)
		}
		cookie := w.Result().Cookies()[0]
		if cookieLength == 0 {
			cookieLength = len(cookie.Value)
		}
		if len(cookie.Value) != cookieLength {
			t.Fatal("account existence changed cookie length")
		}
		check := httptest.NewRequest("GET", "/", nil)
		check.AddCookie(cookie)
		decoded, err := store.Get(check, e_sessions.SessionName)
		if err != nil {
			t.Fatal(err)
		}
		if _, exists := decoded.Values["username"]; exists {
			t.Fatal("retired name persisted")
		}
		pending := decoded.Values["password_reset_pending"].(string)
		if len(pending) != 70 || strings.Contains(pending, "canary") {
			t.Fatalf("pending=%q", pending)
		}
		opened, generation := e_sessions.OpenPasswordResetPending(pending)
		if opened != id || generation != int64(id) {
			t.Fatalf("reset state=%d/%d", opened, generation)
		}
	}
}
