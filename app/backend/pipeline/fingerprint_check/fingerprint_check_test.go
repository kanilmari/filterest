// fingerprint_check_test.go
// Verifies what a request gets when the browser's fingerprint binding is gone.
// Between a person who signed in long ago and the application that has to explain itself.
// Exists because this stage used to redirect a data request to the login page,
// which the browser followed to the application shell, so the caller received a
// web page with a success status and showed an interface with nothing in it.
// Uses no database and no network.
package fingerprint_check

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"easelect/backend/core_components/session_expiry"
	e_sessions "easelect/backend/core_components/sessions"

	gorillaSessions "github.com/gorilla/sessions"
)

var fingerprintTestKey = []byte("test-secret-key-32-bytes-padding!")

func setupTestStore(t *testing.T) *gorillaSessions.CookieStore {
	t.Helper()
	originalStore := e_sessions.Store
	originalName := e_sessions.SessionName
	testStore := gorillaSessions.NewCookieStore(fingerprintTestKey)
	testStore.Options = &gorillaSessions.Options{Path: "/", MaxAge: 3600, HttpOnly: true}
	e_sessions.Store = testStore
	e_sessions.SessionName = "session"
	t.Cleanup(func() {
		e_sessions.Store = originalStore
		e_sessions.SessionName = originalName
	})
	return testStore
}

// buildRequest creates a request carrying a saved session, and optionally the
// browser's fingerprint cookie beside it.
func buildRequest(
	t *testing.T,
	store *gorillaSessions.CookieStore,
	target string,
	sessionValues map[any]any,
	fingerprintCookieValue string,
) *http.Request {
	t.Helper()
	cookieRecorder := httptest.NewRecorder()
	cookieRequest := httptest.NewRequest(http.MethodGet, target, nil)
	session, err := store.Get(cookieRequest, e_sessions.SessionName)
	if err != nil {
		t.Fatalf("setup: store.Get: %v", err)
	}
	for key, value := range sessionValues {
		session.Values[key] = value
	}
	if err := session.Save(cookieRequest, cookieRecorder); err != nil {
		t.Fatalf("setup: session.Save: %v", err)
	}

	request := httptest.NewRequest(http.MethodGet, target, nil)
	for _, cookie := range cookieRecorder.Result().Cookies() {
		request.AddCookie(cookie)
	}
	if fingerprintCookieValue != "" {
		request.AddCookie(&http.Cookie{Name: e_sessions.FingerprintCookieName(), Value: fingerprintCookieValue})
	}
	return request
}

func dataRequestHeaders(request *http.Request) *http.Request {
	request.Header.Set("Accept", "*/*")
	request.Header.Set("Sec-Fetch-Mode", "cors")
	return request
}

func pageRequestHeaders(request *http.Request) *http.Request {
	request.Header.Set("Accept", "text/html,application/xhtml+xml")
	request.Header.Set("Sec-Fetch-Mode", "navigate")
	return request
}

func noopHandler(called *bool) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		*called = true
		w.WriteHeader(http.StatusOK)
	}
}

// The reported failure, at the level of one request: the person's fingerprint
// cookie expired while the session cookie was still readable, and the request
// for their rights was answered with a page instead of an answer it could read.
func TestLostFingerprintBindingTellsADataRequestTheSignInEnded(t *testing.T) {
	store := setupTestStore(t)
	request := dataRequestHeaders(buildRequest(t, store, "/api/user-permissions", map[any]any{
		"user_id":          42,
		"fingerprint_hash": "the-signed-value",
	}, ""))
	recorder := httptest.NewRecorder()
	called := false

	WithFingerprintCheck(noopHandler(&called))(recorder, request)

	if called {
		t.Fatal("the handler ran although the browser binding was gone")
	}
	if recorder.Code == http.StatusSeeOther {
		t.Fatalf("the data request was sent to %q instead of being told the sign-in ended",
			recorder.Header().Get("Location"))
	}
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status: got %d, want %d", recorder.Code, http.StatusForbidden)
	}
	var body map[string]any
	if err := json.NewDecoder(recorder.Body).Decode(&body); err != nil {
		t.Fatalf("decode answer: %v", err)
	}
	if body["auth_failure"] != true {
		t.Fatalf("the answer does not say the sign-in ended: %#v", body)
	}
}

func TestLostFingerprintBindingSendsAPersonToTheLoginPage(t *testing.T) {
	store := setupTestStore(t)
	request := pageRequestHeaders(buildRequest(t, store, "/reports", map[any]any{
		"user_id":          42,
		"fingerprint_hash": "the-signed-value",
	}, ""))
	recorder := httptest.NewRecorder()
	called := false

	WithFingerprintCheck(noopHandler(&called))(recorder, request)

	if called {
		t.Fatal("the handler ran although the browser binding was gone")
	}
	location := recorder.Header().Get("Location")
	if recorder.Code != http.StatusSeeOther || !strings.HasPrefix(location, "/login?") {
		t.Fatalf("page navigation result: status %d, Location %q", recorder.Code, location)
	}
	if !strings.Contains(location, session_expiry.AuthNoticeParameter+"="+session_expiry.SessionEndedNotice) {
		t.Fatalf("the login page is not told to explain itself: %q", location)
	}
}

func TestMismatchedFingerprintTellsADataRequestTheSignInEnded(t *testing.T) {
	store := setupTestStore(t)
	request := dataRequestHeaders(buildRequest(t, store, "/api/user-permissions", map[any]any{
		"user_id":          42,
		"fingerprint_hash": "the-signed-value",
	}, "a-different-value"))
	recorder := httptest.NewRecorder()
	called := false

	WithFingerprintCheck(noopHandler(&called))(recorder, request)

	if called || recorder.Code != http.StatusForbidden {
		t.Fatalf("mismatch result: called=%v status=%d", called, recorder.Code)
	}
}

// A visitor who never signed in must keep browsing exactly as before.
func TestASignedOutVisitorPassesThroughUntouched(t *testing.T) {
	store := setupTestStore(t)
	request := dataRequestHeaders(buildRequest(t, store, "/api/datasets", map[any]any{"user_id": 1}, ""))
	recorder := httptest.NewRecorder()
	called := false

	WithFingerprintCheck(noopHandler(&called))(recorder, request)

	if !called || recorder.Code != http.StatusOK {
		t.Fatalf("a signed-out visitor was stopped: called=%v status=%d", called, recorder.Code)
	}
}

func TestAMatchingFingerprintPassesThrough(t *testing.T) {
	store := setupTestStore(t)
	request := dataRequestHeaders(buildRequest(t, store, "/api/user-permissions", map[any]any{
		"user_id":          42,
		"fingerprint_hash": "the-signed-value",
	}, "the-signed-value"))
	recorder := httptest.NewRecorder()
	called := false

	WithFingerprintCheck(noopHandler(&called))(recorder, request)

	if !called || recorder.Code != http.StatusOK {
		t.Fatalf("a valid binding was rejected: called=%v status=%d", called, recorder.Code)
	}
}
