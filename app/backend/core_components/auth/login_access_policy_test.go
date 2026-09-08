// login_access_policy_test.go
// Tests admission at password, pending-factor, legacy, and final session boundaries.
// Bridges the shared runtime policy with real auth handlers and signed test sessions.
// Prevents alternate sign-in forms or mid-challenge policy changes from bypassing admin-only mode.
package auth

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"github.com/gorilla/sessions"
	"golang.org/x/crypto/bcrypt"
)

func setupAdmissionFixture(t *testing.T, cfg credentialMockConfig) {
	t.Helper()
	old, guest, confidential := backend.Db, backend.DbGuest, backend.DbConfidential
	db := openCredentialMockDB(t, cfg)
	backend.Db, backend.DbGuest, backend.DbConfidential = db, db, db
	t.Cleanup(func() { backend.Db, backend.DbGuest, backend.DbConfidential = old, guest, confidential })
}

func TestAdminOnlyLoginBlocksAllChallengeMethodsBeforeSending(t *testing.T) {
	hash, err := bcrypt.GenerateFromPassword([]byte("synthetic-password"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	for _, method := range []loginVerificationMethod{verificationNone, verificationFixedPIN, verificationTOTP, verificationEmail} {
		t.Run(string(method), func(t *testing.T) {
			setupAdmissionFixture(t, credentialMockConfig{userID: 42, userLookupOK: true, hashedPassword: string(hash), verificationMethod: string(method), adminOnly: true, adminAllowed: true})
			store := prepareLoginHandlerSessionStore(t)
			req := httptest.NewRequest(http.MethodPost, "https://example.test/api/login", nil)
			session, err := store.New(req, "session")
			if err != nil {
				t.Fatal(err)
			}
			rr := httptest.NewRecorder()
			handleLoginCredentials(rr, req, session, loginJSONRequest{Username: "synthetic-user", Password: "synthetic-password", Fingerprint: "synthetic-fingerprint"})
			if rr.Code != http.StatusForbidden || decodeJSONBody(t, rr)["error"] != "login_not_allowed" {
				t.Fatalf("method %s was not denied: %d", method, rr.Code)
			}
			if _, ok := session.Values["otp_pending_user_id"]; ok {
				t.Fatal("disallowed account received a pending factor")
			}
			if _, ok := session.Values["authenticated"]; ok {
				t.Fatal("disallowed account acquired identity")
			}
		})
	}
}

func TestAdminOnlyLoginRechecksPendingFactorAndClearsChallenge(t *testing.T) {
	for _, method := range []loginVerificationMethod{verificationFixedPIN, verificationTOTP, verificationEmail} {
		t.Run(string(method), func(t *testing.T) {
			setupAdmissionFixture(t, credentialMockConfig{userID: 42, verificationMethod: string(method), adminOnly: true, adminAllowed: true})
			store := prepareLoginHandlerSessionStore(t)
			req := httptest.NewRequest(http.MethodPost, "https://example.test/api/login", nil)
			session, err := store.New(req, "session")
			if err != nil {
				t.Fatal(err)
			}
			setPendingLoginState(session, 42, "synthetic-user", "synthetic-fingerprint", 1)
			rr := httptest.NewRecorder()
			handleLoginOTPVerify(rr, req, session, loginJSONRequest{OTPCode: "123456"})
			if rr.Code != http.StatusForbidden {
				t.Fatalf("pending factor bypassed new policy: %d", rr.Code)
			}
			if _, ok := session.Values["otp_pending_user_id"]; ok {
				t.Fatal("disallowed pending identity remains")
			}
		})
	}
}

func TestSessionIdentityFinalizerCannotBypassCurrentAdmission(t *testing.T) {
	setupAdmissionFixture(t, credentialMockConfig{adminOnly: true, adminAllowed: true, adminGroupMember: false})
	session := &sessions.Session{Values: map[interface{}]interface{}{}}
	if err := setAuthenticatedSessionIdentityAtGeneration(session, 42, "synthetic-user", 1); !errors.Is(err, backend.ErrLoginNotAllowed) {
		t.Fatalf("finalizer did not deny non-admin: %v", err)
	}
	if len(session.Values) != 0 {
		t.Fatal("denied finalizer wrote authenticated identity")
	}
}

func TestCurrentAdminCanCompleteHiddenEntryLogin(t *testing.T) {
	setupAdmissionFixture(t, credentialMockConfig{adminOnly: true, adminAllowed: true, adminGroupMember: true})
	session := &sessions.Session{Values: map[interface{}]interface{}{}}
	if err := setAuthenticatedSessionIdentityAtGeneration(session, 42, "synthetic-admin", 1); err != nil {
		t.Fatal(err)
	}
	if session.Values["authenticated"] != true || session.Values["user_role"] != "admin" {
		t.Fatal("eligible administrator did not receive identity")
	}
}

func TestPolicyReadFailureClosesPendingLogin(t *testing.T) {
	setupAdmissionFixture(t, credentialMockConfig{policyError: true})
	store := prepareLoginHandlerSessionStore(t)
	req := httptest.NewRequest(http.MethodPost, "https://example.test/api/login", nil)
	session, err := store.New(req, "session")
	if err != nil {
		t.Fatal(err)
	}
	setPendingLoginState(session, 42, "synthetic-user", "synthetic-fingerprint", 1)
	rr := httptest.NewRecorder()
	handleLoginOTPVerify(rr, req, session, loginJSONRequest{OTPCode: "123456"})
	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("failed policy read accepted: %d", rr.Code)
	}
	if _, ok := session.Values["otp_pending_user_id"]; ok {
		t.Fatal("unverifiable challenge remains")
	}
}

func TestLegacyDevFormCannotBypassAdminOnlyLogin(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	hash, err := bcrypt.GenerateFromPassword([]byte("synthetic-password"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	setupAdmissionFixture(t, credentialMockConfig{userID: 42, userLookupOK: true, hashedPassword: string(hash), adminOnly: true, adminAllowed: true})
	store := setupAuthModesTestStore(t)
	req := buildAuthModesReq(t, store, "https://example.test/login", map[interface{}]interface{}{"csrf_token": "synthetic-csrf"})
	req.Method = http.MethodPost
	form := url.Values{"username": {"synthetic-user"}, "password": {"synthetic-password"}, "csrf_token": {"synthetic-csrf"}}
	req.Body = io.NopCloser(strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()
	handleLoginPost(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("legacy form bypassed admission: %d", rr.Code)
	}
}
