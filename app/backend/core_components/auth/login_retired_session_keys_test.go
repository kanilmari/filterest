// login_retired_session_keys_test.go
// Proves that a cookie written before the session lost its names gives them up at the next write.
// Between the JSON sign-in flow and the sessions package's Load and Save.
// Exists because such a cookie can be mid sign-in, holding the typed login name, when the release
// lands, and the failed-code write is the first thing that rewrites it.
package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	e_sessions "easelect/backend/core_components/sessions"
)

func TestAPreUpgradeCookieLosesItsNamesAtTheNextWrite(t *testing.T) {
	resetLoginFailureLimiter()
	pinHash, err := hashFixedPIN("2468")
	if err != nil {
		t.Fatalf("fixed PIN hash setup failed: %v", err)
	}
	originalConfidential := backend.DbConfidential
	backend.DbConfidential = openCredentialMockDB(t, credentialMockConfig{
		userID:             42,
		verificationMethod: string(verificationFixedPIN),
		fixedPINHash:       pinHash,
	})
	t.Cleanup(func() { backend.DbConfidential = originalConfidential })

	t.Setenv("ALLOW_INSECURE_DEV_PROXY", "true")
	testStore := prepareLoginHandlerSessionStore(t)

	// A cookie from the earlier release, halfway through signing in: it holds the
	// login name that was typed and the old copy of the name.
	seedRequest := httptest.NewRequest(http.MethodPost, "/api/login", nil)
	earlier, err := testStore.New(seedRequest, "session")
	if err != nil {
		t.Fatalf("create earlier session: %v", err)
	}
	setPendingLoginState(earlier, 42, "test-fingerprint", 1)
	earlier.Values["otp_pending_username"] = "old-login-name"
	earlier.Values["username"] = "old-login-name"
	earlier.Values["csrf_token"] = "csrf-for-test"
	seeded := httptest.NewRecorder()
	if err := testStore.Save(seedRequest, seeded, earlier); err != nil {
		t.Fatalf("seed earlier cookie: %v", err)
	}

	request := httptest.NewRequest(http.MethodPost, "/api/login",
		strings.NewReader(`{"otp_code":"1357","csrf_token":"csrf-for-test"}`))
	request.Header.Set("Content-Type", "application/json")
	request.RemoteAddr = "10.20.0.9:1234"
	request.AddCookie(seeded.Result().Cookies()[0])
	recorder := httptest.NewRecorder()

	LoginAPIHandler(recorder, request)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("wrong PIN status = %d, want 401; body=%s", recorder.Code, recorder.Body.String())
	}
	if strings.Contains(recorder.Body.String(), "old-login-name") {
		t.Fatalf("the answer carries the old name: %s", recorder.Body.String())
	}
	written := false
	for _, cookie := range recorder.Result().Cookies() {
		if cookie.Name != "session" {
			continue
		}
		decodeRequest := httptest.NewRequest(http.MethodGet, "/", nil)
		decodeRequest.AddCookie(cookie)
		decoded, err := testStore.Get(decodeRequest, "session")
		if err != nil {
			t.Fatalf("decode written session: %v", err)
		}
		for _, key := range e_sessions.RetiredSessionKeys {
			if _, present := decoded.Values[key]; present {
				t.Fatalf("the failed-code write kept the retired key %q", key)
			}
		}
		if decoded.Values["otp_pending_attempts"] != 1 || decoded.Values["otp_pending_user_id"] != 42 {
			t.Fatalf("the failed-code write lost the pending sign-in: %#v", decoded.Values)
		}
		written = true
	}
	if !written {
		t.Fatal("the failed code wrote no session, so the old names were never rewritten")
	}
}
