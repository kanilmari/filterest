// filterbar_ai_coding_agent_handler_test.go
// Checks policy, trusted actors and durable-job dispatch through the Codex route.
// Bridges existing AdminProfile semantics with production and development modes.
// Uses fake runner calls only, without credentials or paid model requests.
package dtt_1_row_read

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"easelect/backend/core_components/dbutils"
	e_sessions "easelect/backend/core_components/sessions"
	"easelect/backend/core_components/site_assistant"

	gorilla "github.com/gorilla/sessions"
)

func codingAgentRequest(method, path, body, role string) *http.Request {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	return r.WithContext(dbutils.SetRequestActorContext(r.Context(), dbutils.NewRequestActorContext(42, role)))
}

// codingAgentSessionRequest adds the authenticated administrator session that a
// dispatched job needs in order to receive its own site access.
func codingAgentSessionRequest(t *testing.T, method, path, body, role, username string) *http.Request {
	t.Helper()
	request := codingAgentRequest(method, path, body, role)
	store := gorilla.NewCookieStore([]byte("coding-agent-test-secret-32bytes"))
	originalStore, originalName := e_sessions.Store, e_sessions.SessionName
	e_sessions.Store, e_sessions.SessionName = store, "session"
	t.Cleanup(func() { e_sessions.Store, e_sessions.SessionName = originalStore, originalName })

	recorder := httptest.NewRecorder()
	session, err := store.Get(httptest.NewRequest(http.MethodGet, "/", nil), e_sessions.SessionName)
	if err != nil {
		t.Fatalf("session: %v", err)
	}
	session.Values["user_id"] = 42
	session.Values["username"] = username
	if err := session.Save(httptest.NewRequest(http.MethodGet, "/", nil), recorder); err != nil {
		t.Fatalf("save session: %v", err)
	}
	for _, cookie := range recorder.Result().Cookies() {
		request.AddCookie(cookie)
	}
	return request
}
func TestCodingAgentAvailabilityEnvironmentPolicyAndActor(t *testing.T) {
	old := codingAgentPolicyReader
	defer func() { codingAgentPolicyReader = old }()
	for _, environment := range []string{"dev", "prod"} {
		for _, devOnly := range []bool{true, false} {
			for _, role := range []string{"admin", "basic", "guest"} {
				t.Run(environment+"/"+role+"/"+map[bool]string{true: "true", false: "false"}[devOnly], func(t *testing.T) {
					t.Setenv("ENVIRONMENT_TYPE", environment)
					t.Setenv("FILTEREST_CODING_AGENT_SOCKET", "")
					codingAgentPolicyReader = func(context.Context) (bool, error) { return devOnly, nil }
					rec := httptest.NewRecorder()
					FilterbarAICodexQueryHandler(rec, codingAgentRequest("GET", "/api/app/ai-chat/codex-query", "", ""+role))
					if role != "admin" {
						if rec.Code != 403 {
							t.Fatal(rec.Code)
						}
						return
					}
					var result codingAgentAvailability
					json.Unmarshal(rec.Body.Bytes(), &result)
					if rec.Code != 200 || result.FeatureEnabled != (environment == "dev" || !devOnly) || result.DevOnly != devOnly {
						t.Fatalf("%d %s", rec.Code, rec.Body.String())
					}
					if environment == "prod" && result.RunnerReady {
						t.Fatal("unconfigured production runner marked ready")
					}
				})
			}
		}
	}
}
func TestCodingAgentExternalDispatchAndOwnerStatus(t *testing.T) {
	oldReader, oldCall := codingAgentPolicyReader, codingAgentSocketCall
	defer func() { codingAgentPolicyReader = oldReader; codingAgentSocketCall = oldCall }()
	t.Setenv("ENVIRONMENT_TYPE", "prod")
	t.Setenv("FILTEREST_CODING_AGENT_SOCKET", "/fixture/socket")
	codingAgentPolicyReader = func(context.Context) (bool, error) { return false, nil }
	t.Setenv("APP_PORT", "8193")
	t.Setenv("FILTEREST_CODING_AGENT_SITE_ID", "fixture.test")
	calls := 0
	var dispatchedCode string
	codingAgentSocketCall = func(_ context.Context, method, path string, actor int, payload interface{}, result interface{}) (int, error) {
		calls++
		if actor != 42 {
			t.Fatal("browser identity used")
		}
		job := result.(*codingAgentJobResult)
		job.JobID = "00000000-0000-0000-0000-000000000001"
		job.Dataset = "fixture"
		job.Status = "running"
		if method == "POST" {
			runnerPayload, ok := payload.(codingAgentRunnerPayload)
			if !ok || path != "/v1/jobs" || runnerPayload.Query != "Fix code" {
				t.Fatalf("unexpected dispatch: %s %#v", path, payload)
			}
			access := runnerPayload.SiteAssistant
			if access == nil || !strings.HasPrefix(access.DelegationCode, site_assistant.DelegationCodePrefix) ||
				access.SiteBaseURL != "http://127.0.0.1:8193" ||
				access.CatalogRoute != "/api/admin/site-assistant/api-catalog" {
				t.Fatalf("the job needs its own site access: %#v", access)
			}
			dispatchedCode = access.DelegationCode
			return 202, nil
		}
		if path != "/v1/jobs/"+job.JobID+"?dataset=fixture" {
			t.Fatal(path)
		}
		job.Status = "completed"
		job.Answer = "Verified fixture edit"
		return 200, nil
	}
	body := `{"dataset":"fixture","query":"Fix code","request_id":"00000000-0000-0000-0000-000000000001"}`
	rec := httptest.NewRecorder()
	FilterbarAICodexQueryHandler(rec, codingAgentSessionRequest(t, "POST", "/api/app/ai-chat/codex-query", body, "admin", "test_admin_12"))
	if rec.Code != 202 {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), dispatchedCode) || strings.Contains(rec.Body.String(), "delegation") {
		t.Fatal("the job's site access must not reach the browser")
	}
	delegation, err := site_assistant.DefaultStore.ByJob("00000000-0000-0000-0000-000000000001")
	if err != nil || delegation.UserID != 42 || delegation.Username != "test_admin_12" {
		t.Fatalf("the job's delegation = %+v, %v", delegation, err)
	}
	t.Cleanup(func() { site_assistant.DefaultStore.Revoke(delegation.ID) })
	rec = httptest.NewRecorder()
	FilterbarAICodexQueryHandler(rec, codingAgentSessionRequest(t, "GET", "/api/app/ai-chat/codex-query?dataset=fixture&job_id=00000000-0000-0000-0000-000000000001", "", "admin", "test_admin_12"))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "Verified fixture edit") || calls != 2 {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
	rec = httptest.NewRecorder()
	FilterbarAICodexQueryHandler(rec, codingAgentSessionRequest(t, "POST", "/api/app/ai-chat/codex-query", body, "basic", "basic_user"))
	if rec.Code != 403 || calls != 2 {
		t.Fatal("non-admin dispatched")
	}
}

