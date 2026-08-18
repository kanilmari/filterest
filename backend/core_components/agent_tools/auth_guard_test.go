// auth_guard_test.go
// Verifies private agent-tool endpoints reject anonymous and guest sessions.
// Bridges test sessions, handler dispatchers, and the agent-tools auth guard.
// Exists to keep task and inter-agent data from regressing to public browsing access.
package agent_tools

import (
	"net/http"
	"net/http/httptest"
	"testing"

	e_sessions "easelect/backend/core_components/sessions"

	gorillaSessions "github.com/gorilla/sessions"
)

func setupAgentToolAuthGuardTestStore(t *testing.T) *gorillaSessions.CookieStore {
	t.Helper()

	origStore := e_sessions.Store
	origName := e_sessions.SessionName
	testStore := gorillaSessions.NewCookieStore([]byte("agent-tool-auth-guard-test-secret"))
	testStore.Options = &gorillaSessions.Options{
		Path:     "/",
		MaxAge:   3600,
		HttpOnly: true,
		Secure:   false,
	}
	e_sessions.Store = testStore
	e_sessions.SessionName = "session"
	t.Cleanup(func() {
		e_sessions.Store = origStore
		e_sessions.SessionName = origName
	})

	return testStore
}

func requestWithAgentToolSession(t *testing.T, store *gorillaSessions.CookieStore, values map[interface{}]interface{}) *http.Request {
	t.Helper()

	cookieRecorder := httptest.NewRecorder()
	cookieRequest := httptest.NewRequest(http.MethodGet, "/api/app/agent-tools/tasks", nil)
	session, err := store.Get(cookieRequest, e_sessions.SessionName)
	if err != nil {
		t.Fatalf("store.Get setup: %v", err)
	}
	for key, value := range values {
		session.Values[key] = value
	}
	if err := session.Save(cookieRequest, cookieRecorder); err != nil {
		t.Fatalf("session.Save setup: %v", err)
	}

	request := httptest.NewRequest(http.MethodGet, "/api/app/agent-tools/tasks", nil)
	for _, cookie := range cookieRecorder.Result().Cookies() {
		request.AddCookie(cookie)
	}
	return request
}

func TestRequireAuthenticatedAgentToolUserRejectsGuestAndUnauthenticatedSessions(t *testing.T) {
	store := setupAgentToolAuthGuardTestStore(t)

	tests := []struct {
		name    string
		values  map[interface{}]interface{}
		wantOK  bool
		want401 bool
	}{
		{
			name:    "no identity",
			values:  map[interface{}]interface{}{},
			want401: true,
		},
		{
			name: "guest even if marked authenticated",
			values: map[interface{}]interface{}{
				"user_id":       1,
				"authenticated": true,
			},
			want401: true,
		},
		{
			name: "non guest without authenticated flag",
			values: map[interface{}]interface{}{
				"user_id": 42,
			},
			want401: true,
		},
		{
			name: "real authenticated user",
			values: map[interface{}]interface{}{
				"user_id":       42,
				"authenticated": true,
			},
			wantOK: true,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			request := requestWithAgentToolSession(t, store, tt.values)
			recorder := httptest.NewRecorder()

			gotOK := requireAuthenticatedAgentToolUser(recorder, request)
			if gotOK != tt.wantOK {
				t.Fatalf("requireAuthenticatedAgentToolUser() = %v, want %v", gotOK, tt.wantOK)
			}
			if tt.want401 && recorder.Code != http.StatusUnauthorized {
				t.Fatalf("response code = %d, want %d", recorder.Code, http.StatusUnauthorized)
			}
		})
	}
}

func TestAgentToolDispatchersRejectAnonymousRequestsBeforeDBAccess(t *testing.T) {
	setupAgentToolAuthGuardTestStore(t)

	tests := []struct {
		name    string
		handler http.HandlerFunc
		path    string
	}{
		{name: "tasks", handler: TasksHandler, path: "/api/app/agent-tools/tasks"},
		{name: "task runs", handler: TaskRunsHandler, path: "/api/app/agent-tools/task-runs"},
		{name: "bee messages", handler: BeeMessagesHandler, path: "/api/app/bee/messages"},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, tt.path, nil)
			recorder := httptest.NewRecorder()

			tt.handler(recorder, request)
			if recorder.Code != http.StatusUnauthorized {
				t.Fatalf("%s response code = %d, want %d", tt.name, recorder.Code, http.StatusUnauthorized)
			}
		})
	}
}
