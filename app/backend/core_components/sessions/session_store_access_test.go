// session_store_access_test.go
// Proves what Load and Save promise: no retired key survives a load or the next write, and a write keeps
// the session's own options and names its caller when it fails.
// Between the sessions package and the Gorilla cookie store it wraps.
// Exists because every handler now relies on these two functions for what a written cookie contains.
package e_sessions

import (
	"bytes"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/sessions"
)

func useTestSessionStore(t *testing.T) *sessions.CookieStore {
	t.Helper()
	originalStore, originalName := Store, SessionName
	store := sessions.NewCookieStore([]byte("load-save-test-signing-key-32byte"))
	store.Options = &sessions.Options{Path: "/", MaxAge: 3600, HttpOnly: true}
	Store, SessionName = store, "session"
	t.Cleanup(func() { Store, SessionName = originalStore, originalName })
	return store
}

// sessionCookieWith writes a session cookie the way an earlier release would have.
func sessionCookieWith(t *testing.T, store *sessions.CookieStore, values map[interface{}]interface{}) *http.Cookie {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	session, err := store.New(request, "session")
	if err != nil {
		t.Fatalf("new session: %v", err)
	}
	for key, value := range values {
		session.Values[key] = value
	}
	recorder := httptest.NewRecorder()
	if err := store.Save(request, recorder, session); err != nil {
		t.Fatalf("seed session cookie: %v", err)
	}
	return recorder.Result().Cookies()[0]
}

// writtenSessionValues decodes the session cookie a response sets.
func writtenSessionValues(t *testing.T, store *sessions.CookieStore, recorder *httptest.ResponseRecorder) map[interface{}]interface{} {
	t.Helper()
	for _, cookie := range recorder.Result().Cookies() {
		if cookie.Name != "session" {
			continue
		}
		request := httptest.NewRequest(http.MethodGet, "/", nil)
		request.AddCookie(cookie)
		decoded, err := store.Get(request, "session")
		if err != nil {
			t.Fatalf("decode written session: %v", err)
		}
		return decoded.Values
	}
	t.Fatal("the response wrote no session cookie")
	return nil
}

func TestLoadDropsRetiredKeysAndTheNextWriteLeavesThemOut(t *testing.T) {
	store := useTestSessionStore(t)
	cookie := sessionCookieWith(t, store, map[interface{}]interface{}{
		"user_id":              42,
		"username":             "old-login-name",
		"otp_pending_username": "old-login-name",
		"csrf_token":           "token",
	})
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.AddCookie(cookie)

	session, err := Load(request)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	for _, key := range RetiredSessionKeys {
		if _, present := session.Values[key]; present {
			t.Fatalf("Load kept the retired key %q", key)
		}
	}
	if session.Values["user_id"] != 42 || session.Values["csrf_token"] != "token" {
		t.Fatalf("Load lost values it should keep: %#v", session.Values)
	}
	if again, _ := Load(request); again != session {
		t.Fatal("a second load in the same request returned a different session")
	}

	recorder := httptest.NewRecorder()
	if err := Save(recorder, request, session); err != nil {
		t.Fatalf("Save: %v", err)
	}
	written := writtenSessionValues(t, store, recorder)
	for _, key := range RetiredSessionKeys {
		if _, present := written[key]; present {
			t.Fatalf("the next write carried the retired key %q again", key)
		}
	}
	if written["user_id"] != 42 {
		t.Fatalf("the next write lost the user: %#v", written)
	}
}

func TestSaveKeepsTheSessionsOwnOptions(t *testing.T) {
	useTestSessionStore(t)
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	session, err := Load(request)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	// A sign-out deletes the cookie by its own options; Save must not reset them.
	session.Options.MaxAge = -1
	recorder := httptest.NewRecorder()
	if err := Save(recorder, request, session); err != nil {
		t.Fatalf("Save: %v", err)
	}
	cookie := recorder.Result().Cookies()[0]
	if cookie.MaxAge >= 0 {
		t.Fatalf("the deletion was written as a cookie that lives (Max-Age %d)", cookie.MaxAge)
	}
	if cookie.Secure != ShouldUseSecureCookies() {
		t.Fatalf("Secure = %v, want %v", cookie.Secure, ShouldUseSecureCookies())
	}
	if session.Options.MaxAge != -1 || session.Options.Secure {
		t.Fatalf("Save left the session's options changed: %+v", *session.Options)
	}
}

func TestSaveNamesItsCallerWhenTheWriteFails(t *testing.T) {
	useTestSessionStore(t)
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	session, err := Load(request)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	// The cookie codec refuses a value this long, so the write fails.
	session.Values["oversized"] = strings.Repeat("x", 8192)

	var output bytes.Buffer
	originalOutput := log.Writer()
	log.SetOutput(&output)
	t.Cleanup(func() { log.SetOutput(originalOutput) })

	if err := Save(httptest.NewRecorder(), request, session); err == nil {
		t.Fatal("an oversized session was written")
	}
	if !strings.Contains(output.String(), "TestSaveNamesItsCallerWhenTheWriteFails") {
		t.Fatalf("the failure does not name its caller: %q", output.String())
	}
}