func TestDispatchWithoutSiteAccessDoesNotStartAJob(t *testing.T) {
	oldReader, oldCall := codingAgentPolicyReader, codingAgentSocketCall
	defer func() { codingAgentPolicyReader = oldReader; codingAgentSocketCall = oldCall }()
	t.Setenv("ENVIRONMENT_TYPE", "prod")
	t.Setenv("FILTEREST_CODING_AGENT_SOCKET", "/fixture/socket")
	t.Setenv("FILTEREST_SITE_ASSISTANT_BASE_URL", "")
	t.Setenv("APP_PORT", "")
	codingAgentPolicyReader = func(context.Context) (bool, error) { return false, nil }
	dispatched := false
	codingAgentSocketCall = func(context.Context, string, string, int, interface{}, interface{}) (int, error) {
		dispatched = true
		return 202, nil
	}

	body := `{"dataset":"fixture","query":"Fix code","request_id":"00000000-0000-0000-0000-000000000002"}`
	rec := httptest.NewRecorder()
	FilterbarAICodexQueryHandler(rec, codingAgentSessionRequest(t, "POST", "/api/app/ai-chat/codex-query", body, "admin", "test_admin_12"))
	if rec.Code != 503 || dispatched {
		t.Fatalf("a job without site access must not start: %d dispatched=%v", rec.Code, dispatched)
	}
}
func TestCodingAgentModelOverrideReachesActualCLIArguments(t *testing.T) {
	t.Setenv("FILTERBAR_AI_CODEX_MODEL", "fixture-model")
	args := buildFilterbarAICodexExecArgs(nil, "/fixture", "/answer")
	if !strings.Contains(strings.Join(args, " "), "--model fixture-model -") {
		t.Fatal(args)
	}
}
