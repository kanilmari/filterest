// filterbar_ai_coding_agent_handler_test.go
// Checks per-mode policy, trusted actors and durable-job dispatch through the coding-agent route.
// Bridges existing AdminProfile semantics with development and production environments.
// Uses fake runner calls only, without credentials or paid model requests.
package dtt_1_row_read

import (
	"context"
	"encoding/json"
	"errors"
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

// fakeCodingAgentRunner answers the socket calls the route makes and records them.
func fakeCodingAgentRunner(t *testing.T, capabilities codingAgentRunnerCapabilities, onJob func(codingAgentRunnerPayload)) *int {
	t.Helper()
	oldReader, oldCall := codingAgentPolicyReader, codingAgentSocketCall
	t.Cleanup(func() { codingAgentPolicyReader = oldReader; codingAgentSocketCall = oldCall })
	codingAgentPolicyReader = func(context.Context) (bool, error) { return false, nil }
	calls := 0
	codingAgentSocketCall = func(_ context.Context, method, path string, actor int, payload interface{}, result interface{}) (int, error) {
		calls++
		if actor != 42 {
			t.Fatal("browser identity used")
		}
		if path == "/v1/capabilities" {
			*(result.(*codingAgentRunnerCapabilities)) = capabilities
			return 200, nil
		}
		job := result.(*codingAgentJobResult)
		job.JobID, job.Dataset = "00000000-0000-0000-0000-000000000001", "fixture"
		if method == http.MethodPost {
			runnerPayload := payload.(codingAgentRunnerPayload)
			job.Status, job.Mode = "queued", runnerPayload.Mode
			if onJob != nil {
				onJob(runnerPayload)
			}
			return 202, nil
		}
		job.Status, job.Mode, job.Answer = "completed", codingAgentModeSiteAssistant, "Verified fixture answer"
		return 200, nil
	}
	return &calls
}

func readAvailability(t *testing.T, role string) (int, codingAgentAvailability) {
	t.Helper()
	rec := httptest.NewRecorder()
	FilterbarAICodexQueryHandler(rec, codingAgentRequest("GET", "/api/app/ai-chat/codex-query?dataset=fixture", "", role))
	var result codingAgentAvailability
	_ = json.Unmarshal(rec.Body.Bytes(), &result)
	return rec.Code, result
}

func TestCodingAgentPermittedModesFollowEnvironmentAndPolicy(t *testing.T) {
	for _, tc := range []struct {
		environment string
		devOnly     bool
		want        string
	}{
		{"dev", true, "code_workspace,site_assistant"},
		{"dev", false, "code_workspace,site_assistant"},
		// Code work never appears outside development, whatever the policy says.
		{"prod", false, "site_assistant"},
		{"prod", true, ""},
	} {
		t.Setenv("ENVIRONMENT_TYPE", tc.environment)
		if got := strings.Join(codingAgentPermittedModes(tc.devOnly), ","); got != tc.want {
			t.Fatalf("%s devOnly=%v: modes %q, want %q", tc.environment, tc.devOnly, got, tc.want)
		}
	}
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
					code, result := readAvailability(t, role)
					if role != "admin" {
						if code != 403 {
							t.Fatal(code)
						}
						return
					}
					if code != 200 || result.FeatureEnabled != (environment == "dev" || !devOnly) || result.DevOnly != devOnly {
						t.Fatalf("%d %+v", code, result)
					}
					if result.RunnerReady {
						t.Fatal("an unconfigured runner was marked ready")
					}
					if result.FeatureEnabled && result.ReasonCode != "runner_not_configured" {
						t.Fatalf("reason = %q, want runner_not_configured", result.ReasonCode)
					}
					for _, mode := range result.Modes {
						if mode.Mode == codingAgentModeCodeWorkspace && environment != "dev" {
							t.Fatal("code work offered outside development")
						}
					}
				})
			}
		}
	}
}

func TestCodingAgentAvailabilityIntersectsRunnerModesWithPolicy(t *testing.T) {
	t.Setenv("FILTEREST_CODING_AGENT_SOCKET", "/fixture/socket")
	fakeCodingAgentRunner(t, codingAgentRunnerCapabilities{
		RunnerReady: true, AuthenticationVerified: true,
		Modes: []string{"code_workspace", "site_assistant"}, OfferedModes: []string{"code_workspace", "site_assistant"},
	}, nil)

	t.Setenv("ENVIRONMENT_TYPE", "dev")
	_, dev := readAvailability(t, "admin")
	if len(dev.Modes) != 2 || !dev.Modes[0].Ready || dev.Modes[0].Mode != "code_workspace" || !dev.RunnerReady {
		t.Fatalf("development availability = %+v", dev)
	}

	// Even a runner that offers code work cannot enable it on a live site.
	t.Setenv("ENVIRONMENT_TYPE", "prod")
	_, prod := readAvailability(t, "admin")
	if len(prod.Modes) != 1 || prod.Modes[0].Mode != "site_assistant" || !prod.Modes[0].Ready {
		t.Fatalf("production availability = %+v", prod)
	}
}

