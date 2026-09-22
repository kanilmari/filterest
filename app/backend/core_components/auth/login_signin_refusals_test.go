// login_signin_refusals_test.go
// Verifies the sign-in attempts the product refuses outright in every environment.
// Between the login entry points and the removed development sign-in shortcuts.
// Exists so a closed bypass cannot quietly reopen as a second, weaker login path.
package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	backend "easelect/backend/core_components"

	"golang.org/x/crypto/bcrypt"
)

// TestLoginAPIHandler_LegacyFormDisabledInEveryEnvironment guards the removed
// non-JSON sign-in path. Development used to fall through to it.
func TestLoginAPIHandler_LegacyFormDisabledInEveryEnvironment(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/login", strings.NewReader("username=alice"))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()

	LoginAPIHandler(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status: got %d, want %d", rr.Code, http.StatusForbidden)
	}
	body := decodeJSONBody(t, rr)
	if body["error"] != "legacy_form_login_disabled" {
		t.Fatalf("unexpected body: %#v", body)
	}
}

func TestLoginHandler_PostLegacyFormDisabledInEveryEnvironment(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/login", strings.NewReader("username=alice"))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()

	LoginHandler(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status: got %d, want %d", rr.Code, http.StatusForbidden)
	}
	body := decodeJSONBody(t, rr)
	if body["error"] != "legacy_form_login_disabled" {
		t.Fatalf("unexpected body: %#v", body)
	}
}

// TestCompleteLoginJSON_FingerprintRequiredInDevelopment guards the removed
// development fingerprint bypass. An authenticated session used to be created
// with the shared placeholder "dev-mode-fingerprint" whenever the client sent
// no browser identity, so every such session carried the same device binding.
func TestCompleteLoginJSON_FingerprintRequiredInDevelopment(t *testing.T) {
	resetLoginFailureLimiter()
	hashBytes, err := bcrypt.GenerateFromPassword([]byte("correct-password"), bcrypt.DefaultCost)
	if err != nil {
		t.Fatalf("bcrypt hash setup failed: %v", err)
	}
	mockCfg := credentialMockConfig{
		userLookupOK:       true,
		userID:             42,
		hashedPassword:     string(hashBytes),
		adminGroupMember:   true,
		verificationMethod: string(verificationNone),
	}

	origDB := backend.Db
	origConf := backend.DbConfidential
	origGuest := backend.DbGuest
	backend.Db = openCredentialMockDB(t, mockCfg)
	backend.DbConfidential = openCredentialMockDB(t, mockCfg)
	backend.DbGuest = openCredentialMockDB(t, mockCfg)
	t.Cleanup(func() {
		backend.Db = origDB
		backend.DbConfidential = origConf
		backend.DbGuest = origGuest
	})

	t.Setenv("ENVIRONMENT_TYPE", "dev")
	t.Setenv("ALLOW_INSECURE_DEV_PROXY", "true")
	testStore := prepareLoginHandlerSessionStore(t)
	req := httptest.NewRequest(http.MethodPost, "/api/login", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	session, err := testStore.New(req, "session")
	if err != nil {
		t.Fatalf("create test session: %v", err)
	}
	rr := httptest.NewRecorder()

	handleLoginCredentials(rr, req, session, loginJSONRequest{
		Username:    "alice",
		Password:    "correct-password",
		Fingerprint: "",
	})

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d, want %d; body=%s", rr.Code, http.StatusBadRequest, rr.Body.String())
	}
	body := decodeJSONBody(t, rr)
	if body["error"] != "fingerprint_required" {
		t.Fatalf("unexpected body: %#v", body)
	}
	if authenticated, _ := session.Values["authenticated"].(bool); authenticated {
		t.Fatal("a session without a browser fingerprint was authenticated")
	}
	if storedFingerprint, ok := session.Values["fingerprint_hash"]; ok {
		t.Fatalf("placeholder fingerprint stored in session: %#v", storedFingerprint)
	}
}
