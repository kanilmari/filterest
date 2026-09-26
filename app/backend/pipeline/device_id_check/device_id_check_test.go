// device_id_check_test.go
// Verifies what a request gets when the browser's device binding is gone.
// Between a person who signed in long ago and the application that has to explain itself.
// Exists because this stage used to redirect a data request to the login page,
// which the browser followed to the application shell, so the caller received a
// web page with a success status and showed an interface with nothing in it.
// Uses no database and no network.
package device_id_check

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

var deviceTestKey = []byte("test-secret-key-32-bytes-padding!")

func setupTestStore(t *testing.T) *gorillaSessions.CookieStore {
	t.Helper()
	originalStore := e_sessions.Store
	originalName := e_sessions.SessionName
	testStore := gorillaSessions.NewCookieStore(deviceTestKey)
	testStore.Options = &gorillaSessions.Options{Path: "/", MaxAge: 3600, HttpOnly: true}
	e_sessions.Store = testStore
	e_sessions.SessionName = "session"
	t.Cleanup(func() {
		e_sessions.Store = originalStore
		e_sessions.SessionName = originalName
	})
	return testStore
}

func buildRequest(
	t *testing.T,
	store *gorillaSessions.CookieStore,
	target string,
	sessionValues map[any]any,
	deviceCookieValue string,
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
	if deviceCookieValue != "" {
		request.AddCookie(&http.Cookie{Name: e_sessions.DeviceIDCookieName(), Value: deviceCookieValue})
	}
	return request
}

func dataRequestHeaders(request *http.Request) *http.Request {
	request.Header.Set("Accept", "*/*")
	request.Header.Set("Sec-Fetch-Mode", "cors")
	return request
}

func noopHandler(called *bool) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		*called = true
		w.WriteHeader(http.StatusOK)
	}
}

func TestLostDeviceBindingTellsADataRequestTheSignInEnded(t *testing.T) {
	store := setupTestStore(t)
	request := dataRequestHeaders(buildRequest(t, store, "/api/user-permissions", map[any]any{
		"user_id":   42,
		"device_id": "the-device",
	}, ""))
	recorder := httptest.NewRecorder()
	called := false

	WithDeviceIDCheck(noopHandler(&called))(recorder, request)

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

func TestLostDeviceBindingSendsAPersonToTheLoginPage(t *testing.T) {
	store := setupTestStore(t)
	request := buildRequest(t, store, "/reports", map[any]any{
		"user_id":   42,
		"device_id": "the-device",
	}, "")
	request.Header.Set("Accept", "text/html,application/xhtml+xml")
	request.Header.Set("Sec-Fetch-Mode", "navigate")
	recorder := httptest.NewRecorder()
	called := false

	WithDeviceIDCheck(noopHandler(&called))(recorder, request)

	location := recorder.Header().Get("Location")
	if called || recorder.Code != http.StatusSeeOther || !strings.HasPrefix(location, "/login?") {
		t.Fatalf("page navigation result: called=%v status=%d Location=%q", called, recorder.Code, location)
	}
	if !strings.Contains(location, session_expiry.AuthNoticeParameter+"="+session_expiry.SessionEndedNotice) {
		t.Fatalf("the login page is not told to explain itself: %q", location)
	}
}

func TestASignedOutVisitorPassesThroughUntouched(t *testing.T) {
	store := setupTestStore(t)
	request := dataRequestHeaders(buildRequest(t, store, "/api/datasets", map[any]any{"user_id": 1}, ""))
	recorder := httptest.NewRecorder()
	called := false

	WithDeviceIDCheck(noopHandler(&called))(recorder, request)

	if !called || recorder.Code != http.StatusOK {
		t.Fatalf("a signed-out visitor was stopped: called=%v status=%d", called, recorder.Code)
	}
}

func TestAMatchingDeviceBindingPassesThrough(t *testing.T) {
	store := setupTestStore(t)
	request := dataRequestHeaders(buildRequest(t, store, "/api/user-permissions", map[any]any{
		"user_id":   42,
		"device_id": "the-device",
	}, "the-device"))
	recorder := httptest.NewRecorder()
	called := false

	WithDeviceIDCheck(noopHandler(&called))(recorder, request)

	if !called || recorder.Code != http.StatusOK {
		t.Fatalf("a valid binding was rejected: called=%v status=%d", called, recorder.Code)
	}
	// This request proved its device but never presented a fingerprint, so the
	// stage passes it on and renews nothing: a renewal that wrote here would hand
	// back a fingerprint the request did not carry.
	if cookies := recorder.Result().Cookies(); len(cookies) != 0 {
		t.Fatalf("a request that never proved its fingerprint was handed %d cookie(s)", len(cookies))
	}
}

// A request that has proved both bindings has used its sign-in, and this is the
// stage that says so: all three cookies leave renewed, with the session's own
// values and the one lifetime a sign-in writes.
func TestAProvedBindingRenewsAllThreeSignInCookies(t *testing.T) {
	store := setupTestStore(t)
	store.Options = e_sessions.SessionCookieOptions()
	request := dataRequestHeaders(buildRequest(t, store, "/api/user-permissions", map[any]any{
		"user_id":          42,
		"device_id":        "the-device",
		"fingerprint_hash": "the-fingerprint",
	}, "the-device"))
	request.AddCookie(&http.Cookie{Name: e_sessions.FingerprintCookieName(), Value: "the-fingerprint"})
	recorder := httptest.NewRecorder()
	called := false

	WithDeviceIDCheck(noopHandler(&called))(recorder, request)

	if !called || recorder.Code != http.StatusOK {
		t.Fatalf("a valid binding was rejected: called=%v status=%d", called, recorder.Code)
	}
	renewed := map[string]*http.Cookie{}
	for _, cookie := range recorder.Result().Cookies() {
		renewed[cookie.Name] = cookie
	}
	wantMaxAge := int(e_sessions.SignInLifetime.Seconds())
	for name, wantValue := range map[string]string{
		e_sessions.DeviceIDCookieName():    "the-device",
		e_sessions.FingerprintCookieName(): "the-fingerprint",
	} {
		cookie, present := renewed[name]
		if !present {
			t.Fatalf("%q was not renewed", name)
		}
		if cookie.Value != wantValue || cookie.MaxAge != wantMaxAge {
			t.Fatalf("%q renewed as %q for %d seconds, want %q for %d", name, cookie.Value, cookie.MaxAge, wantValue, wantMaxAge)
		}
	}
	if cookie, present := renewed[e_sessions.SessionName]; !present || cookie.MaxAge != wantMaxAge {
		t.Fatalf("the session was not renewed with the sign-in lifetime: %#v", cookie)
	}
}
