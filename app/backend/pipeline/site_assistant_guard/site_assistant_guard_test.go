// site_assistant_guard_test.go
// Verifies that an assistant session reads freely, writes only approved calls and dies with its delegation.
// Bridges the in-process delegation store and the always-enforced pipeline guard.
// Exists so an unapproved or expired assistant write can never reach a handler.
package site_assistant_guard

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	e_sessions "easelect/backend/core_components/sessions"
	"easelect/backend/core_components/site_assistant"

	gorilla "github.com/gorilla/sessions"
)

func setupGuardSessionStore(t *testing.T) *gorilla.CookieStore {
	t.Helper()
	originalStore, originalName := e_sessions.Store, e_sessions.SessionName
	store := gorilla.NewCookieStore([]byte("guard-test-secret-key-32-bytes!!"))
	store.Options = &gorilla.Options{Path: "/", MaxAge: 3600, HttpOnly: true}
	e_sessions.Store = store
	e_sessions.SessionName = "session"
	t.Cleanup(func() { e_sessions.Store, e_sessions.SessionName = originalStore, originalName })
	return store
}

func requestWithAssistantSession(t *testing.T, store *gorilla.CookieStore, method string, target string, body string, values map[string]interface{}) *http.Request {
	t.Helper()
	recorder := httptest.NewRecorder()
	prepare := httptest.NewRequest(http.MethodGet, "/", nil)
	session, err := store.Get(prepare, e_sessions.SessionName)
	if err != nil {
		t.Fatalf("session: %v", err)
	}
	for key, value := range values {
		session.Values[key] = value
	}
	if err := session.Save(prepare, recorder); err != nil {
		t.Fatalf("save session: %v", err)
	}

	var request *http.Request
	if body == "" {
		request = httptest.NewRequest(method, target, nil)
	} else {
		request = httptest.NewRequest(method, target, strings.NewReader(body))
	}
	for _, cookie := range recorder.Result().Cookies() {
		request.AddCookie(cookie)
	}
	return request
}

func echoHandler(seen *string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		*seen = string(body)
		w.WriteHeader(http.StatusOK)
	}
}

func issueGuardDelegation(t *testing.T) (*site_assistant.Store, *site_assistant.Delegation) {
	t.Helper()
	store := site_assistant.NewStore()
	_, delegation, err := store.Issue(40861, "test_admin_12", "job-guard", "localhost", 10*time.Minute)
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	return store, delegation
}

func TestGuardIgnoresOrdinaryRequests(t *testing.T) {
	sessionStore := setupGuardSessionStore(t)
	delegationStore, _ := issueGuardDelegation(t)
	var seen string

	recorder := httptest.NewRecorder()
	WithSiteAssistantGuardStore(delegationStore, echoHandler(&seen))(recorder,
		httptest.NewRequest(http.MethodPost, "/api/update-row", strings.NewReader(`{"id":1}`)))
	if recorder.Code != http.StatusOK || seen != `{"id":1}` {
		t.Fatalf("request without a session must pass: %d %q", recorder.Code, seen)
	}

	seen = ""
	recorder = httptest.NewRecorder()
	request := requestWithAssistantSession(t, sessionStore, http.MethodPost, "/api/update-row", `{"id":2}`,
		map[string]interface{}{"user_id": 40861})
	WithSiteAssistantGuardStore(delegationStore, echoHandler(&seen))(recorder, request)
	if recorder.Code != http.StatusOK || seen != `{"id":2}` {
		t.Fatalf("an ordinary administrator session must pass: %d %q", recorder.Code, seen)
	}
}

