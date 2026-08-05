// queen_chat_handler_test.go
// Unit tests for the admin-facing Queen transcript browser handlers and helpers.
// Covers safe transcript-name validation, run metadata parsing, and JSON handler output without a live server.
// Exists to keep the browser transcript view reliable while staying independent of a real Queen process.
package devtools

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestResolveQueenTranscriptPathRejectsTraversal(t *testing.T) {
	_, err := resolveQueenTranscriptPath("../secret.jsonl", "/tmp/transcripts")
	if err == nil {
		t.Fatal("expected invalid transcript name error")
	}
}

func TestParseQueenRunFilenameExtractsTaskID(t *testing.T) {
	timestamp, taskID := parseQueenRunFilename("queen_run_20260331_173600_task_809.jsonl")
	if taskID != "809" {
		t.Fatalf("taskID = %q, want 809", taskID)
	}
	if timestamp.Year() != 2026 || timestamp.Month() != 3 || timestamp.Day() != 31 {
		t.Fatalf("unexpected timestamp: %v", timestamp)
	}
}

func TestQueenRunsHandlerListsTranscriptMetadata(t *testing.T) {
	transcriptDir := t.TempDir()
	threadRegistryDir := filepath.Join(filepath.Dir(transcriptDir), "thread_registry")
	if err := os.MkdirAll(threadRegistryDir, 0o755); err != nil {
		t.Fatalf("os.MkdirAll returned error: %v", err)
	}
	writeQueenTranscriptFixture(t, transcriptDir, "queen_run_20260331_173600_task_809.jsonl", []string{
		`{"role":"human","agent":"human","text":"hello","turn":0,"timestamp":"2026-03-31T14:36:00Z"}`,
		`{"role":"queen","agent":"queen","text":"hi","turn":1,"timestamp":"2026-03-31T14:36:01Z"}`,
		`{"role":"worker","agent":"heisenberg","text":"done","turn":2,"timestamp":"2026-03-31T14:36:02Z"}`,
	})
	writeQueenThreadFixture(t, threadRegistryDir, queenThreadManifest{
		ID:              "qt_demo",
		ProjectRoot:     filepath.Dir(transcriptDir),
		Title:           "Investigate session registry",
		RunFilenames:    []string{"queen_run_20260331_173600_task_809.jsonl"},
		LastRunFilename: "queen_run_20260331_173600_task_809.jsonl",
		CreatedAt:       "2026-03-31T14:36:00Z",
		UpdatedAt:       "2026-03-31T14:36:05Z",
	})

	originalResolver := queenTranscriptDirResolver
	queenTranscriptDirResolver = func() string { return transcriptDir }
	t.Cleanup(func() {
		queenTranscriptDirResolver = originalResolver
	})

	req := httptest.NewRequest(http.MethodGet, "/api/queen/runs", nil)
	rec := httptest.NewRecorder()

	QueenRunsHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	var response struct {
		Runs []queenRunSummary `json:"runs"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("json.Unmarshal returned error: %v", err)
	}
	if len(response.Runs) != 1 {
		t.Fatalf("run count = %d, want 1", len(response.Runs))
	}
	if response.Runs[0].TaskID != "809" {
		t.Fatalf("task id = %q, want 809", response.Runs[0].TaskID)
	}
	if response.Runs[0].MessageCount != 3 {
		t.Fatalf("message_count = %d, want 3", response.Runs[0].MessageCount)
	}
	if response.Runs[0].ThreadID != "qt_demo" {
		t.Fatalf("thread id = %q, want qt_demo", response.Runs[0].ThreadID)
	}
	if response.Runs[0].ThreadRuns != 1 {
		t.Fatalf("thread run count = %d, want 1", response.Runs[0].ThreadRuns)
	}
}

func TestQueenRunsHandlerSkipsMissingTranscriptSymlink(t *testing.T) {
	transcriptDir := t.TempDir()
	writeQueenTranscriptFixture(t, transcriptDir, "queen_run_20260331_173600_task_809.jsonl", []string{
		`{"role":"human","agent":"human","text":"hello","turn":0,"timestamp":"2026-03-31T14:36:00Z"}`,
	})
	err := os.Symlink(
		filepath.Join(transcriptDir, "missing-transcript.jsonl"),
		filepath.Join(transcriptDir, "queen_run_20260405_182107_manual_qap_phase_smoke.jsonl"),
	)
	if err != nil {
		t.Skipf("os.Symlink unavailable: %v", err)
	}

	originalResolver := queenTranscriptDirResolver
	queenTranscriptDirResolver = func() string { return transcriptDir }
	t.Cleanup(func() {
		queenTranscriptDirResolver = originalResolver
	})

	req := httptest.NewRequest(http.MethodGet, "/api/queen/runs", nil)
	rec := httptest.NewRecorder()

	QueenRunsHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	var response struct {
		Runs []queenRunSummary `json:"runs"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("json.Unmarshal returned error: %v", err)
	}
	if len(response.Runs) != 1 {
		t.Fatalf("run count = %d, want 1", len(response.Runs))
	}
	if response.Runs[0].Filename != "queen_run_20260331_173600_task_809.jsonl" {
		t.Fatalf("filename = %q, want valid transcript only", response.Runs[0].Filename)
	}
}

