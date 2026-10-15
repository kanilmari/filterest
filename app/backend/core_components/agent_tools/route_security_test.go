// route_security_test.go
// Exercises every declared agent-tools method for all four caller identities.
// Bridges real route registrations, real security middleware and real CRUD handlers.
// Exists to detect profile regressions even when an ordinary user holds a route grant.
package agent_tools

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"easelect/backend/core_components/auth_generation"
	e_sessions "easelect/backend/core_components/sessions"
	"easelect/backend/core_components/sign_in_deadline"
	"easelect/backend/core_components/sign_in_revocation"
	"easelect/backend/pipeline"

	gorillaSessions "github.com/gorilla/sessions"
)

func agentToolMethodRequest(t *testing.T, store *gorillaSessions.CookieStore, route agentToolRouteFixture, method string, userID int) *http.Request {
	t.Helper()
	var body any
	switch {
	case strings.HasSuffix(route.path, "/tasks"):
		body = map[string]any{"id": 4, "title": "Fixture task", "issue_type": "task"}
	case strings.HasSuffix(route.path, "/task-runs"):
		body = map[string]any{"id": 4, "task_id": 4, "run_id": "sec1-run", "triggered_by": "manual", "status": "queued"}
	case strings.HasSuffix(route.path, "/task-todos"):
		body = map[string]any{"id": 4, "task_id": 4, "todo_text": "Fixture todo", "sort_order": 10}
	case strings.HasSuffix(route.path, "/task-groups"):
		body = map[string]any{"slug": "sec1-group", "title": "Fixture group"}
	case strings.HasSuffix(route.path, "/worklines"):
		body = map[string]any{"id": 4, "title": "Fixture workline", "status": "active"}
	case strings.HasSuffix(route.path, "/workline-reports"):
		body = validStructuredReportRequest()
		if method == http.MethodPut || method == http.MethodPatch {
			body = map[string]any{"id": 4, "state": "archived"}
		}
	case strings.HasSuffix(route.path, "/workline-tasks"):
		body = map[string]any{"workline_id": 4, "task_id": 4}
	case strings.HasSuffix(route.path, "/handover-reports"):
		body = map[string]any{"title": "Fixture handover", "items": []any{map[string]any{"workline_id": 4, "workline_report_id": 4}}}
		if method == http.MethodPut || method == http.MethodPatch {
			body = map[string]any{"id": 4, "state": "archived"}
		}
	default:
		t.Fatalf("new route %s needs a valid method fixture", route.path)
	}
	payload, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	target := route.path
	if method == http.MethodDelete || (strings.HasSuffix(route.path, "/task-groups") && method != http.MethodGet && method != http.MethodPost) {
		target += "?id=4&task_id=4&workline_id=4"
	} else if method == http.MethodGet && strings.HasSuffix(route.path, "/task-todos") {
		target += "?task_id=4"
	}
	req := httptest.NewRequest(method, target, bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if userID == 0 {
		return req
	}
	// All signed-in callers receive a valid CSRF proof, including denied users,
	// so a forgery refusal cannot disguise a missing administrator boundary.
	session, err := store.Get(req, e_sessions.SessionName)
	if err != nil {
		t.Fatal(err)
	}
	session.Values["user_id"] = userID
	session.Values["authenticated"] = userID > 1
	session.Values["csrf_token"] = "sec1-synthetic-csrf-proof"
	session.Values[auth_generation.SessionKey] = int64(1)
	session.Values[sign_in_revocation.SessionKey] = strings.Repeat("a", 64)
	session.Values[sign_in_deadline.SessionKey] = time.Now().Add(time.Hour).Unix()
	cookies := httptest.NewRecorder()
	if err := session.Save(req, cookies); err != nil {
		t.Fatal(err)
	}
	for _, cookie := range cookies.Result().Cookies() {
		req.AddCookie(cookie)
	}
	req.Header.Set("X-CSRF-Token", "sec1-synthetic-csrf-proof")
	return req
}

func TestAgentToolRouteMethodAuthorization(t *testing.T) {
	store := setupAgentToolAuthGuardTestStore(t)
	setupAgentToolSecurityStages(t)
	routes := agentToolRegisteredRoutes()
	if len(routes) != 8 {
		t.Fatalf("got %d routes, want all eight", len(routes))
	}
	methodCount := 0
	for _, route := range routes {
		if len(route.methods) == 0 {
			t.Fatalf("%s has no declared methods", route.path)
		}
		for _, method := range route.methods {
			methodCount++
			for _, caller := range []struct {
				name   string
				userID int
				admin  bool
				want   int
			}{
				{"non-admin-with-grant", 42, false, http.StatusForbidden},
				{"anonymous", 0, false, http.StatusForbidden},
				{"guest-public-browsing", 1, false, http.StatusForbidden},
				{"admin-with-grant", 43, true, http.StatusOK},
			} {
				t.Run(strings.TrimPrefix(route.path, "/api/app/agent-tools/")+"/"+method+"/"+caller.name, func(t *testing.T) {
					fixture := &agentToolSQLFixture{admin: caller.admin, grant: true, loginToBrowse: caller.userID != 1}
					installAgentToolSQLFixture(t, fixture)
					req := agentToolMethodRequest(t, store, route, method, caller.userID)
					response := httptest.NewRecorder()
					ctx := pipeline.RouteContext{URLPattern: route.path, HandlerName: route.name}
					pipeline.BuildHandler(route.handler, ctx, pipeline.GetProfile(route.name))(response, req)
					want := caller.want
					if caller.admin && method == http.MethodPost {
						want = http.StatusCreated
					}
					if response.Code != want {
						t.Fatalf("status=%d, want %d; business calls=%d; body=%s", response.Code, want, fixture.businessCalls, response.Body.String())
					}
					if caller.name == "anonymous" && !strings.Contains(response.Body.String(), `"auth_failure":true`) {
						t.Fatalf("anonymous response is not the sign-in answer: %s", response.Body.String())
					}
					if !caller.admin && fixture.businessCalls != 0 {
						t.Fatalf("denied caller reached %d business operations", fixture.businessCalls)
					}
					if caller.admin && (fixture.businessCalls == 0 || fixture.grantChecks == 0) {
						t.Fatalf("admin success missed handler or grant check: %+v", fixture)
					}
				})
			}
		}
	}
	t.Logf("covered %d routes x declared methods = %d method contracts, four callers = %d cases", len(routes), methodCount, methodCount*4)
}

func TestAgentToolAdminsStillNeedRouteGrantAndCSRF(t *testing.T) {
	store := setupAgentToolAuthGuardTestStore(t)
	setupAgentToolSecurityStages(t)
	for _, route := range agentToolRegisteredRoutes() {
		for _, method := range route.methods {
			for _, missing := range []string{"grant", "csrf"} {
				if missing == "csrf" && method == http.MethodGet {
					continue
				}
				t.Run(route.name+"/"+method+"/missing-"+missing, func(t *testing.T) {
					fixture := &agentToolSQLFixture{admin: true, grant: missing != "grant", loginToBrowse: true}
					installAgentToolSQLFixture(t, fixture)
					req := agentToolMethodRequest(t, store, route, method, 43)
					if missing == "csrf" {
						req.Header.Del("X-CSRF-Token")
					}
					response := httptest.NewRecorder()
					ctx := pipeline.RouteContext{URLPattern: route.path, HandlerName: route.name}
					pipeline.BuildHandler(route.handler, ctx, pipeline.GetProfile(route.name))(response, req)
					if response.Code != http.StatusForbidden || fixture.businessCalls != 0 {
						t.Fatalf("missing %s: status=%d, business calls=%d", missing, response.Code, fixture.businessCalls)
					}
				})
			}
		}
	}
}
