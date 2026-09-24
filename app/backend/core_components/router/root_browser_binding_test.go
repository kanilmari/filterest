// root_browser_binding_test.go
// Verifies that only a visitor without a sign-in can obtain a browser binding from the root page.
// Between the public root page, the browser's cookies and the device and fingerprint pipeline stages.
// Exists because the root page used to hand a signed-in request fresh device and
// fingerprint values taken from whatever cookies it carried, so a request holding
// nothing but a stolen session cookie could ask this page for the proof that it
// was the browser which signed in, and then use it on the protected routes.
// Uses the package's mocked configuration reads and no network.
package router

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"easelect/backend/core_components/auth_generation"
	e_sessions "easelect/backend/core_components/sessions"
	"easelect/backend/pipeline/device_id_check"
	"easelect/backend/pipeline/fingerprint_check"

	gorillaSessions "github.com/gorilla/sessions"
)

// signedInBrowser is one browser's whole set of cookies, so a test can hand a
// later request exactly the cookies an earlier response gave it.
type signedInBrowser struct {
	sessionCookie     *http.Cookie
	deviceCookie      *http.Cookie
	fingerprintCookie *http.Cookie
}

// buildRootHandlerBrowserSession stores a session with the given identity and
// binding, and returns the cookies a browser would then hold. The session is
// built on a throwaway request so the request under test carries cookies only,
// exactly as a real browser's request does.
func buildRootHandlerBrowserSession(
	t *testing.T,
	userID int,
	deviceID string,
	fingerprint string,
) signedInBrowser {
	t.Helper()

	carrier := httptest.NewRequest(http.MethodGet, "/", nil)
	session, err := e_sessions.Store.Get(carrier, e_sessions.SessionName)
	if err != nil {
		t.Fatalf("Store.Get() error = %v", err)
	}
	session.Values["user_id"] = userID
	session.Values["username"] = "binding-test-person"
	session.Values["authenticated"] = true
	if deviceID != "" {
		session.Values["device_id"] = deviceID
	}
	if fingerprint != "" {
		session.Values["fingerprint_hash"] = fingerprint
	}

	recorder := httptest.NewRecorder()
	if err := session.Save(carrier, recorder); err != nil {
		t.Fatalf("session.Save() error = %v", err)
	}

	browser := signedInBrowser{}
	for _, cookie := range recorder.Result().Cookies() {
		if cookie.Name == e_sessions.SessionName {
			browser.sessionCookie = cookie
		}
	}
	if browser.sessionCookie == nil {
		t.Fatal("the stored session produced no session cookie")
	}
	if deviceID != "" {
		browser.deviceCookie = &http.Cookie{Name: e_sessions.DeviceIDCookieName(), Value: deviceID}
	}
	if fingerprint != "" {
		browser.fingerprintCookie = &http.Cookie{Name: e_sessions.FingerprintCookieName(), Value: fingerprint}
	}
	return browser
}

func rootPageNavigation(target string, cookies ...*http.Cookie) *http.Request {
	request := httptest.NewRequest(http.MethodGet, target, nil)
	request.Header.Set("Accept", "text/html,application/xhtml+xml")
	request.Header.Set("Sec-Fetch-Mode", "navigate")
	for _, cookie := range cookies {
		if cookie != nil {
			request.AddCookie(cookie)
		}
	}
	return request
}

func responseCookie(recorder *httptest.ResponseRecorder, name string) *http.Cookie {
	for _, cookie := range recorder.Result().Cookies() {
		if cookie.Name == name {
			return cookie
		}
	}
	return nil
}

func acceptSignInGeneration(t *testing.T) {
	t.Helper()
	withRootAuthenticationGenerationMatch(t, func(
		_ context.Context,
		_ auth_generation.Querier,
		_ *gorillaSessions.Session,
		_ int,
	) (bool, error) {
		return true, nil
	})
}

// actAsIdentityThroughBindingStages replays a protected request through the two
// stages that guard every protected route, and reports the identity the request
// managed to act as. Zero means it never reached the handler.
func actAsIdentityThroughBindingStages(cookies ...*http.Cookie) int {
	reachedAs := 0
	protectedHandler := func(w http.ResponseWriter, r *http.Request) {
		session, err := e_sessions.GetOrCreateSession(w, r)
		if err == nil {
			reachedAs, _ = session.Values["user_id"].(int)
		}
		w.WriteHeader(http.StatusOK)
	}

	guarded := device_id_check.WithDeviceIDCheck(fingerprint_check.WithFingerprintCheck(protectedHandler))

	request := httptest.NewRequest(http.MethodGet, "/api/user-profile", nil)
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Sec-Fetch-Mode", "cors")
	for _, cookie := range cookies {
		if cookie != nil {
			request.AddCookie(cookie)
		}
	}
	guarded(httptest.NewRecorder(), request)
	return reachedAs
}