func TestQueenRunsHandlerIncludesDirectRunRuntimeState(t *testing.T) {
	transcriptDir := t.TempDir()
	filename := "queen_run_20260402_010000_task_807.jsonl"
	fullPath := filepath.Join(transcriptDir, filename)
	writeQueenTranscriptFixture(t, transcriptDir, filename, []string{
		`{"role":"human","agent":"human","text":"hello","turn":0,"timestamp":"2026-04-02T01:00:00Z"}`,
	})
	writeQueenRuntimeStateFixture(t, queenRuntimeStatePathForTranscript(fullPath), queenSessionRuntimeState{
		Status:        "running",
		Reason:        "Heisenberg is still processing the investigation.",
		UpdatedAt:     "2026-04-02T01:00:05Z",
		ProcessID:     os.Getpid(),
		ProgressPhase: "delegating_to_worker",
		ProgressTone:  "info",
		ProgressNote:  "Queen delegated the next step to Heisenberg.",
		PendingTurn: &queenSessionPendingTurn{
			AgentName:      "heisenberg",
			LoopTurnCount:  2,
			StartedAt:      "2026-04-02T01:00:04Z",
			MessagePreview: "Investigate the failing browser observability path.",
		},
		WorktreeEvidence: &queenSessionWorktreeEvidence{
			Version:          1,
			CapturedAt:       "2026-04-02T01:00:05Z",
			ChangedPathCount: 2,
			ChangedPaths: []string{
				"server_tools/lib/sql_dump_policy.sh",
				"server_tools/deploy_to_production.sh",
			},
			Summary: "This turn has touched 2 repo files so far.",
		},
	})

	originalResolver := queenTranscriptDirResolver
	queenTranscriptDirResolver = func() string { return transcriptDir }
	t.Cleanup(func() {
		queenTranscriptDirResolver = originalResolver
	})

	req := httptest.NewRequest(http.MethodGet, "/api/queen/runs", nil)
	rec := httptest.NewRecorder()

	QueenRunsHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	var response struct {
		Runs []queenRunSummary `json:"runs"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("json.Unmarshal returned error: %v", err)
	}
	if len(response.Runs) != 1 {
		t.Fatalf("run count = %d, want 1", len(response.Runs))
	}
	if response.Runs[0].Status != "running" {
		t.Fatalf("status = %q, want running", response.Runs[0].Status)
	}
	if response.Runs[0].ProgressNote != "Queen delegated the next step to Heisenberg." {
		t.Fatalf("progress_note = %q", response.Runs[0].ProgressNote)
	}
	if !response.Runs[0].ProcessAlive {
		t.Fatal("expected run summary to report the direct-run process as alive")
	}
	if response.Runs[0].PendingTurn == nil || response.Runs[0].PendingTurn.AgentName != "heisenberg" {
		t.Fatalf("pending turn = %#v, want heisenberg payload", response.Runs[0].PendingTurn)
	}
	if response.Runs[0].WorktreeEvidence == nil || response.Runs[0].WorktreeEvidence.ChangedPathCount != 2 {
		t.Fatalf("worktree evidence = %#v, want changed path count 2", response.Runs[0].WorktreeEvidence)
	}
}

func TestQueenTranscriptHandlerReturnsEntries(t *testing.T) {
	transcriptDir := t.TempDir()
	filename := "queen_run_20260331_173600_task_809.jsonl"
	writeQueenTranscriptFixture(t, transcriptDir, filename, []string{
		`{"role":"human","agent":"human","text":"hello","turn":0,"timestamp":"2026-03-31T14:36:00Z"}`,
		`{"role":"queen","agent":"queen","text":"hi","turn":1,"timestamp":"2026-03-31T14:36:01Z"}`,
	})

	originalResolver := queenTranscriptDirResolver
	queenTranscriptDirResolver = func() string { return transcriptDir }
	t.Cleanup(func() {
		queenTranscriptDirResolver = originalResolver
	})

	req := httptest.NewRequest(http.MethodGet, "/api/queen/transcript?name="+filename, nil)
	rec := httptest.NewRecorder()

	QueenTranscriptHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	var response struct {
		Filename string                 `json:"filename"`
		Entries  []queenTranscriptEntry `json:"entries"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("json.Unmarshal returned error: %v", err)
	}
	if response.Filename != filename {
		t.Fatalf("filename = %q, want %q", response.Filename, filename)
	}
	if len(response.Entries) != 2 {
		t.Fatalf("entry count = %d, want 2", len(response.Entries))
	}
	if response.Entries[1].Role != "queen" {
		t.Fatalf("second role = %q, want queen", response.Entries[1].Role)
	}
}