func TestCodingAgentAvailabilityReportsAStoppedRunner(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	t.Setenv("FILTEREST_CODING_AGENT_SOCKET", "/fixture/socket")
	fakeCodingAgentRunner(t, codingAgentRunnerCapabilities{}, nil)
	codingAgentSocketCall = func(context.Context, string, string, int, interface{}, interface{}) (int, error) {
		return 0, errors.New("coding agent runner is unreachable")
	}
	_, result := readAvailability(t, "admin")
	if result.ReasonCode != "runner_not_running" || result.RunnerReady || len(result.Modes) != 2 || result.Modes[0].Ready {
		t.Fatalf("stopped runner availability = %+v", result)
	}
}

func TestCodingAgentSiteAssistantDispatchAndOwnerStatus(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "prod")
	t.Setenv("FILTEREST_CODING_AGENT_SOCKET", "/fixture/socket")
	t.Setenv("APP_PORT", "8193")
	t.Setenv("FILTEREST_CODING_AGENT_SITE_ID", "fixture.test")
	var dispatchedCode string
	calls := fakeCodingAgentRunner(t, codingAgentRunnerCapabilities{}, func(runnerPayload codingAgentRunnerPayload) {
		access := runnerPayload.SiteAssistant
		if runnerPayload.Query != "Fix data" || runnerPayload.BackendContext != nil || access == nil ||
			!strings.HasPrefix(access.DelegationCode, site_assistant.DelegationCodePrefix) ||
			access.SiteBaseURL != "http://127.0.0.1:8193" || access.CatalogRoute != "/api/admin/site-assistant/api-catalog" {
			t.Fatalf("the site assistant needs exactly its own site access: %#v", runnerPayload)
		}
		dispatchedCode = access.DelegationCode
	})
	body := `{"dataset":"fixture","query":"Fix data","mode":"site_assistant","request_id":"00000000-0000-0000-0000-000000000001"}`
	rec := httptest.NewRecorder()
	FilterbarAICodexQueryHandler(rec, codingAgentSessionRequest(t, "POST", "/api/app/ai-chat/codex-query", body, "admin", "test_admin_12"))
	if rec.Code != 202 || !strings.Contains(rec.Body.String(), `"mode":"site_assistant"`) {
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
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "Verified fixture answer") || *calls != 2 {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
	rec = httptest.NewRecorder()
	FilterbarAICodexQueryHandler(rec, codingAgentSessionRequest(t, "POST", "/api/app/ai-chat/codex-query", body, "basic", "basic_user"))
	if rec.Code != 403 || *calls != 2 {
		t.Fatal("non-admin dispatched")
	}
}

func TestCodeWorkspaceIsRefusedOutsideDevelopment(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "prod")
	t.Setenv("FILTEREST_CODING_AGENT_SOCKET", "/fixture/socket")
	calls := fakeCodingAgentRunner(t, codingAgentRunnerCapabilities{}, nil)
	body := `{"dataset":"fixture","query":"Edit the code","mode":"code_workspace","request_id":"00000000-0000-0000-0000-000000000003"}`
	rec := httptest.NewRecorder()
	FilterbarAICodexQueryHandler(rec, codingAgentSessionRequest(t, "POST", "/api/app/ai-chat/codex-query", body, "admin", "test_admin_12"))
	if rec.Code != http.StatusForbidden || *calls != 0 {
		t.Fatalf("code work on a live site: %d calls=%d %s", rec.Code, *calls, rec.Body.String())
	}
}

