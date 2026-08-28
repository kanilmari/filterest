// workline_report_contract_test.go
// Verifies report validation, secret blocking, and append-first input normalization.
// Bridges untrusted report examples with the Agent Tools persistence contract.
// Exists so later refactors cannot silently weaken the canonical-history safety boundary.
package agent_tools

import (
	"encoding/json"
	"strings"
	"testing"
)

func boolPointer(value bool) *bool {
	return &value
}

func intPointer(value int) *int {
	return &value
}

func validStructuredReportRequest() worklineReportCreateRequest {
	return worklineReportCreateRequest{
		WorklineID:              4,
		Title:                   "Report tool delivered",
		PhaseGate:               "3-4",
		CurrentPhase:            intPointer(4),
		WorklineStatusSnapshot:  "active",
		ChangedThisTurn:         boolPointer(true),
		ContextText:             "The reporting workflow preserves useful development context.",
		PlainLanguageText:       "The workline can now be continued without replaying the chat.",
		TechnicalText:           "The API stores an immutable structured checkpoint.",
		NextStepText:            "Verify the native API and create the next phase report.",
		Snapshot:                json.RawMessage(`{"tests":"pending"}`),
		GitHeadCommit:           strings.Repeat("a", 40),
		GitWorktreeState:        "dirty",
		GitHasOtherChanges:      boolPointer(true),
		GitWorklineChangedPaths: []string{"backend/report.go"},
	}
}

func TestNormalizeWorklineReportCreateValidatesExactPhaseIndependentlyFromGate(t *testing.T) {
	request := validStructuredReportRequest()
	request.CurrentPhase = nil
	if _, err := normalizeWorklineReportCreate(request); err == nil || err.Error() != "current_phase is required" {
		t.Fatalf("missing exact phase error = %v", err)
	}

	request.CurrentPhase = intPointer(7)
	if _, err := normalizeWorklineReportCreate(request); err == nil || err.Error() != "current_phase must be between 0 and 6" {
		t.Fatalf("out-of-range exact phase error = %v", err)
	}

	request.CurrentPhase = intPointer(1)
	if _, err := normalizeWorklineReportCreate(request); err != nil {
		t.Fatalf("independent phase 1 with gate 3-4 rejected: %v", err)
	}
}

func TestReportSummaryJSONOmitsEmptyContent(t *testing.T) {
	payload, err := json.Marshal(AgentWorklineReport{ID: 1, Title: "Summary only"})
	if err != nil {
		t.Fatalf("json.Marshal returned error: %v", err)
	}
	if strings.Contains(string(payload), `"content"`) {
		t.Fatalf("summary payload exposed an empty content field: %s", payload)
	}
}

func TestDetectReportSecretAllowsOperationalProseWithoutValues(t *testing.T) {
	content := "The shared password was rotated and moved to the protected credentials store. No value is included."
	if got := detectReportSecret(content); got != "" {
		t.Fatalf("safe operational prose classified as %q", got)
	}
}

func TestDetectReportSecretRejectsProviderTokenWithoutEchoingIt(t *testing.T) {
	credential := "sk-" + strings.Repeat("A7", 12)
	category := detectReportSecret("credential=" + credential)
	if category != "provider_token" {
		t.Fatalf("category = %q, want provider_token", category)
	}

	request := validStructuredReportRequest()
	request.TechnicalText = "Rotated credential " + credential
	_, err := normalizeWorklineReportCreate(request)
	if err == nil {
		t.Fatal("expected report secret rejection")
	}
	if strings.Contains(err.Error(), credential) {
		t.Fatal("validation error echoed submitted credential")
	}
}

func TestDetectReportSecretRejectsCredentialAssignment(t *testing.T) {
	credential := "CorrectHorseBatteryStaple42"
	if got := detectReportSecret("password=" + credential); got != "credential_assignment" {
		t.Fatalf("category = %q, want credential_assignment", got)
	}
	if got := detectReportSecret("password=rotated"); got != "" {
		t.Fatalf("placeholder classified as %q", got)
	}
}

func TestNormalizeWorklineReportCreateDefaultsAndDeduplicatesTags(t *testing.T) {
	request := validStructuredReportRequest()
	request.SyncWorklineStatus = true
	request.Title = "  Report tool delivered  "
	request.Tags = []string{"reports", "reports", "history"}
	request.Metadata = json.RawMessage(`{"phase":"4"}`)
	normalized, err := normalizeWorklineReportCreate(request)
	if err != nil {
		t.Fatalf("normalizeWorklineReportCreate returned error: %v", err)
	}
	if normalized.ReportType != "completion" || normalized.Outcome != "completed" || normalized.SourceKind != "codex" {
		t.Fatalf("unexpected defaults: %#v", normalized.worklineReportCreateRequest)
	}
	if normalized.Title != "Report tool delivered" {
		t.Fatalf("title = %q", normalized.Title)
	}
	if len(normalized.Tags) != 2 {
		t.Fatalf("tags = %#v, want two unique tags", normalized.Tags)
	}
	if normalized.ContentHash == "" || len(normalized.ContentHash) != 64 {
		t.Fatalf("content hash = %q", normalized.ContentHash)
	}
	if normalized.MetadataObject["phase"] != "4" {
		t.Fatalf("metadata = %#v", normalized.MetadataObject)
	}
	if normalized.SnapshotObject["tests"] != "pending" {
		t.Fatalf("snapshot = %#v", normalized.SnapshotObject)
	}
	if !normalized.SyncWorklineStatus {
		t.Fatal("atomic workline status synchronization was lost during normalization")
	}
	if !strings.Contains(normalized.Content, "**Git-snapshot:**") {
		t.Fatalf("rendered content missing Git snapshot: %q", normalized.Content)
	}
}

