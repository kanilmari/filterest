// session_binding_renewal_test.go
// Verifies that a person who keeps using the site keeps all three cookies that carry their sign-in.
// Between the two authentication stages that compare the browser binding, the renewal they share,
// and the browser that holds the cookies.
// Exists because the session and its two bindings used to renew on different rhythms — first the
// bindings lapsed under a live session, then the session lapsed under live bindings — so a regular
// visitor was signed out by whichever cookie happened to run out first. Uses no database and no network.
package pipeline_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	e_sessions "easelect/backend/core_components/sessions"
	"easelect/backend/pipeline"
	"easelect/backend/pipeline/device_id_check"
	"easelect/backend/pipeline/fingerprint_check"

	gorillaSessions "github.com/gorilla/sessions"
)

const (
	bindingTestUserID      = 42
	bindingTestFingerprint = "the-signed-fingerprint-value"
	bindingTestDeviceID    = "the-signed-device-value"
)

var bindingTestSessionKey = []byte("test-secret-key-32-bytes-padding!")

// heldCookie is one cookie as a browser holds it: a value plus the moment it
// runs out. A zero moment means the browser keeps it until it is closed.
type heldCookie struct {
	value   string
	expires time.Time
}

// browserCookieJar keeps what a browser would still be holding at a given
// moment. A cookie the server gave a lifetime to disappears once that lifetime
// has run out, which is exactly how a person loses a binding without noticing.
// The lifetime is counted from the response that carried it, not from this
// machine's clock, so a test can walk a browser through several days.
type browserCookieJar struct {
	held map[string]heldCookie
}

func newBrowserCookieJar() *browserCookieJar {
	return &browserCookieJar{held: map[string]heldCookie{}}
}

// store records what a response told the browser to keep. When one response
// names the same cookie twice, the last word wins, as it does in a browser.
func (jar *browserCookieJar) store(recorder *httptest.ResponseRecorder, now time.Time) {
	for _, cookie := range recorder.Result().Cookies() {
		if cookie.MaxAge < 0 || cookie.Value == "" {
			delete(jar.held, cookie.Name)
			continue
		}
		entry := heldCookie{value: cookie.Value}
		if cookie.MaxAge > 0 {
			entry.expires = now.Add(time.Duration(cookie.MaxAge) * time.Second)
		}
		jar.held[cookie.Name] = entry
	}
}

// attach sends along only the cookies that have not run out by now, dropping
// the rest for good, exactly as a browser does.
func (jar *browserCookieJar) attach(request *http.Request, now time.Time) {
	for name, held := range jar.held {
		if !held.expires.IsZero() && !now.Before(held.expires) {
			delete(jar.held, name)
			continue
		}
		request.AddCookie(&http.Cookie{Name: name, Value: held.value})
	}
}

func (jar *browserCookieJar) holds(name string, now time.Time) bool {
	held, present := jar.held[name]
	if !present {
		return false
	}
	return held.expires.IsZero() || now.Before(held.expires)
}

// expiry reports the moment the browser will drop the named cookie.
func (jar *browserCookieJar) expiry(name string) time.Time {
	return jar.held[name].expires
}

// signInCookieNames are the three cookies that together carry a sign-in.
func signInCookieNames() []string {
	return []string{
		e_sessions.SessionName,
		e_sessions.DeviceIDCookieName(),
		e_sessions.FingerprintCookieName(),
	}
}

// useTestSessionStore installs a cookie store with the runtime's own session
// cookie options and no database behind it.
func useTestSessionStore(t *testing.T) *gorillaSessions.CookieStore {
	t.Helper()
	originalStore := e_sessions.Store
	originalName := e_sessions.SessionName
	store := gorillaSessions.NewCookieStore(bindingTestSessionKey)
	store.Options = e_sessions.SessionCookieOptions()
	e_sessions.Store = store
	e_sessions.SessionName = "session"
	t.Cleanup(func() {
		e_sessions.Store = originalStore
		e_sessions.SessionName = originalName
	})
	return store
}

