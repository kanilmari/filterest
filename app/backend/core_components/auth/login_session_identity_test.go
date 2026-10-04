// login_session_identity_test.go
// Unit tests for authenticated session identity and local factor attempt state.
// Between login credential completion and the Gorilla session values it persists.
// Exists to keep session-state contracts focused and independently testable.
package auth

import (
	"testing"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/sign_in_deadline"
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
	if err := setAuthenticatedSessionIdentity(session, 42); err != nil {
		t.Fatalf("setAuthenticatedSessionIdentity() returned error: %v", err)
	}

	if got := session.Values["authenticated"]; got != true {
		t.Fatalf("authenticated = %#v, want true", got)
	}
	if got := session.Values["user_id"]; got != 42 {
		t.Fatalf("user_id = %#v, want 42", got)
	}
	// The session names nobody: names are read by id where they are shown (WL132).
	if got, named := session.Values["username"]; named {
		t.Fatalf("the session carries a name: %#v", got)
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
	if err := setAuthenticatedSessionIdentity(secondSession, 42); err != nil {
		t.Fatalf("second sign-in returned error: %v", err)
	}
	secondSignInID, _ := sign_in_revocation.SessionValue(secondSession)
	if secondSignInID == firstSignInID {
		t.Fatal("two sign-ins of the same person share one identity, so signing out of one would sign out both")
	}

	// And its last moment, without which the boundary refuses it outright. The
	// deadline is asserted here, in the setter's own test, because every other
	// place that exercises a signed-in session builds one by hand: removing the
	// production line that writes it would leave all of those green.
	expiresAt, dated := sign_in_deadline.SessionValue(session)
	if !dated {
		t.Fatal("a completed sign-in carries no deadline, so the shared boundary would refuse it")
	}
	if sign_in_deadline.Unlimited(expiresAt) {
		t.Fatal("a sign-in made under an ordinary limit was given no deadline at all")
	}
	if expiresAt <= time.Now().Unix() {
		t.Fatalf("the sign-in ends at %v, which has already passed", time.Unix(expiresAt, 0))
	}
}

// Signing in has to ask everything that can fail before it writes anything. The
// session belongs to the whole request -- the audit stage reads it after the
// handler returns -- so an identity left half written by a failure part way
// through would be read by whatever looked next, and a browser that was already
// signed in would have its working identity replaced by a broken one.
func TestAFailedSignInLeavesTheSessionExactlyAsItWas(t *testing.T) {
	origGuest, origAdmin, origConfidential := backend.DbGuest, backend.DbAdmin, backend.DbConfidential
	origDb := backend.Db
	// Everything this sign-in needs is answered except the one read that decides
	// its deadline, so the failure lands exactly where the ordering matters and
	// not at the first step.
	database := openCredentialMockDB(t, credentialMockConfig{
		adminGroupMember: true, authGeneration: 7, signInLimitError: true,
	})
	backend.DbGuest, backend.DbAdmin, backend.DbConfidential = database, nil, database
	backend.Db = database
	t.Cleanup(func() {
		backend.DbGuest, backend.DbAdmin, backend.DbConfidential = origGuest, origAdmin, origConfidential
		backend.Db = origDb
	})

	// A browser that is already signed in, with everything a real one carries.
	before := map[interface{}]interface{}{
		"authenticated":               true,
		"user_id":                     9,
		"username":                    "someone-else",
		"user_role":                   "basic",
		"authentication_generation":   int64(3),
		sign_in_revocation.SessionKey: "the-sign-in-already-here",
		sign_in_deadline.SessionKey:   time.Now().Add(72 * time.Hour).Unix(),
	}
	session := &sessions.Session{Values: map[interface{}]interface{}{}}
	for key, value := range before {
		session.Values[key] = value
	}

	if err := setAuthenticatedSessionIdentity(session, 42); err == nil {
		t.Fatal("signing in succeeded although the sign-in limit could not be read")
	}

	for key, want := range before {
		if got := session.Values[key]; got != want {
			t.Fatalf("a failed sign-in changed %v from %#v to %#v; the session was written before everything that can fail had been asked",
				key, want, got)
		}
	}
	if len(session.Values) != len(before) {
		t.Fatalf("a failed sign-in left %d values behind, want the %d that were there",
			len(session.Values), len(before))
	}
}

func TestLocalLoginFactorAttemptsAreEnvironmentIndependent(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	session := &sessions.Session{Values: map[interface{}]interface{}{}}
	setPendingLoginState(session, 42, "fingerprint", 1)

	for expected := 4; expected >= 0; expected-- {
		if got := localLoginFactorAttemptsRemaining(session, false); got != expected {
			t.Fatalf("attempts remaining = %d, want %d", got, expected)
		}
	}
	if got := localLoginFactorAttemptsRemaining(session, false); got != 0 {
		t.Fatalf("attempts remaining after lock = %d, want 0", got)
	}
}