func TestNormalizeWorklineReportCreateRejectsNonObjectMetadata(t *testing.T) {
	request := validStructuredReportRequest()
	request.Metadata = json.RawMessage(`["not", "an", "object"]`)
	_, err := normalizeWorklineReportCreate(request)
	if err == nil || err.Error() != "metadata must be a JSON object" {
		t.Fatalf("error = %v, want metadata object validation", err)
	}
}

func TestNormalizeWorklineReportGitScopeAllowsOnlyOwnedPathsPlusBoolean(t *testing.T) {
	request := validStructuredReportRequest()
	request.GitWorklineChangedPaths = []string{"backend/report.go", "backend/report.go"}
	request.GitHasOtherChanges = boolPointer(false)

	normalized, err := normalizeWorklineReportCreate(request)
	if err != nil {
		t.Fatalf("normalizeWorklineReportCreate returned error: %v", err)
	}
	if len(normalized.GitWorklineChangedPaths) != 1 {
		t.Fatalf("git paths = %#v", normalized.GitWorklineChangedPaths)
	}
	if !strings.Contains(normalized.Content, "ainoa likaaja") {
		t.Fatalf("content did not describe exclusive worktree ownership: %q", normalized.Content)
	}
}

func TestNormalizeClosedWorklineReportOmitsNextStep(t *testing.T) {
	request := validStructuredReportRequest()
	request.WorklineStatusSnapshot = "closed"
	request.NextStepText = ""

	if _, err := normalizeWorklineReportCreate(request); err != nil {
		t.Fatalf("closed report rejected: %v", err)
	}
	request.NextStepText = "Continue anyway"
	if _, err := normalizeWorklineReportCreate(request); err == nil {
		t.Fatal("closed report accepted a next step")
	}
}

func TestValidateWorklineStatusReconciliationRequiresExplicitAtomicTransition(t *testing.T) {
	tests := []struct {
		name            string
		currentStatus   string
		requestedStatus string
		syncStatus      bool
		wantChanged     bool
		wantError       string
	}{
		{
			name:          "unchanged snapshot remains valid without synchronization",
			currentStatus: "active", requestedStatus: "active",
		},
		{
			name:          "stale lifecycle is rejected by default",
			currentStatus: "active", requestedStatus: "closed",
			wantError: "workline_status_snapshot_is_stale",
		},
		{
			name:          "explicit synchronization permits one atomic lifecycle change",
			currentStatus: "active", requestedStatus: "closed", syncStatus: true,
			wantChanged: true,
		},
		{
			name:          "archived identity never accepts another report",
			currentStatus: "archived", requestedStatus: "archived", syncStatus: true,
			wantError: "archived_workline_rejects_new_reports",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			changed, errorCode := validateWorklineStatusReconciliation(
				test.currentStatus,
				test.requestedStatus,
				test.syncStatus,
			)
			if changed != test.wantChanged || errorCode != test.wantError {
				t.Fatalf("result = (%v, %q), want (%v, %q)", changed, errorCode, test.wantChanged, test.wantError)
			}
		})
	}
}

func TestBuildWorklineUpdateQueryRejectsEmptyPatch(t *testing.T) {
	_, _, err := buildWorklineUpdateQuery(worklinePatchRequest{ID: 7})
	if err == nil || err.Error() != "no fields to update" {
		t.Fatalf("error = %v, want no fields to update", err)
	}
}

func TestBuildWorklineUpdateQueryLimitsMutableFields(t *testing.T) {
	title := "Canonical report history"
	status := "closed"
	query, args, err := buildWorklineUpdateQuery(worklinePatchRequest{
		ID:     7,
		Title:  &title,
		Status: &status,
	})
	if err != nil {
		t.Fatalf("buildWorklineUpdateQuery returned error: %v", err)
	}
	want := "UPDATE dev_agent_worklines SET title = $1, status = $2 WHERE id = $3 RETURNING id"
	if query != want {
		t.Fatalf("query = %q, want %q", query, want)
	}
	if len(args) != 3 || args[2] != int64(7) {
		t.Fatalf("args = %#v", args)
	}
}
