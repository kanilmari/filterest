// site_assistant_delegation_handler_test.go
// Verifies the one-time exchange that gives an assistant job the asking administrator's session.
// Bridges the delegation store, the session identity contract and the HTTP route.
// Exists so a wrong, replayed or expired code never produces a working session.
package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	e_sessions "easelect/backend/core_components/sessions"
	"easelect/backend/core_components/site_assistant"

	gorilla "github.com/gorilla/sessions"
)

func setupExchangeTest(t *testing.T) (*site_assistant.Store, *gorilla.CookieStore) {
	t.Helper()
	originalStore, originalName := e_sessions.Store, e_sessions.SessionName
	originalDelegations, originalIdentity := siteAssistantDelegationStore, siteAssistantIdentitySetter

	sessionStore := gorilla.NewCookieStore([]byte("exchange-test-secret-key-32byte!"))
	sessionStore.Options = &gorilla.Options{Path: "/", MaxAge: 3600, HttpOnly: true}
	e_sessions.Store = sessionStore
	e_sessions.SessionName = "session"
	siteAssistantDelegationStore = site_assistant.NewStore()
	siteAssistantIdentitySetter = func(session *gorilla.Session, userID int, username string) error {
		session.Values["authenticated"] = true
		session.Values["user_id"] = userID
		session.Values["username"] = username
		return nil
	}
	t.Cleanup(func() {
		e_sessions.Store, e_sessions.SessionName = originalStore, originalName
		siteAssistantDelegationStore, siteAssistantIdentitySetter = originalDelegations, originalIdentity
	})
	return siteAssistantDelegationStore, sessionStore
}

func exchange(t *testing.T, body string) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/site-assistant/delegation/exchange", strings.NewReader(body))
	SiteAssistantDelegationExchangeHandler(recorder, request)
	return recorder
}

func TestExchangeGivesTheAskingAdministratorsSessionOnce(t *testing.T) {
	store, sessionStore := setupExchangeTest(t)
	code, delegation, err := store.Issue(40861, "test_admin_12", "job-exchange", "localhost", 10*time.Minute)
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}

	recorder := exchange(t, `{"code":`+quoteForJSON(code)+`}`)
	if recorder.Code != http.StatusOK {
		t.Fatalf("exchange = %d %s", recorder.Code, recorder.Body.String())
	}
	var response map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("response: %v", err)
	}
	if response["authenticated"] != true || response["delegation_id"] != delegation.ID || response["username"] != "test_admin_12" {
		t.Fatalf("unexpected response: %+v", response)
	}
	if recorder.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("the exchange response must not be cached")
	}

	cookies := recorder.Result().Cookies()
	carrier := httptest.NewRequest(http.MethodGet, "/", nil)
	for _, cookie := range cookies {
		carrier.AddCookie(cookie)
	}
	session, err := sessionStore.Get(carrier, e_sessions.SessionName)
	if err != nil {
		t.Fatalf("session: %v", err)
	}
	if session.Values["user_id"] != 40861 || session.Values[site_assistant.SessionDelegationKey] != delegation.ID {
		t.Fatalf("session values = %+v", session.Values)
	}
	if session.Values["device_id"] == "" || session.Values["fingerprint_hash"] == "" {
		t.Fatal("the runner session needs its own device and fingerprint values")
	}

	if replay := exchange(t, `{"code":`+quoteForJSON(code)+`}`); replay.Code != http.StatusUnauthorized {
		t.Fatalf("replayed code = %d, want 401", replay.Code)
	}
}

func TestExchangeRefusesBadRequests(t *testing.T) {
	store, _ := setupExchangeTest(t)
	code, _, err := store.Issue(40861, "test_admin_12", "job-bad", "localhost", 10*time.Minute)
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}

	if unknown := exchange(t, `{"code":"fsa1_wrong"}`); unknown.Code != http.StatusUnauthorized {
		t.Fatalf("unknown code = %d, want 401", unknown.Code)
	}
	if empty := exchange(t, `{}`); empty.Code != http.StatusBadRequest {
		t.Fatalf("missing code = %d, want 400", empty.Code)
	}
	if broken := exchange(t, `not-json`); broken.Code != http.StatusBadRequest {
		t.Fatalf("invalid JSON = %d, want 400", broken.Code)
	}

	getRecorder := httptest.NewRecorder()
	SiteAssistantDelegationExchangeHandler(getRecorder, httptest.NewRequest(http.MethodGet, "/api/site-assistant/delegation/exchange", nil))
	if getRecorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET = %d, want 405", getRecorder.Code)
	}

	// The valid code still works, so the refusals above consumed nothing.
	if ok := exchange(t, `{"code":`+quoteForJSON(code)+`}`); ok.Code != http.StatusOK {
		t.Fatalf("valid code after refusals = %d", ok.Code)
	}
}

func TestExchangeRefusesAnIdentityThatCannotLogIn(t *testing.T) {
	store, _ := setupExchangeTest(t)
	siteAssistantIdentitySetter = func(*gorilla.Session, int, string) error { return errLoginNotAllowedForTest }
	code, delegation, err := store.Issue(40861, "test_admin_12", "job-denied", "localhost", 10*time.Minute)
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	if recorder := exchange(t, `{"code":`+quoteForJSON(code)+`}`); recorder.Code != http.StatusForbidden {
		t.Fatalf("denied identity = %d, want 403", recorder.Code)
	}
	if _, err := store.Lookup(delegation.ID); err == nil {
		t.Fatal("a refused exchange must revoke the delegation")
	}
}

var errLoginNotAllowedForTest = errTestLoginDenied{}

type errTestLoginDenied struct{}

func (errTestLoginDenied) Error() string { return "login not allowed" }

func quoteForJSON(value string) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}
