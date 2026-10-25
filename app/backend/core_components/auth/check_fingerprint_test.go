// check_fingerprint_test.go
// Regression tests for the browser-identity check that runs when the application starts.
// Covers the handler between the session store, the identity HMAC and the login page that follows it.
package auth

import (
	"encoding/json"
	"maps"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	e_sessions "easelect/backend/core_components/sessions"
)

// A browser update changes the identity of every signed-in browser at once.
// The check must end such a sign-in cleanly: the identity is cleared before the
// answer, so the login page that follows shows its form instead of sending the
// still signed-in session back to the application, which would refuse it again.
func TestCheckFingerprintEndsASignedInSessionWhoseBrowserNoLongerMatches(t *testing.T) {
	store := prepareLoginHandlerSessionStore(t)
	setupLoginHandlerMockDB(t, false)
	setupLoginHandlerFrontend(t)

	signedIn := httptest.NewRequest(http.MethodGet, "https://localhost/", nil)
	session, err := store.Get(signedIn, e_sessions.SessionName)
	if err != nil {
		t.Fatalf("store.Get: %v", err)
	}
	session.Values["user_id"] = 5
	session.Values["fingerprint_hash"] = HMACFingerprint("identity-before-the-update")
	saved := httptest.NewRecorder()
	if err := session.Save(signedIn, saved); err != nil {
		t.Fatalf("session.Save: %v", err)
	}

	check := httptest.NewRequest(http.MethodPost, "https://localhost/api/check-fingerprint",
		strings.NewReader(`{"fingerprint":"identity-after-the-update"}`))
	check.Header.Set("Content-Type", "application/json")
	for _, cookie := range saved.Result().Cookies() {
		check.AddCookie(cookie)
	}
	answer := httptest.NewRecorder()
	CheckFingerprintHandler(answer, check)

	if answer.Code != http.StatusForbidden {
		t.Fatalf("check status = %d, want %d (sign-in no longer valid)", answer.Code, http.StatusForbidden)
	}
	var body struct {
		AuthFailure bool `json:"auth_failure"`
	}
	if err := json.NewDecoder(answer.Body).Decode(&body); err != nil || !body.AuthFailure {
		t.Fatalf("check answer is not an authentication failure: %+v, %v", body, err)
	}

	login := httptest.NewRequest(http.MethodGet, "https://localhost/login", nil)
	for _, cookie := range answer.Result().Cookies() {
		login.AddCookie(cookie)
	}
	page := httptest.NewRecorder()
	LoginHandler(page, login)
	if page.Code != http.StatusOK {
		t.Fatalf("login page status = %d (Location %q), want the form instead of a redirect back",
			page.Code, page.Header().Get("Location"))
	}
}

// Both historical enrollment branches must be unreachable for every guest form.
func TestCheckFingerprintGuestIsReadOnlyNoOp(t *testing.T) {
	for _, userID := range []interface{}{nil, 1, 0, -1, "5"} {
		for _, oldFingerprint := range []string{"", HMACFingerprint("old-browser")} {
			for _, body := range []string{`{"fingerprint":"new-browser"}`, `{}`} {
				store := prepareLoginHandlerSessionStore(t)
				check := httptest.NewRequest(http.MethodPost, "https://localhost/api/check-fingerprint", strings.NewReader(body))
				carrier := httptest.NewRequest(http.MethodGet, "/", nil)
				session, err := store.Get(carrier, e_sessions.SessionName)
				if err != nil {
					t.Fatal(err)
				}
				if userID != nil {
					session.Values["user_id"] = userID
				}
				if oldFingerprint != "" {
					session.Values["fingerprint_hash"] = oldFingerprint
				}
				session.Values["device_id"] = "old-guest-device"
				saved := httptest.NewRecorder()
				if err := session.Save(carrier, saved); err != nil {
					t.Fatal(err)
				}
				for _, cookie := range saved.Result().Cookies() {
					check.AddCookie(cookie)
				}
				loaded, err := e_sessions.Load(check)
				if err != nil {
					t.Fatal(err)
				}
				before := maps.Clone(loaded.Values)
				answer := httptest.NewRecorder()
				CheckFingerprintHandler(answer, check)
				if answer.Code != http.StatusOK || answer.Body.String() != `{"ok":true}` {
					t.Fatalf("guest %v: status=%d body=%s", userID, answer.Code, answer.Body.String())
				}
				if len(answer.Header().Values("Set-Cookie")) != 0 || !reflect.DeepEqual(before, loaded.Values) {
					t.Fatalf("guest %v check wrote a cookie or changed session state", userID)
				}
			}
		}
	}
}

func TestCheckFingerprintAbsentOrInvalidSessionWritesNoCookies(t *testing.T) {
	prepareLoginHandlerSessionStore(t)
	for _, cookieValue := range []string{"", "not-a-valid-session"} {
		check := httptest.NewRequest(http.MethodPost, "/api/check-fingerprint", strings.NewReader("invalid-json"))
		if cookieValue != "" {
			check.AddCookie(&http.Cookie{Name: e_sessions.SessionName, Value: cookieValue})
		}
		answer := httptest.NewRecorder()
		CheckFingerprintHandler(answer, check)
		if answer.Code != http.StatusOK || len(answer.Header().Values("Set-Cookie")) != 0 {
			t.Fatalf("anonymous check = %d, cookies=%v", answer.Code, answer.Header().Values("Set-Cookie"))
		}
	}
}

func TestCheckFingerprintSignedInEnrollmentAndMatch(t *testing.T) {
	store := prepareLoginHandlerSessionStore(t)
	for _, enrolled := range []bool{false, true} {
		carrier := httptest.NewRequest(http.MethodGet, "/", nil)
		session, err := store.Get(carrier, e_sessions.SessionName)
		if err != nil {
			t.Fatal(err)
		}
		session.Values["user_id"] = 5
		if enrolled {
			session.Values["fingerprint_hash"] = HMACFingerprint("same-browser")
		}
		saved := httptest.NewRecorder()
		if err := session.Save(carrier, saved); err != nil {
			t.Fatal(err)
		}
		check := httptest.NewRequest(http.MethodPost, "/api/check-fingerprint", strings.NewReader(`{"fingerprint":"same-browser"}`))
		for _, cookie := range saved.Result().Cookies() {
			check.AddCookie(cookie)
		}
		answer := httptest.NewRecorder()
		CheckFingerprintHandler(answer, check)
		if answer.Code != http.StatusOK {
			t.Fatalf("signed-in check = %d", answer.Code)
		}
		loaded, err := e_sessions.Load(check)
		if err != nil {
			t.Fatal(err)
		}
		if loaded.Values["user_id"] != 5 || loaded.Values["fingerprint_hash"] != HMACFingerprint("same-browser") {
			t.Fatal("signed-in enrollment or match changed")
		}
		if enrolled && len(answer.Result().Cookies()) != 0 {
			t.Fatal("matching check rewrote cookies")
		}
		if !enrolled && len(answer.Result().Cookies()) != 2 {
			t.Fatal("enrollment did not write session and fingerprint cookies")
		}
	}
}
