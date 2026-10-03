// check_fingerprint_test.go
// Regression tests for the browser-identity check that runs when the application starts.
// Covers the handler between the session store, the identity HMAC and the login page that follows it.
package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
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

// A guest has no sign-in to end; a changed identity is simply taken into use.
func TestCheckFingerprintReEnrollsAGuest(t *testing.T) {
	store := prepareLoginHandlerSessionStore(t)

	guest := httptest.NewRequest(http.MethodGet, "https://localhost/", nil)
	session, err := store.Get(guest, e_sessions.SessionName)
	if err != nil {
		t.Fatalf("store.Get: %v", err)
	}
	session.Values["user_id"] = 1
	session.Values["fingerprint_hash"] = HMACFingerprint("identity-before-the-update")
	saved := httptest.NewRecorder()
	if err := session.Save(guest, saved); err != nil {
		t.Fatalf("session.Save: %v", err)
	}

	check := httptest.NewRequest(http.MethodPost, "https://localhost/api/check-fingerprint",
		strings.NewReader(`{"fingerprint":"identity-after-the-update"}`))
	for _, cookie := range saved.Result().Cookies() {
		check.AddCookie(cookie)
	}
	answer := httptest.NewRecorder()
	CheckFingerprintHandler(answer, check)

	if answer.Code != http.StatusOK {
		t.Fatalf("guest check status = %d, want %d", answer.Code, http.StatusOK)
	}
}