// signIn writes the three cookies a completed sign-in writes: the session and
// the two bindings that tie it to this one browser.
func signIn(t *testing.T, store *gorillaSessions.CookieStore, jar *browserCookieJar, now time.Time) {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/api/login", nil)
	recorder := httptest.NewRecorder()
	session, err := store.Get(request, e_sessions.SessionName)
	if err != nil {
		t.Fatalf("sign-in: store.Get: %v", err)
	}
	session.Values["user_id"] = bindingTestUserID
	session.Values["fingerprint_hash"] = bindingTestFingerprint
	session.Values["device_id"] = bindingTestDeviceID
	if err := session.Save(request, recorder); err != nil {
		t.Fatalf("sign-in: session.Save: %v", err)
	}
	e_sessions.SetFingerprintCookie(recorder, bindingTestFingerprint)
	e_sessions.SetDeviceIDCookie(recorder, bindingTestDeviceID)
	jar.store(recorder, now)
}

// refreshSession models a full page load: auth.GetAuthModesHandler writes the
// session on every call, and that write alone restarts the session cookie's
// lifetime. It is the only ordinary request that did so before the shared renewal.
func refreshSession(t *testing.T, store *gorillaSessions.CookieStore, jar *browserCookieJar, now time.Time) {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, "/api/auth-modes", nil)
	jar.attach(request, now)
	recorder := httptest.NewRecorder()
	session, err := store.Get(request, e_sessions.SessionName)
	if err != nil {
		t.Fatalf("session refresh: store.Get: %v", err)
	}
	if session.IsNew {
		t.Fatal("session refresh: the browser no longer carried a readable session")
	}
	if err := session.Save(request, recorder); err != nil {
		t.Fatalf("session refresh: session.Save: %v", err)
	}
	jar.store(recorder, now)
}

// visitProtectedRoute sends one ordinary request for data — what an
// in-application tab switch makes — through both binding stages in the order
// PipelineOrder wires them, lets the browser keep whatever the answer handed
// back, and reports the identity the request acted as at the handler: zero when
// it never got there, or when the browser no longer carried a readable session.
func visitProtectedRoute(t *testing.T, jar *browserCookieJar, now time.Time) (int, *httptest.ResponseRecorder) {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, "/api/user-permissions", nil)
	request.Header.Set("Accept", "*/*")
	request.Header.Set("Sec-Fetch-Mode", "cors")
	jar.attach(request, now)

	recorder := httptest.NewRecorder()
	actedAs := 0
	handler := fingerprint_check.WithFingerprintCheck(
		device_id_check.WithDeviceIDCheck(func(w http.ResponseWriter, r *http.Request) {
			if session, err := e_sessions.GetOrCreateSession(w, r); err == nil {
				actedAs, _ = session.Values["user_id"].(int)
			}
			w.WriteHeader(http.StatusOK)
		}),
	)
	handler(recorder, request)
	jar.store(recorder, now)
	return actedAs, recorder
}

// assertSignInCookiesRunOutTogether checks that the browser holds all three
// sign-in cookies and that they will run out at one and the same moment, a full
// lifetime after the visit that renewed them.
func assertSignInCookiesRunOutTogether(t *testing.T, jar *browserCookieJar, visitedAt time.Time) {
	t.Helper()
	want := visitedAt.Add(e_sessions.SignInLifetime)
	for _, name := range signInCookieNames() {
		if !jar.holds(name, visitedAt) {
			t.Fatalf("after the visit at %s the browser no longer holds %q", visitedAt.Format(time.RFC3339), name)
		}
		if got := jar.expiry(name); !got.Equal(want) {
			t.Fatalf("after the visit at %s, %q runs out at %s; the other two run out at %s, and all three must move together",
				visitedAt.Format(time.RFC3339), name, got.Format(time.RFC3339), want.Format(time.RFC3339))
		}
	}
}