// The hole this file exists for. A request that holds nothing but a session
// cookie asks the public root page for a page, and must not come away with the
// device and fingerprint values that let it act as the person who signed in.
func TestSignedInSessionWithoutItsBindingIsNotGivenAWorkingOne(t *testing.T) {
	setupRootHandlerMockDB(t, false)
	setupRootHandlerSessionStore(t)
	setupRootHandlerFrontend(t)
	acceptSignInGeneration(t)

	const victimUserID = 42
	browser := buildRootHandlerBrowserSession(t, victimUserID, "the-signed-in-device", "the-signed-in-fingerprint")

	// Only the session cookie travels; the binding cookies stay behind.
	request := rootPageNavigation("/", browser.sessionCookie)
	recorder := httptest.NewRecorder()

	rootHandler(recorder, request)

	if recorder.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want %d (the ended sign-in answer)", recorder.Code, http.StatusSeeOther)
	}
	if location := recorder.Header().Get("Location"); !strings.Contains(location, "auth_notice=session-ended") {
		t.Fatalf("Location = %q, want the login page with its explanation", location)
	}

	handedBackDevice := responseCookie(recorder, e_sessions.DeviceIDCookieName())
	if handedBackDevice != nil && handedBackDevice.Value != "" {
		t.Fatalf("the root page minted a device binding for a signed-in request: %q", handedBackDevice.Value)
	}
	handedBackFingerprint := responseCookie(recorder, e_sessions.FingerprintCookieName())
	if handedBackFingerprint != nil && handedBackFingerprint.Value != "" {
		t.Fatalf("the root page minted a fingerprint binding for a signed-in request: %q", handedBackFingerprint.Value)
	}

	// Whatever came back is now replayed against a protected route, both with the
	// session cookie the root page returned and with the one the request arrived
	// with. Neither may act as the person who signed in.
	returnedSession := responseCookie(recorder, e_sessions.SessionName)
	for _, replay := range []struct {
		name          string
		sessionCookie *http.Cookie
	}{
		{"with the session the root page returned", returnedSession},
		{"with the session the request arrived with", browser.sessionCookie},
	} {
		t.Run(replay.name, func(t *testing.T) {
			if replay.sessionCookie == nil {
				t.Skip("no such session cookie in this answer")
			}
			actedAs := actAsIdentityThroughBindingStages(
				replay.sessionCookie,
				handedBackDevice,
				handedBackFingerprint,
			)
			if actedAs > 1 {
				t.Fatalf("the replayed request acted as user %d after visiting the root page", actedAs)
			}
		})
	}
}

// A person who signed in and whose browser still carries its binding must not
// notice any of this.
func TestSignedInVisitorWithItsBindingIsUnaffected(t *testing.T) {
	setupRootHandlerMockDB(t, false)
	setupRootHandlerSessionStore(t)
	setupRootHandlerFrontend(t)
	acceptSignInGeneration(t)

	browser := buildRootHandlerBrowserSession(t, 42, "the-signed-in-device", "the-signed-in-fingerprint")

	for _, page := range []string{"/", "/service_catalog"} {
		t.Run(page, func(t *testing.T) {
			request := rootPageNavigation(page, browser.sessionCookie, browser.deviceCookie, browser.fingerprintCookie)
			recorder := httptest.NewRecorder()

			rootHandler(recorder, request)

			if recorder.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
			}
			if location := recorder.Header().Get("Location"); location != "" {
				t.Fatalf("unexpected redirect Location = %q", location)
			}
			if !strings.Contains(recorder.Body.String(), "root-shell") {
				t.Fatalf("expected the root shell, got %q", recorder.Body.String())
			}
			if rotated := responseCookie(recorder, e_sessions.DeviceIDCookieName()); rotated != nil {
				t.Fatalf("the device binding was rewritten during ordinary browsing: %q", rotated.Value)
			}
			if rotated := responseCookie(recorder, e_sessions.FingerprintCookieName()); rotated != nil {
				t.Fatalf("the fingerprint binding was rewritten during ordinary browsing: %q", rotated.Value)
			}
		})
	}
}

