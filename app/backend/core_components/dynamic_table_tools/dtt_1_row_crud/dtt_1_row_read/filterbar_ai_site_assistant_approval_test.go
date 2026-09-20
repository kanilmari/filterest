// filterbar_ai_site_assistant_approval_test.go
// Verifies that only the asking administrator can approve an assistant job's waiting changes.
// Bridges the runner's job record, the delegation store and the apply request.
// Uses fake runner calls only: no model, credentials or site requests.
package dtt_1_row_read

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"easelect/backend/core_components/site_assistant"
)

const approvalJobID = "00000000-0000-0000-0000-0000000000ab"

func waitingChange() codingAgentPlanEntry {
	return codingAgentPlanEntry{
		Method:        http.MethodPost,
		Path:          "/api/update-row",
		ApprovalQuery: "dataset=app_notes",
		BodyHash:      strings.Repeat("d", 64),
		Query:         map[string]interface{}{"dataset": "app_notes"},
		Body:          map[string]interface{}{"id": 1},
		Status:        "pending",
	}
}

func approvalBody(hash string) string {
	payload, _ := json.Marshal(siteAssistantApprovalRequest{
		Dataset: "app_notes", JobID: approvalJobID,
		Approvals: []siteAssistantApprovalEntry{{Method: "post", Path: "/api/update-row", Query: "dataset=app_notes", BodyHash: hash}},
	})
	return string(payload)
}

func withFakeRunner(t *testing.T, applied *siteAssistantApplyRequest, waiting []codingAgentPlanEntry) {
	t.Helper()
	original := codingAgentSocketCall
	t.Cleanup(func() { codingAgentSocketCall = original })
	t.Setenv("FILTEREST_CODING_AGENT_SOCKET", "/fixture/socket")
	t.Setenv("FILTEREST_CODING_AGENT_SITE_ID", "fixture.test")
	t.Setenv("APP_PORT", "8193")
	codingAgentSocketCall = func(_ context.Context, method, path string, _ int, payload interface{}, result interface{}) (int, error) {
		job := result.(*codingAgentJobResult)
		job.JobID = approvalJobID
		job.Dataset = "app_notes"
		if method == http.MethodGet {
			job.Status = "awaiting_approval"
			job.PendingChanges = waiting
			return 200, nil
		}
		request, ok := payload.(siteAssistantApplyRequest)
		if !ok || !strings.HasSuffix(path, "/apply") {
			t.Fatalf("unexpected apply call: %s %#v", path, payload)
		}
		*applied = request
		job.Status = "applied"
		return 200, nil
	}
}

func TestApprovalRunsTheWaitingChangeWithFreshSiteAccess(t *testing.T) {
	var applied siteAssistantApplyRequest
	withFakeRunner(t, &applied, []codingAgentPlanEntry{waitingChange()})

	recorder := httptest.NewRecorder()
	SiteAssistantApprovalHandler(recorder, codingAgentSessionRequest(t, http.MethodPost,
		"/api/app/ai-chat/site-assistant-approval", approvalBody(strings.Repeat("d", 64)), "admin", "test_admin_12"))

	if recorder.Code != http.StatusOK {
		t.Fatalf("approval = %d %s", recorder.Code, recorder.Body.String())
	}
	if applied.Dataset != "app_notes" || applied.SiteAssistant == nil ||
		!strings.HasPrefix(applied.SiteAssistant.DelegationCode, site_assistant.DelegationCodePrefix) {
		t.Fatalf("the apply step needs fresh site access: %#v", applied.SiteAssistant)
	}
	if strings.Contains(recorder.Body.String(), applied.SiteAssistant.DelegationCode) {
		t.Fatal("site access must not reach the browser")
	}
	if _, err := site_assistant.DefaultStore.ByJob(approvalJobID); err == nil {
		t.Fatal("the approval's site access must end with the request")
	}
}

func TestApprovalRefusesChangesTheJobNeverPrepared(t *testing.T) {
	var applied siteAssistantApplyRequest
	withFakeRunner(t, &applied, []codingAgentPlanEntry{waitingChange()})

	recorder := httptest.NewRecorder()
	SiteAssistantApprovalHandler(recorder, codingAgentSessionRequest(t, http.MethodPost,
		"/api/app/ai-chat/site-assistant-approval", approvalBody(strings.Repeat("e", 64)), "admin", "test_admin_12"))

	if recorder.Code != http.StatusConflict || applied.SiteAssistant != nil {
		t.Fatalf("an unknown change must not run: %d %s", recorder.Code, recorder.Body.String())
	}
}

func TestApprovalMatchesOnlyTheCanonicalWaitingQuery(t *testing.T) {
	waiting := waitingChange()
	waiting.ApprovalQuery = "label=some+value&dataset=app_notes"
	matching := siteAssistantApprovalEntry{
		Method: "post", Path: waiting.Path, Query: "dataset=app_notes&label=some%20value", BodyHash: waiting.BodyHash,
	}
	approved, err := matchWaitingChanges([]codingAgentPlanEntry{waiting}, []siteAssistantApprovalEntry{matching})
	if err != nil || len(approved) != 1 || approved[0].Query != "dataset=app_notes&label=some+value" {
		t.Fatalf("equivalent query should match canonically: %+v, %v", approved, err)
	}

	matching.Query = "dataset=app_tasks&label=some+value"
	if _, err := matchWaitingChanges([]codingAgentPlanEntry{waiting}, []siteAssistantApprovalEntry{matching}); err == nil {
		t.Fatal("approval for another query target must be refused")
	}
}

func TestApprovalRequiresAdministratorAndValidRequest(t *testing.T) {
	var applied siteAssistantApplyRequest
	withFakeRunner(t, &applied, []codingAgentPlanEntry{waitingChange()})

	basic := httptest.NewRecorder()
	SiteAssistantApprovalHandler(basic, codingAgentSessionRequest(t, http.MethodPost,
		"/api/app/ai-chat/site-assistant-approval", approvalBody(strings.Repeat("d", 64)), "basic", "basic_user"))
	if basic.Code != http.StatusForbidden {
		t.Fatalf("non-administrator = %d", basic.Code)
	}

	for name, body := range map[string]string{
		"missing approvals": `{"dataset":"app_notes","job_id":"` + approvalJobID + `","approvals":[]}`,
		"invalid job":       `{"dataset":"app_notes","job_id":"nope","approvals":[{"method":"POST","path":"/api/update-row","body_sha256":"` + strings.Repeat("d", 64) + `"}]}`,
		"unknown field":     `{"dataset":"app_notes","job_id":"` + approvalJobID + `","approvals":[],"extra":1}`,
	} {
		recorder := httptest.NewRecorder()
		SiteAssistantApprovalHandler(recorder, codingAgentSessionRequest(t, http.MethodPost,
			"/api/app/ai-chat/site-assistant-approval", body, "admin", "test_admin_12"))
		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("%s = %d %s", name, recorder.Code, recorder.Body.String())
		}
	}

	if applied.SiteAssistant != nil {
		t.Fatal("an invalid approval must not reach the runner")
	}
}