// The owner's observation, at the level of one browser. Someone who uses the
// site every day but only ever inside the application — requests for data, never
// a full page load — must stay signed in past the seven days their session was
// given at sign-in, with all three cookies running out at the same moment.
// Before the shared renewal the two bindings moved on every such request while
// the session moved only when a page load wrote it, so this browser was signed
// out on day eight. On that code this fails on day one already: the session
// cookie did not move with the bindings.
func TestAPersonWhoOnlyNavigatesInsideTheApplicationStaysSignedIn(t *testing.T) {
	store := useTestSessionStore(t)
	jar := newBrowserCookieJar()

	signedInAt := time.Date(2026, 3, 1, 9, 0, 0, 0, time.UTC)
	signIn(t, store, jar, signedInAt)

	for day := 1; day <= 10; day++ {
		visitedAt := signedInAt.Add(time.Duration(day) * 24 * time.Hour)
		actedAs, recorder := visitProtectedRoute(t, jar, visitedAt)
		if actedAs != bindingTestUserID {
			t.Fatalf("on day %d the person was no longer signed in (the request acted as %d): status %d, body %s",
				day, actedAs, recorder.Code, recorder.Body.String())
		}
		assertSignInCookiesRunOutTogether(t, jar, visitedAt)
	}
}

// The earlier repair's journey, kept: a page load on day three, then nothing but
// in-application use until day eight, past the seven days the bindings were
// given at sign-in.
func TestAnActivePersonStaysSignedInPastTheOriginalBindingLifetime(t *testing.T) {
	store := useTestSessionStore(t)
	jar := newBrowserCookieJar()

	signedInAt := time.Date(2026, 3, 1, 9, 0, 0, 0, time.UTC)
	signIn(t, store, jar, signedInAt)

	dayThree := signedInAt.Add(3 * 24 * time.Hour)
	refreshSession(t, store, jar, dayThree)
	if actedAs, recorder := visitProtectedRoute(t, jar, dayThree); actedAs != bindingTestUserID {
		t.Fatalf("the person was stopped on day three: acted as %d, status %d, body %s", actedAs, recorder.Code, recorder.Body.String())
	}

	dayEight := signedInAt.Add(8 * 24 * time.Hour)
	actedAs, recorder := visitProtectedRoute(t, jar, dayEight)
	if actedAs != bindingTestUserID {
		t.Fatalf("a person who kept using the site was signed out on day eight: acted as %d, status %d, body %s",
			actedAs, recorder.Code, recorder.Body.String())
	}
	if recorder.Code != http.StatusOK {
		t.Fatalf("day eight status: got %d, want %d", recorder.Code, http.StatusOK)
	}
}

// Renewal follows use, not the calendar: a browser that stops visiting keeps
// nothing. The two stages' own tests then cover what such a browser is told
// when it comes back with a session but no binding.
func TestAnIdleBrowserLosesAllThreeCookiesBecauseNothingRenewedThem(t *testing.T) {
	store := useTestSessionStore(t)
	jar := newBrowserCookieJar()

	signedInAt := time.Date(2026, 3, 1, 9, 0, 0, 0, time.UTC)
	signIn(t, store, jar, signedInAt)

	dayEight := signedInAt.Add(8 * 24 * time.Hour)
	for _, name := range signInCookieNames() {
		if jar.holds(name, dayEight) {
			t.Fatalf("an idle browser still holds %q after eight days", name)
		}
	}
	if actedAs, _ := visitProtectedRoute(t, jar, dayEight); actedAs == bindingTestUserID {
		t.Fatal("an idle browser was still signed in on day eight")
	}
}