// A visitor who never signed in keeps the public site exactly as it was: the
// page loads and the browser is still given the values the rest of the
// application expects to find.
func TestSignedOutVisitorStillReceivesItsGuestBinding(t *testing.T) {
	setupRootHandlerMockDB(t, false)
	setupRootHandlerSessionStore(t)
	setupRootHandlerFrontend(t)

	for _, page := range []string{"/", "/service_catalog"} {
		t.Run(page, func(t *testing.T) {
			request := rootPageNavigation(page)
			recorder := httptest.NewRecorder()

			rootHandler(recorder, request)

			if recorder.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
			}
			if location := recorder.Header().Get("Location"); location != "" {
				t.Fatalf("unexpected redirect Location = %q", location)
			}
			if !strings.Contains(recorder.Body.String(), "root-shell") {
				t.Fatalf("expected the root shell, got %q", recorder.Body.String())
			}
			device := responseCookie(recorder, e_sessions.DeviceIDCookieName())
			if device == nil || device.Value == "" {
				t.Fatal("a visitor who never signed in was given no device binding")
			}
			fingerprint := responseCookie(recorder, e_sessions.FingerprintCookieName())
			if fingerprint == nil || fingerprint.Value == "" {
				t.Fatal("a visitor who never signed in was given no fingerprint binding")
			}
		})
	}
}

// A returning guest keeps the binding it already carries, so guest identity
// survives across page loads exactly as before.
func TestReturningGuestKeepsTheBindingItAlreadyCarries(t *testing.T) {
	setupRootHandlerMockDB(t, false)
	setupRootHandlerSessionStore(t)
	setupRootHandlerFrontend(t)

	guest := buildRootHandlerBrowserSession(t, 1, "the-guest-device", "the-guest-fingerprint")
	request := rootPageNavigation("/", guest.sessionCookie, guest.deviceCookie, guest.fingerprintCookie)
	recorder := httptest.NewRecorder()

	rootHandler(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
	if rotated := responseCookie(recorder, e_sessions.DeviceIDCookieName()); rotated != nil && rotated.Value != "the-guest-device" {
		t.Fatalf("the returning guest's device binding changed to %q", rotated.Value)
	}
	if rotated := responseCookie(recorder, e_sessions.FingerprintCookieName()); rotated != nil && rotated.Value != "the-guest-fingerprint" {
		t.Fatalf("the returning guest's fingerprint binding changed to %q", rotated.Value)
	}
}

func TestRequestCarriesSessionBrowserBinding(t *testing.T) {
	store := gorillaSessions.NewCookieStore(rootHandlerTestKey)
	newSession := func(deviceID, fingerprint string) *gorillaSessions.Session {
		session := gorillaSessions.NewSession(store, "session")
		if deviceID != "" {
			session.Values["device_id"] = deviceID
		}
		if fingerprint != "" {
			session.Values["fingerprint_hash"] = fingerprint
		}
		return session
	}
	requestWith := func(deviceID, fingerprint string) *http.Request {
		request := httptest.NewRequest(http.MethodGet, "/", nil)
		if deviceID != "" {
			request.AddCookie(&http.Cookie{Name: e_sessions.DeviceIDCookieName(), Value: deviceID})
		}
		if fingerprint != "" {
			request.AddCookie(&http.Cookie{Name: e_sessions.FingerprintCookieName(), Value: fingerprint})
		}
		return request
	}

	for _, testCase := range []struct {
		name    string
		request *http.Request
		session *gorillaSessions.Session
		want    bool
	}{
		{"the same browser", requestWith("d", "f"), newSession("d", "f"), true},
		{"no device cookie", requestWith("", "f"), newSession("d", "f"), false},
		{"no fingerprint cookie", requestWith("d", ""), newSession("d", "f"), false},
		{"a different device", requestWith("other", "f"), newSession("d", "f"), false},
		{"a different fingerprint", requestWith("d", "other"), newSession("d", "f"), false},
		{"nothing stored in the session", requestWith("d", "f"), newSession("", ""), false},
		{"no request", nil, newSession("d", "f"), false},
		{"no session", requestWith("d", "f"), nil, false},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			if got := requestCarriesSessionBrowserBinding(testCase.request, testCase.session); got != testCase.want {
				t.Fatalf("requestCarriesSessionBrowserBinding = %v, want %v", got, testCase.want)
			}
		})
	}
}

func TestIsSignedInUserID(t *testing.T) {
	for _, testCase := range []struct {
		name  string
		value interface{}
		want  bool
	}{
		{"a person who signed in", 42, true},
		{"the guest identity", 1, false},
		{"no identity", nil, false},
		{"an unreadable identity", "42", false},
		{"an impossible identity", 0, false},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			if got := isSignedInUserID(testCase.value); got != testCase.want {
				t.Fatalf("isSignedInUserID(%#v) = %v, want %v", testCase.value, got, testCase.want)
			}
		})
	}
}
