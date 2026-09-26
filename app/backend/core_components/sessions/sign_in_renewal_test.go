// sign_in_renewal_test.go
// Pins what the one renewal of a used sign-in writes, and what it refuses to write.
// Between the renewal, the cookie writers it reuses and the session store.
// Exists so the three cookies that carry a sign-in are always re-issued together with
// one lifetime, and never for a request that has not proved it already holds them.
// Uses no database and no network.
package e_sessions

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gorilla/sessions"
)

// renewalTestSession builds a signed-in session that stores the given binding,
// and the request it belongs to. Cookies are added by the caller, so a test can
// hand the request exactly what a browser would present.
func renewalTestSession(t *testing.T, deviceID, fingerprint string) (*http.Request, *sessions.Session) {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, "https://example.com/api/user-profile", nil)
	session, err := Store.Get(request, SessionName)
	if err != nil {
		t.Fatalf("Store.Get returned error: %v", err)
	}
	session.Values["user_id"] = 42
	if deviceID != "" {
		session.Values["device_id"] = deviceID
	}
	if fingerprint != "" {
		session.Values["fingerprint_hash"] = fingerprint
	}
	return request, session
}

func withBindingCookies(request *http.Request, deviceID, fingerprint string) *http.Request {
	if deviceID != "" {
		request.AddCookie(&http.Cookie{Name: DeviceIDCookieName(), Value: deviceID})
	}
	if fingerprint != "" {
		request.AddCookie(&http.Cookie{Name: FingerprintCookieName(), Value: fingerprint})
	}
	return request
}

func TestRequestCarriesSessionBinding(t *testing.T) {
	initSessionTestStore(t)

	for _, testCase := range []struct {
		name                       string
		cookieDevice, cookieFinger string
		storedDevice, storedFinger string
		want                       bool
	}{
		{"the same browser", "d", "f", "d", "f", true},
		{"no device cookie", "", "f", "d", "f", false},
		{"no fingerprint cookie", "d", "", "d", "f", false},
		{"a different device", "other", "f", "d", "f", false},
		{"a different fingerprint", "d", "other", "d", "f", false},
		{"nothing stored in the session", "d", "f", "", "", false},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			request, session := renewalTestSession(t, testCase.storedDevice, testCase.storedFinger)
			withBindingCookies(request, testCase.cookieDevice, testCase.cookieFinger)
			if got := RequestCarriesSessionBinding(request, session); got != testCase.want {
				t.Fatalf("RequestCarriesSessionBinding = %v, want %v", got, testCase.want)
			}
		})
	}
	if RequestCarriesSessionBinding(nil, sessions.NewSession(Store, SessionName)) {
		t.Fatal("no request was reported as carrying a binding")
	}
	if RequestCarriesSessionBinding(httptest.NewRequest(http.MethodGet, "/", nil), nil) {
		t.Fatal("no session was reported as matched")
	}
}

// One use, three cookies, one lifetime: the values are the session's own, the
// lifetime is the one sign-in writes, and the session cookie still reads back.
func TestRenewUsedSignInReissuesAllThreeCookiesWithOneLifetime(t *testing.T) {
	initSessionTestStore(t)
	request, session := renewalTestSession(t, "the-device", "the-fingerprint")
	withBindingCookies(request, "the-device", "the-fingerprint")
	recorder := httptest.NewRecorder()

	if !RenewUsedSignIn(recorder, request, session) {
		t.Fatal("a request carrying its own binding was not renewed")
	}

	written := map[string]*http.Cookie{}
	for _, cookie := range recorder.Result().Cookies() {
		written[cookie.Name] = cookie
	}
	wantMaxAge := int(SignInLifetime.Seconds())
	for name, wantValue := range map[string]string{
		DeviceIDCookieName():    "the-device",
		FingerprintCookieName(): "the-fingerprint",
	} {
		cookie, present := written[name]
		if !present {
			t.Fatalf("%q was not re-issued", name)
		}
		if cookie.Value != wantValue {
			t.Fatalf("%q was re-issued as %q, want the session's own %q", name, cookie.Value, wantValue)
		}
		if cookie.MaxAge != wantMaxAge {
			t.Fatalf("%q was re-issued for %d seconds, want %d", name, cookie.MaxAge, wantMaxAge)
		}
	}
	sessionCookie, present := written[SessionName]
	if !present {
		t.Fatal("the session cookie was not re-issued")
	}
	if sessionCookie.MaxAge != wantMaxAge {
		t.Fatalf("the session was re-issued for %d seconds, want %d", sessionCookie.MaxAge, wantMaxAge)
	}
	readBack := httptest.NewRequest(http.MethodGet, "https://example.com/", nil)
	readBack.AddCookie(sessionCookie)
	restored, err := Store.Get(readBack, SessionName)
	if err != nil {
		t.Fatalf("the re-issued session does not read back: %v", err)
	}
	if got, _ := restored.Values["user_id"].(int); got != 42 {
		t.Fatalf("the re-issued session carries user_id %d, want 42", got)
	}
}

// Renewing is not accepting: a request that has not proved both bindings is
// handed nothing at all, whoever calls the renewal and from wherever.
func TestRenewUsedSignInWritesNothingForABindingTheRequestDidNotProve(t *testing.T) {
	initSessionTestStore(t)

	for _, testCase := range []struct {
		name                       string
		cookieDevice, cookieFinger string
		storedDevice, storedFinger string
	}{
		{"no device cookie", "", "f", "d", "f"},
		{"no fingerprint cookie", "d", "", "d", "f"},
		{"a different device", "other", "f", "d", "f"},
		{"a different fingerprint", "d", "other", "d", "f"},
		{"nothing stored in the session", "d", "f", "", ""},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			request, session := renewalTestSession(t, testCase.storedDevice, testCase.storedFinger)
			withBindingCookies(request, testCase.cookieDevice, testCase.cookieFinger)
			recorder := httptest.NewRecorder()

			if RenewUsedSignIn(recorder, request, session) {
				t.Fatal("an unproved binding was reported as renewed")
			}
			if cookies := recorder.Result().Cookies(); len(cookies) != 0 {
				t.Fatalf("an unproved binding was handed %d cookie(s): %v", len(cookies), cookies)
			}
		})
	}
}
