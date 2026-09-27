// login_session_identity_test.go
// Unit tests for authenticated session identity and local factor attempt state.
// Between login credential completion and the Gorilla session values it persists.
// Exists to keep session-state contracts focused and independently testable.
package auth

import (
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/sign_in_revocation"

	"github.com/gorilla/sessions"
)

func TestSetAuthenticatedSessionIdentityStoresResolvedUserRole(t *testing.T) {
	origGuest := backend.DbGuest
	origAdmin := backend.DbAdmin
	origConfidential := backend.DbConfidential
	database := openCredentialMockDB(t, credentialMockConfig{adminGroupMember: true, authGeneration: 7})
	backend.DbGuest = database
	backend.DbAdmin = nil
	backend.DbConfidential = database
	t.Cleanup(func() {
		backend.DbGuest = origGuest
		backend.DbAdmin = origAdmin
		backend.DbConfidential = origConfidential
	})

	session := &sessions.Session{Values: map[interface{}]interface{}{}}
	if err := setAuthenticatedSessionIdentity(session, 42, "alice"); err != nil {
		t.Fatalf("setAuthenticatedSessionIdentity() returned error: %v", err)
	}

	if got := session.Values["authenticated"]; got != true {
		t.Fatalf("authenticated = %#v, want true", got)
	}
	if got := session.Values["user_id"]; got != 42 {
		t.Fatalf("user_id = %#v, want 42", got)
	}
	if got := session.Values["username"]; got != "alice" {
		t.Fatalf("username = %#v, want alice", got)
	}
	if got := session.Values["user_role"]; got != "admin" {
		t.Fatalf("user_role = %#v, want admin", got)
	}
	if got := session.Values["authentication_generation"]; got != int64(7) {
		t.Fatalf("authentication_generation = %#v, want 7", got)
	}

	// Every sign-in also gets its own identity, so signing out in this browser can
	// be refused afterwards without touching the same person's other browsers.
	firstSignInID, present := sign_in_revocation.SessionValue(session)
	if !present {
		t.Fatal("a completed sign-in carries no sign-in identity, so signing out of it could never be recorded")
	}

	secondSession := &sessions.Session{Values: map[interface{}]interface{}{}}
	if err := setAuthenticatedSessionIdentity(secondSession, 42, "alice"); err != nil {
		t.Fatalf("second sign-in returned error: %v", err)
	}
	secondSignInID, _ := sign_in_revocation.SessionValue(secondSession)
	if secondSignInID == firstSignInID {
		t.Fatal("two sign-ins of the same person share one identity, so signing out of one would sign out both")
	}
}

func TestLocalLoginFactorAttemptsAreEnvironmentIndependent(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	session := &sessions.Session{Values: map[interface{}]interface{}{}}
	setPendingLoginState(session, 42, "alice", "fingerprint", 1)

	for expected := 4; expected >= 0; expected-- {
		if got := localLoginFactorAttemptsRemaining(session, false); got != expected {
			t.Fatalf("attempts remaining = %d, want %d", got, expected)
		}
	}
	if got := localLoginFactorAttemptsRemaining(session, false); got != 0 {
		t.Fatalf("attempts remaining after lock = %d, want 0", got)
	}
}
