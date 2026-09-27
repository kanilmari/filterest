// sign_out_cookies_test.go
// Verifies that signing out ends all three cookies that carry a sign-in at once.
// Between the sign-out handler and the browser that held the session and its two bindings.
// Exists because the three cookies are renewed together on every use, so the one
// thing that must still end them all together is an explicit sign-out. Lives beside
// the root page's tests for their mocked configuration read, which the sign-out
// handler needs in order to choose where to send the person afterwards.
package router

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"easelect/backend/core_components/auth"

	e_sessions "easelect/backend/core_components/sessions"
	"github.com/gorilla/securecookie"
)

func TestSigningOutEndsAllThreeSignInCookies(t *testing.T) {
	for _, site := range rootPageSiteKinds {
		t.Run(site.name, func(t *testing.T) {
			setupRootHandlerMockDB(t, site.loginToBrowse)
			setupRootHandlerSessionStore(t)

			browser := buildRootHandlerBrowserSession(t, 42, "the-signed-in-device", "the-signed-in-fingerprint")
			request := rootPageNavigation("/api/logout", browser.sessionCookie, browser.deviceCookie, browser.fingerprintCookie)
			recorder := httptest.NewRecorder()

			auth.LogoutHandler(recorder, request)

			if recorder.Code != http.StatusSeeOther {
				t.Fatalf("status = %d, want %d", recorder.Code, http.StatusSeeOther)
			}
			ended := map[string]bool{}
			for _, cookie := range recorder.Result().Cookies() {
				if cookie.MaxAge >= 0 && cookie.Value != "" {
					t.Fatalf("sign-out re-issued %q = %q for %d seconds instead of ending it", cookie.Name, cookie.Value, cookie.MaxAge)
				}
				ended[cookie.Name] = true
			}
			for _, name := range []string{
				e_sessions.SessionName,
				e_sessions.DeviceIDCookieName(),
				e_sessions.FingerprintCookieName(),
			} {
				if !ended[name] {
					t.Fatalf("sign-out left %q with the browser", name)
				}
			}
		})
	}
}

// TestSigningOutDoesNotHandBackAFreshlySignedSignIn pins the one thing the test
// above cannot see. It checks that the browser is told to drop the cookies; it
// does not read what is inside them, and for a long time what was inside was a
// working sign-in.
//
// The session store signs whatever the session still holds every time the session
// is written, with a new timestamp, and telling the browser to delete a cookie
// does not stop that. So a sign-out that left the identity in place answered with
// a valid, newly signed sign-in in the very same header -- readable by whoever
// made the request, and good for another full sign-in lifetime from that moment.
// Someone holding a copy of a session cookie could sign out with it on purpose,
// keep the answer, and outlast the record of the sign-out.
//
// Reading the value back is the only way to catch that: the cookie's own expiry
// says nothing about the signature inside it.
func TestSigningOutDoesNotHandBackAFreshlySignedSignIn(t *testing.T) {
	for _, site := range rootPageSiteKinds {
		t.Run(site.name, func(t *testing.T) {
			setupRootHandlerMockDB(t, site.loginToBrowse)
			setupRootHandlerSessionStore(t)

			browser := buildRootHandlerBrowserSession(t, 42, "the-signed-in-device", "the-signed-in-fingerprint")
			request := rootPageNavigation("/api/logout", browser.sessionCookie, browser.deviceCookie, browser.fingerprintCookie)
			recorder := httptest.NewRecorder()

			auth.LogoutHandler(recorder, request)

			// Every value written under this name is examined, not just the last
			// one. Signing out writes the session cookie twice: once when the
			// session is saved, and again when the cookies are expired with an
			// empty value. A browser keeps only the last, but whoever made the
			// request sees the whole response and can simply keep the first.
			for _, cookie := range recorder.Result().Cookies() {
				if cookie.Name != e_sessions.SessionName || cookie.Value == "" {
					continue
				}
				// A value written back has to be readable as a session -- it was
				// signed by this store -- but it must no longer name anybody. One
				// that cannot be read is safe too: nothing can present it.
				values := map[interface{}]interface{}{}
				if err := securecookie.DecodeMulti(
					e_sessions.SessionName, cookie.Value, &values, e_sessions.Store.Codecs...,
				); err != nil {
					continue
				}
				for _, key := range []string{"user_id", "username", "authenticated", "sign_in_id", "authentication_generation"} {
					if carried, present := values[key]; present {
						t.Fatalf("signing out answered with a freshly signed session that still carries %s = %v; "+
							"whoever made that request holds working credentials again", key, carried)
					}
				}
			}
		})
	}
}

// TestSigningOutLeavesTheAuditStageSomeoneToName pins the second reason the
// sign-out handler does not empty the session it was given.
//
// The pipeline's audit stage runs after the handler returns and reads the actor
// from the session, through the same per-request cache the handler used. Clearing
// the identity inside the handler was tried and looked harmless -- the cookies are
// gone either way -- but it emptied the object the audit stage was about to read,
// so every sign-out would have been recorded with nobody behind it. Losing who
// signed out is a worse trade than anything it bought.
func TestSigningOutLeavesTheAuditStageSomeoneToName(t *testing.T) {
	for _, site := range rootPageSiteKinds {
		t.Run(site.name, func(t *testing.T) {
			setupRootHandlerMockDB(t, site.loginToBrowse)
			setupRootHandlerSessionStore(t)

			browser := buildRootHandlerBrowserSession(t, 42, "the-signed-in-device", "the-signed-in-fingerprint")
			request := rootPageNavigation("/api/logout", browser.sessionCookie, browser.deviceCookie, browser.fingerprintCookie)
			recorder := httptest.NewRecorder()

			auth.LogoutHandler(recorder, request)

			// The same call the audit stage makes, after the handler, on the same
			// request: it must still find the person who signed out.
			afterwards, err := e_sessions.GetOrCreateSession(recorder, request)
			if err != nil {
				t.Fatalf("the audit stage could not read the session at all: %v", err)
			}
			if userID, named := afterwards.Values["user_id"].(int); !named || userID != 42 {
				t.Fatalf("after the sign-out the session names user_id = %v (found = %v); "+
					"the audit record would say nobody signed out", afterwards.Values["user_id"], named)
			}
		})
	}
}
