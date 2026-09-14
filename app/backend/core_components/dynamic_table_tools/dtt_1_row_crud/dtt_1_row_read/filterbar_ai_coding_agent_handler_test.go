// filterbar_ai_coding_agent_handler_test.go
// Checks policy, trusted actors and durable-job dispatch through the Codex route.
// Bridges existing AdminProfile semantics with production and development modes.
// Uses fake runner calls only, without credentials or paid model requests.
package dtt_1_row_read

import (
	"context"
	"easelect/backend/core_components/dbutils"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func codingAgentRequest(method, path, body, role string) *http.Request {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	return r.WithContext(dbutils.SetRequestActorContext(r.Context(), dbutils.NewRequestActorContext(42, role)))
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
	calls := 0
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
			if path != "/v1/jobs" || payload.(codingAgentJobRequest).Query != "Fix code" {
				t.Fatal(path)
			}
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
	FilterbarAICodexQueryHandler(rec, codingAgentRequest("POST", "/api/app/ai-chat/codex-query", body, "admin"))
	if rec.Code != 202 {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
	rec = httptest.NewRecorder()
	FilterbarAICodexQueryHandler(rec, codingAgentRequest("GET", "/api/app/ai-chat/codex-query?dataset=fixture&job_id=00000000-0000-0000-0000-000000000001", "", "admin"))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "Verified fixture edit") || calls != 2 {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
	rec = httptest.NewRecorder()
	FilterbarAICodexQueryHandler(rec, codingAgentRequest("POST", "/api/app/ai-chat/codex-query", body, "basic"))
	if rec.Code != 403 || calls != 2 {
		t.Fatal("non-admin dispatched")
	}
}
func TestCodingAgentModelOverrideReachesActualCLIArguments(t *testing.T) {
	t.Setenv("FILTERBAR_AI_CODEX_MODEL", "fixture-model")
	args := buildFilterbarAICodexExecArgs(nil, "/fixture", "/answer")
	if !strings.Contains(strings.Join(args, " "), "--model fixture-model -") {
		t.Fatal(args)
	}
}