func TestCodeWorkspaceDispatchCarriesBackendContextButNoSiteAccess(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	t.Setenv("FILTEREST_CODING_AGENT_SOCKET", "/fixture/socket")
	originalColumnsReader := filterbarAIColumnsReader
	t.Cleanup(func() { filterbarAIColumnsReader = originalColumnsReader })
	filterbarAIColumnsReader = func(string) ([]map[string]interface{}, error) {
		return nil, errors.New("metadata unavailable in this dispatch test")
	}
	var seen codingAgentRunnerPayload
	fakeCodingAgentRunner(t, codingAgentRunnerCapabilities{}, func(runnerPayload codingAgentRunnerPayload) { seen = runnerPayload })
	body := `{"dataset":"fixture","query":"Why does the owner filter fail?","mode":"code_workspace","request_id":"00000000-0000-0000-0000-000000000004"}`
	rec := httptest.NewRecorder()
	FilterbarAICodexQueryHandler(rec, codingAgentSessionRequest(t, "POST", "/api/app/ai-chat/codex-query", body, "admin", "test_admin_12"))
	if rec.Code != 202 || !strings.Contains(rec.Body.String(), `"mode":"code_workspace"`) {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
	if seen.SiteAssistant != nil {
		t.Fatal("code work must never receive site access")
	}
	if seen.BackendContext == nil || !seen.BackendContext.RouteReached || seen.BackendContext.DeterministicFilterProbeErr == "" {
		t.Fatalf("backend context = %+v", seen.BackendContext)
	}
	if _, err := site_assistant.DefaultStore.ByJob("00000000-0000-0000-0000-000000000004"); err == nil {
		t.Fatal("a code workspace job was issued a delegation")
	}
}

func TestCodingAgentJobNeedsAKnownMode(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	t.Setenv("FILTEREST_CODING_AGENT_SOCKET", "/fixture/socket")
	calls := fakeCodingAgentRunner(t, codingAgentRunnerCapabilities{}, nil)
	for _, mode := range []string{"", "codex", "isolated_copy"} {
		body := `{"dataset":"fixture","query":"Hello","mode":"` + mode + `","request_id":"00000000-0000-0000-0000-000000000005"}`
		rec := httptest.NewRecorder()
		FilterbarAICodexQueryHandler(rec, codingAgentSessionRequest(t, "POST", "/api/app/ai-chat/codex-query", body, "admin", "test_admin_12"))
		if rec.Code != 400 || *calls != 0 {
			t.Fatalf("mode %q: %d calls=%d", mode, rec.Code, *calls)
		}
	}
}

func TestDispatchWithoutSiteAccessDoesNotStartAJob(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "prod")
	t.Setenv("FILTEREST_CODING_AGENT_SOCKET", "/fixture/socket")
	t.Setenv("FILTEREST_SITE_ASSISTANT_BASE_URL", "")
	t.Setenv("APP_PORT", "")
	calls := fakeCodingAgentRunner(t, codingAgentRunnerCapabilities{}, nil)
	body := `{"dataset":"fixture","query":"Fix data","mode":"site_assistant","request_id":"00000000-0000-0000-0000-000000000002"}`
	rec := httptest.NewRecorder()
	FilterbarAICodexQueryHandler(rec, codingAgentSessionRequest(t, "POST", "/api/app/ai-chat/codex-query", body, "admin", "test_admin_12"))
	if rec.Code != 503 || *calls != 0 {
		t.Fatalf("a job without site access must not start: %d calls=%d", rec.Code, *calls)
	}
}

// The browser sends a job only who said what. The request is decoded strictly,
// so display details the stored history also carries (time, usage, mode) refuse
// the whole job; this pins the shape both sides agree on.
func TestCodingAgentJobHistoryIsRoleAndContentOnly(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "prod")
	t.Setenv("FILTEREST_CODING_AGENT_SOCKET", "/fixture/socket")
	t.Setenv("APP_PORT", "8193")
	t.Setenv("FILTEREST_CODING_AGENT_SITE_ID", "fixture.test")
	var history []aiChatConversationMessage
	calls := fakeCodingAgentRunner(t, codingAgentRunnerCapabilities{}, func(runnerPayload codingAgentRunnerPayload) {
		history = runnerPayload.Messages
	})
	const requestID = "00000000-0000-0000-0000-000000000006"
	t.Cleanup(func() {
		if delegation, err := site_assistant.DefaultStore.ByJob(requestID); err == nil {
			site_assistant.DefaultStore.Revoke(delegation.ID)
		}
	})
	post := func(messages string) *httptest.ResponseRecorder {
		body := `{"dataset":"fixture","query":"Again","mode":"site_assistant","request_id":"` + requestID + `","messages":` + messages + `}`
		rec := httptest.NewRecorder()
		FilterbarAICodexQueryHandler(rec, codingAgentSessionRequest(t, "POST", "/api/app/ai-chat/codex-query", body, "admin", "test_admin_12"))
		return rec
	}
	if rec := post(`[{"role":"assistant","content":"Hello","usage":{"label":"","provider":"openai"}}]`); rec.Code != 400 || *calls != 0 {
		t.Fatalf("display details in the history: %d calls=%d", rec.Code, *calls)
	}
	rec := post(`[{"role":"user","content":"Hi"},{"role":"assistant","content":"Hello"}]`)
	if rec.Code != 202 || len(history) != 2 || history[1].Role != "assistant" || history[1].Content != "Hello" {
		t.Fatalf("%d %s %#v", rec.Code, rec.Body.String(), history)
	}
}
