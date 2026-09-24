// session_binding_renewal_test.go
// Verifies that a person who keeps using the site keeps the browser binding that carries their sign-in.
// Between the two authentication stages that check the binding and the browser that holds it.
// Exists because the binding cookies were written only at sign-in while the session's seven days
// restarted on every use, so a regular visitor was signed out by a binding that quietly ran out
// underneath a session the server still accepted. Uses no database and no network.
package pipeline_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	e_sessions "easelect/backend/core_components/sessions"
	"easelect/backend/pipeline/device_id_check"
	"easelect/backend/pipeline/fingerprint_check"

	gorillaSessions "github.com/gorilla/sessions"
)

const (
	bindingTestUserID      = 42
	bindingTestFingerprint = "the-signed-fingerprint-value"
	bindingTestDeviceID    = "the-signed-device-value"
	bindingTestSessionDays = 7
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

// store records what a response told the browser to keep.
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

// useTestSessionStore installs a cookie store with the runtime's own seven-day
// session lifetime and no database behind it.
func useTestSessionStore(t *testing.T) *gorillaSessions.CookieStore {
	t.Helper()
	originalStore := e_sessions.Store
	originalName := e_sessions.SessionName
	store := gorillaSessions.NewCookieStore(bindingTestSessionKey)
	store.Options = &gorillaSessions.Options{
		Path:     "/",
		MaxAge:   bindingTestSessionDays * 24 * 60 * 60,
		HttpOnly: true,
	}
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

// refreshSession models the half of the pair that never expired. An ordinary
// page load calls auth.GetAuthModesHandler, which writes the session on every
// call, and that write restarts the session cookie's seven days.
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

// visitProtectedRoute sends one ordinary request for data through both binding
// stages in the order PipelineOrder wires them, and lets the browser keep
// whatever the answer handed back.
func visitProtectedRoute(t *testing.T, jar *browserCookieJar, now time.Time) (bool, *httptest.ResponseRecorder) {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, "/api/user-permissions", nil)
	request.Header.Set("Accept", "*/*")
	request.Header.Set("Sec-Fetch-Mode", "cors")
	jar.attach(request, now)

	recorder := httptest.NewRecorder()
	reached := false
	handler := fingerprint_check.WithFingerprintCheck(
		device_id_check.WithDeviceIDCheck(func(w http.ResponseWriter, _ *http.Request) {
			reached = true
			w.WriteHeader(http.StatusOK)
		}),
	)
	handler(recorder, request)
	jar.store(recorder, now)
	return reached, recorder
}

// The owner's decision, at the level of one browser: a person who keeps using
// the site stays signed in. This fails on the code before the renewal, where
// day three refreshed the session and left both bindings on the seven days they
// were given at sign-in.
func TestAnActivePersonStaysSignedInPastTheOriginalBindingLifetime(t *testing.T) {
	store := useTestSessionStore(t)
	jar := newBrowserCookieJar()

	signedInAt := time.Date(2026, 3, 1, 9, 0, 0, 0, time.UTC)
	signIn(t, store, jar, signedInAt)

	dayThree := signedInAt.Add(3 * 24 * time.Hour)
	refreshSession(t, store, jar, dayThree)
	if reached, recorder := visitProtectedRoute(t, jar, dayThree); !reached {
		t.Fatalf("the person was stopped on day three: status %d, body %s", recorder.Code, recorder.Body.String())
	}

	// Day eight is past the seven days the bindings were given at sign-in, and
	// well inside the seven days the day-three visit gave the session.
	dayEight := signedInAt.Add(8 * 24 * time.Hour)
	reached, recorder := visitProtectedRoute(t, jar, dayEight)
	if !reached {
		t.Fatalf("a person who kept using the site was signed out on day eight: status %d, body %s",
			recorder.Code, recorder.Body.String())
	}
	if recorder.Code != http.StatusOK {
		t.Fatalf("day eight status: got %d, want %d", recorder.Code, http.StatusOK)
	}
}

// Renewal follows use, not the calendar: a browser that stops visiting keeps
// nothing. The two stages' own tests then cover what such a browser is told
// when it comes back with a session but no binding.
func TestAnIdleBrowserLosesItsBindingsBecauseNothingRenewedThem(t *testing.T) {
	store := useTestSessionStore(t)
	jar := newBrowserCookieJar()

	signedInAt := time.Date(2026, 3, 1, 9, 0, 0, 0, time.UTC)
	signIn(t, store, jar, signedInAt)

	dayEight := signedInAt.Add(8 * 24 * time.Hour)
	for _, name := range []string{
		e_sessions.FingerprintCookieName(),
		e_sessions.DeviceIDCookieName(),
		e_sessions.SessionName,
	} {
		if jar.holds(name, dayEight) {
			t.Fatalf("an idle browser still holds %q after eight days", name)
		}
	}
}

// Renewing a binding is not accepting one. A request that arrives with someone
// else's binding is refused exactly as before, and the answer never hands back a
// binding the request did not already carry.
//
// Each stage writes a binding only after that binding's own value has been found
// equal to the session's, so the value written is byte-identical to the one the
// request presented. A request that gets one binding right and the other wrong is
// therefore still refused, and leaves with nothing it did not arrive with.
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
			arrivedWith := map[string]string{
				e_sessions.FingerprintCookieName(): stolen.fingerprint,
				e_sessions.DeviceIDCookieName():    stolen.deviceValue,
			}
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

			reached, recorder := visitProtectedRoute(t, jar, signedInAt.Add(time.Hour))
			if reached {
				t.Fatal("a request carrying another browser's binding reached the handler")
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
				presented, isBinding := arrivedWith[cookie.Name]
				if !isBinding || cookie.Value == "" {
					continue
				}
				if cookie.Value != presented {
					t.Fatalf("the refused request left with %q = %q, which it did not arrive with (%q)",
						cookie.Name, cookie.Value, presented)
				}
			}
		})
	}
}

// The renewal must be a full fresh lifetime, not a leftover: it has to match the
// lifetime a sign-in writes, or the binding would still drift behind the session.
func TestARenewedBindingCarriesTheSameLifetimeSignInWrites(t *testing.T) {
	store := useTestSessionStore(t)
	jar := newBrowserCookieJar()

	signedInAt := time.Date(2026, 3, 1, 9, 0, 0, 0, time.UTC)
	signIn(t, store, jar, signedInAt)

	_, recorder := visitProtectedRoute(t, jar, signedInAt.Add(3*24*time.Hour))
	renewed := map[string]int{}
	for _, cookie := range recorder.Result().Cookies() {
		renewed[cookie.Name] = cookie.MaxAge
	}

	// The lifetime a sign-in writes, read from the writer itself rather than
	// repeated as a number here.
	signInLifetime := httptest.NewRecorder()
	e_sessions.SetFingerprintCookie(signInLifetime, bindingTestFingerprint)
	wantMaxAge := signInLifetime.Result().Cookies()[0].MaxAge

	for _, name := range []string{e_sessions.FingerprintCookieName(), e_sessions.DeviceIDCookieName()} {
		got, present := renewed[name]
		if !present {
			t.Fatalf("a passing request did not renew %q", name)
		}
		if got != wantMaxAge {
			t.Fatalf("%q renewed for %d seconds, want the sign-in lifetime %d", name, got, wantMaxAge)
		}
	}
}