func TestGuardAllowsAssistantReadsAndBlocksUnapprovedWrites(t *testing.T) {
	sessionStore := setupGuardSessionStore(t)
	delegationStore, delegation := issueGuardDelegation(t)
	sessionValues := map[string]interface{}{
		"user_id":                           40861,
		site_assistant.SessionDelegationKey: delegation.ID,
	}
	var seen string

	readRecorder := httptest.NewRecorder()
	WithSiteAssistantGuardStore(delegationStore, echoHandler(&seen))(readRecorder,
		requestWithAssistantSession(t, sessionStore, http.MethodGet, "/api/get-results?dataset=x", "", sessionValues))
	if readRecorder.Code != http.StatusOK {
		t.Fatalf("assistant read = %d", readRecorder.Code)
	}

	writeRecorder := httptest.NewRecorder()
	WithSiteAssistantGuardStore(delegationStore, echoHandler(&seen))(writeRecorder,
		requestWithAssistantSession(t, sessionStore, http.MethodPost, "/api/update-row", `{"id":3}`, sessionValues))
	if writeRecorder.Code != http.StatusForbidden {
		t.Fatalf("unapproved assistant write = %d", writeRecorder.Code)
	}
	var refusal struct {
		Error string            `json:"error"`
		Call  map[string]string `json:"call"`
	}
	if err := json.Unmarshal(writeRecorder.Body.Bytes(), &refusal); err != nil {
		t.Fatalf("refusal body: %v", err)
	}
	if refusal.Error != "site_assistant_approval_required" ||
		refusal.Call["path"] != "/api/update-row" ||
		refusal.Call["body_sha256"] != site_assistant.HashRequestBody([]byte(`{"id":3}`)) {
		t.Fatalf("refusal must describe the call for the plan: %+v", refusal)
	}
}

func TestGuardRunsAnApprovedWriteExactlyOnceAndKeepsTheBody(t *testing.T) {
	sessionStore := setupGuardSessionStore(t)
	delegationStore, delegation := issueGuardDelegation(t)
	body := `{"id":4,"updates":[{"column":"header","value":"New"}]}`
	if err := delegationStore.Approve(delegation.ID, []site_assistant.ApprovedCall{{
		Method: http.MethodPost, Path: "/api/update-row", BodyHash: site_assistant.HashRequestBody([]byte(body)),
	}}); err != nil {
		t.Fatalf("Approve: %v", err)
	}
	sessionValues := map[string]interface{}{
		"user_id":                           40861,
		site_assistant.SessionDelegationKey: delegation.ID,
	}
	var seen string

	first := httptest.NewRecorder()
	WithSiteAssistantGuardStore(delegationStore, echoHandler(&seen))(first,
		requestWithAssistantSession(t, sessionStore, http.MethodPost, "/api/update-row", body, sessionValues))
	if first.Code != http.StatusOK || seen != body {
		t.Fatalf("approved write = %d, handler saw %q", first.Code, seen)
	}

	second := httptest.NewRecorder()
	WithSiteAssistantGuardStore(delegationStore, echoHandler(&seen))(second,
		requestWithAssistantSession(t, sessionStore, http.MethodPost, "/api/update-row", body, sessionValues))
	if second.Code != http.StatusForbidden {
		t.Fatalf("a repeated approved write = %d, want 403", second.Code)
	}
}

func TestGuardRejectsExpiredDelegationAndForeignUser(t *testing.T) {
	sessionStore := setupGuardSessionStore(t)
	delegationStore, delegation := issueGuardDelegation(t)
	var seen string

	expiredRecorder := httptest.NewRecorder()
	delegationStore.Revoke(delegation.ID)
	WithSiteAssistantGuardStore(delegationStore, echoHandler(&seen))(expiredRecorder,
		requestWithAssistantSession(t, sessionStore, http.MethodGet, "/api/get-results", "", map[string]interface{}{
			"user_id": 40861, site_assistant.SessionDelegationKey: delegation.ID,
		}))
	if expiredRecorder.Code != http.StatusUnauthorized {
		t.Fatalf("revoked delegation = %d, want 401", expiredRecorder.Code)
	}

	liveStore, live := issueGuardDelegation(t)
	mismatchRecorder := httptest.NewRecorder()
	WithSiteAssistantGuardStore(liveStore, echoHandler(&seen))(mismatchRecorder,
		requestWithAssistantSession(t, sessionStore, http.MethodGet, "/api/get-results", "", map[string]interface{}{
			"user_id": 40787, site_assistant.SessionDelegationKey: live.ID,
		}))
	if mismatchRecorder.Code != http.StatusUnauthorized {
		t.Fatalf("session user differing from the delegation = %d, want 401", mismatchRecorder.Code)
	}
}