// Renewing a binding is not accepting one. A request that arrives with someone
// else's binding is refused exactly as before, and the answer hands back no
// binding at all — not even the one it presented. The renewal happens only once
// both bindings have been compared, so a request that gets one right and the
// other wrong leaves with nothing.
func TestSomeoneElsesBindingIsRefusedAndNeverRenewed(t *testing.T) {
	store := useTestSessionStore(t)

	for _, stolen := range []struct {
		name                     string
		fingerprint, deviceValue string
	}{
		{"a different fingerprint", "another-browsers-fingerprint", bindingTestDeviceID},
		{"a different device", bindingTestFingerprint, "another-browsers-device"},
		{"no binding at all", "", ""},
	} {
		t.Run(stolen.name, func(t *testing.T) {
			jar := newBrowserCookieJar()
			signedInAt := time.Date(2026, 3, 1, 9, 0, 0, 0, time.UTC)
			signIn(t, store, jar, signedInAt)

			// Keep the session, replace the bindings with the other browser's.
			delete(jar.held, e_sessions.FingerprintCookieName())
			delete(jar.held, e_sessions.DeviceIDCookieName())
			if stolen.fingerprint != "" {
				jar.held[e_sessions.FingerprintCookieName()] = heldCookie{value: stolen.fingerprint}
			}
			if stolen.deviceValue != "" {
				jar.held[e_sessions.DeviceIDCookieName()] = heldCookie{value: stolen.deviceValue}
			}

			actedAs, recorder := visitProtectedRoute(t, jar, signedInAt.Add(time.Hour))
			if actedAs != 0 {
				t.Fatalf("a request carrying another browser's binding reached the handler as %d", actedAs)
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
			for _, cookie := range recorder.Result().Cookies() {
				if cookie.Name == e_sessions.FingerprintCookieName() || cookie.Name == e_sessions.DeviceIDCookieName() {
					t.Fatalf("the refused request was handed %q = %q; a refusal renews nothing", cookie.Name, cookie.Value)
				}
			}
		})
	}
}

// The renewal is one full fresh lifetime for all three, read from the one place
// that states it; a shorter or uneven renewal would let the cookies drift apart.
func TestARenewedSignInCarriesOneLifetimeForAllThreeCookies(t *testing.T) {
	store := useTestSessionStore(t)
	jar := newBrowserCookieJar()

	signedInAt := time.Date(2026, 3, 1, 9, 0, 0, 0, time.UTC)
	signIn(t, store, jar, signedInAt)

	_, recorder := visitProtectedRoute(t, jar, signedInAt.Add(3*24*time.Hour))
	renewed := map[string]int{}
	for _, cookie := range recorder.Result().Cookies() {
		renewed[cookie.Name] = cookie.MaxAge
	}

	wantMaxAge := int(e_sessions.SignInLifetime.Seconds())
	for _, name := range signInCookieNames() {
		got, present := renewed[name]
		if !present {
			t.Fatalf("a passing request did not renew %q", name)
		}
		if got != wantMaxAge {
			t.Fatalf("%q renewed for %d seconds, want the sign-in lifetime %d", name, got, wantMaxAge)
		}
	}
}

// The renewal is made once, at the end of the pair of binding stages, so that
// has to be the end of a pair everywhere: the pipeline must run the device stage
// after the fingerprint stage, and no route may run one of the two without the
// other.
func TestTheBindingStagesRunTogetherWithTheDeviceStageLast(t *testing.T) {
	fingerprintAt, deviceAt := -1, -1
	for index, stage := range pipeline.PipelineOrder {
		switch stage.Name {
		case "fingerprint":
			fingerprintAt = index
		case "device_id":
			deviceAt = index
		}
	}
	if fingerprintAt < 0 || deviceAt < 0 {
		t.Fatalf("the pipeline order lacks a binding stage: fingerprint at %d, device_id at %d", fingerprintAt, deviceAt)
	}
	if deviceAt < fingerprintAt {
		t.Fatalf("the device stage (%d) runs before the fingerprint stage (%d), so its renewal would precede the fingerprint comparison", deviceAt, fingerprintAt)
	}
	for handlerName, profile := range pipeline.RouteProfiles {
		if profile.Skips("fingerprint") != profile.Skips("device_id") {
			t.Errorf("%s runs one binding stage without the other", handlerName)
		}
	}
}
