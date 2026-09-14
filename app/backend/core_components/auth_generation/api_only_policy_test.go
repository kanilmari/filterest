// api_only_policy_test.go
// Tests channel discrimination and protected signed-session requirements.
// Bridges public request inputs with the API-only policy's trusted state.
// Exists to prove headers alone cannot authenticate or revive an old cookie.
package auth_generation

import (
	"context"
	"github.com/gorilla/sessions"
	"net/http/httptest"
	"testing"
)

func TestAutomationAPIRequestRequiresMatchedAPIAndExactHeader(t *testing.T) {
	for _, tc := range []struct {
		name, path, pattern, header string
		valid                       bool
	}{
		{"api", "/api/get-results", "/api/get-results", "1", true},
		{"missing", "/api/get-results", "/api/get-results", "", false},
		{"wrong", "/api/get-results", "/api/get-results", "true", false},
		{"html", "/app", "/", "1", false},
		{"catchall", "/api/unknown", "/", "1", false},
		{"actual html", "/app", "/api/get-results", "1", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest("GET", tc.path, nil)
			if tc.header != "" {
				r.Header.Set(AutomationHeader, tc.header)
			}
			if got := AutomationAPIRequest(r, tc.pattern); got != tc.valid {
				t.Fatalf("got %v", got)
			}
		})
	}
	r := httptest.NewRequest("GET", "/api/a", nil)
	r.Header.Add(AutomationHeader, "1")
	r.Header.Add(AutomationHeader, "1")
	if AutomationAPIRequest(r, "/api/a") {
		t.Fatal("multiple headers accepted")
	}
	if AutomationAPIRequest(nil, "/api/a") {
		t.Fatal("nil request accepted")
	}
}

func TestProtectedAutomationSessionRequirements(t *testing.T) {
	for _, tc := range []struct {
		name                                string
		api, enabled, marker, authenticated bool
		current, stored                     int64
		valid                               bool
	}{
		{"valid", true, true, true, true, 4, 4, true},
		{"legacy", true, true, false, true, 4, 4, false},
		{"revoked", true, false, true, true, 4, 4, false},
		{"stale", true, true, true, true, 5, 4, false},
		{"missing generation", true, true, true, true, 4, 0, false},
		{"not authenticated", true, true, true, false, 4, 4, false},
		{"ordinary", false, true, true, true, 4, 4, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := sessions.NewSession(sessions.NewCookieStore([]byte("test-key")), "test")
			s.Values[SessionKey] = tc.stored
			s.Values[AutomationSessionKey] = tc.marker
			s.Values["authenticated"] = tc.authenticated
			state := APIAccessState{tc.api, tc.current, tc.enabled}
			if state.MatchesAutomationSession(s) != tc.valid {
				t.Fatal("unexpected match")
			}
		})
	}
	if (APIAccessState{true, 4, true}).MatchesAutomationSession(nil) {
		t.Fatal("nil session accepted")
	}
	if _, err := LoadAPIAccessState(context.Background(), nil, 42); err == nil {
		t.Fatal("missing DB accepted")
	}
}