func TestBuildQueenTranscriptStreamPulseIncludesHeartbeatFields(t *testing.T) {
	transcriptDir := t.TempDir()
	filename := "queen_run_20260402_010000_task_807.jsonl"
	writeQueenTranscriptFixture(t, transcriptDir, filename, []string{
		`{"role":"human","agent":"human","text":"hello","turn":0,"timestamp":"2026-04-02T01:00:00Z"}`,
	})

	fullPath := filepath.Join(transcriptDir, filename)
	info, err := os.Stat(fullPath)
	if err != nil {
		t.Fatalf("os.Stat returned error: %v", err)
	}

	pulse := buildQueenTranscriptStreamPulse(fullPath, info, 128)

	if pulse["filename"] != filename {
		t.Fatalf("filename = %v, want %q", pulse["filename"], filename)
	}
	if pulse["read_offset"] != int64(128) {
		t.Fatalf("read_offset = %v, want 128", pulse["read_offset"])
	}
	if pulse["modified_at"] == "" {
		t.Fatal("expected modified_at to be populated")
	}
	if pulse["server_time"] == "" {
		t.Fatal("expected server_time to be populated")
	}
}

func TestBuildQueenTranscriptStreamPulseIncludesRuntimeStateWhenAvailable(t *testing.T) {
	transcriptDir := t.TempDir()
	filename := "queen_run_20260402_010000_task_807.jsonl"
	fullPath := filepath.Join(transcriptDir, filename)
	writeQueenTranscriptFixture(t, transcriptDir, filename, []string{
		`{"role":"human","agent":"human","text":"hello","turn":0,"timestamp":"2026-04-02T01:00:00Z"}`,
	})
	writeQueenRuntimeStateFixture(t, queenRuntimeStatePathForTranscript(fullPath), queenSessionRuntimeState{
		Status:        "running",
		UpdatedAt:     "2026-04-02T01:00:05Z",
		ProcessID:     os.Getpid(),
		ProgressPhase: "reviewing_worker_result",
		ProgressTone:  "info",
		ProgressNote:  "Queen is reviewing the latest worker result.",
		WorktreeEvidence: &queenSessionWorktreeEvidence{
			Version:          1,
			CapturedAt:       "2026-04-02T01:00:05Z",
			ChangedPathCount: 1,
			ChangedPaths:     []string{"server_tools/lib/sql_dump_policy.sh"},
			Summary:          "This turn has touched 1 repo file so far.",
		},
	})

	info, err := os.Stat(fullPath)
	if err != nil {
		t.Fatalf("os.Stat returned error: %v", err)
	}

	pulse := buildQueenTranscriptStreamPulse(fullPath, info, 64)
	runtimeState, ok := pulse["runtime_state"].(*queenRunRuntimeSnapshot)
	if !ok || runtimeState == nil {
		t.Fatalf("runtime_state = %#v, want runtime snapshot", pulse["runtime_state"])
	}
	if runtimeState.ProgressNote != "Queen is reviewing the latest worker result." {
		t.Fatalf("progress_note = %q", runtimeState.ProgressNote)
	}
	if !runtimeState.ProcessAlive {
		t.Fatal("expected runtime snapshot to report the direct-run process as alive")
	}
	if runtimeState.WorktreeEvidence == nil || runtimeState.WorktreeEvidence.Summary != "This turn has touched 1 repo file so far." {
		t.Fatalf("worktree evidence = %#v, want summary", runtimeState.WorktreeEvidence)
	}
}

func writeQueenTranscriptFixture(t *testing.T, transcriptDir string, filename string, lines []string) {
	t.Helper()

	path := filepath.Join(transcriptDir, filename)
	content := ""
	for _, line := range lines {
		content += line + "\n"
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("os.WriteFile returned error: %v", err)
	}
}

func writeQueenThreadFixture(t *testing.T, registryDir string, manifest queenThreadManifest) {
	t.Helper()

	payload, err := json.Marshal(manifest)
	if err != nil {
		t.Fatalf("json.Marshal returned error: %v", err)
	}

	path := filepath.Join(registryDir, "queen_thread_"+manifest.ID+".json")
	if err := os.WriteFile(path, append(payload, '\n'), 0o644); err != nil {
		t.Fatalf("os.WriteFile returned error: %v", err)
	}
}

func writeQueenRuntimeStateFixture(t *testing.T, path string, state queenSessionRuntimeState) {
	t.Helper()

	payload, err := json.Marshal(state)
	if err != nil {
		t.Fatalf("json.Marshal returned error: %v", err)
	}
	if err := os.WriteFile(path, append(payload, '\n'), 0o644); err != nil {
		t.Fatalf("os.WriteFile returned error: %v", err)
	}
}
