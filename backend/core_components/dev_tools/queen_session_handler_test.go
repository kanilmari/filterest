// queen_session_handler_test.go
// Unit tests for the managed Queen session registry and HTTP handlers.
// Covers session startup, lifecycle transitions, and stop behavior using a test-helper subprocess instead of a real Queen run.
// Exists to keep the browser-driven Queen session slice safe without depending on live model CLIs in tests.
package devtools

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

type controlledQueenSessionProcess struct {
	waitStarted chan struct{}
	releaseWait chan struct{}
}

func (process *controlledQueenSessionProcess) Start() error { return nil }
func (process *controlledQueenSessionProcess) Wait() error {
	close(process.waitStarted)
	<-process.releaseWait
	return nil
}
func (process *controlledQueenSessionProcess) PID() int               { return 999_999_998 }
func (process *controlledQueenSessionProcess) SignalTerminate() error { return nil }
func (process *controlledQueenSessionProcess) SignalKill() error      { return nil }

func TestQueenSessionsHandlerStartsAndListsSession(t *testing.T) {
	withQueenSessionTestState(t)

	body := strings.NewReader(`{"prompt":"Investigate session registry","max_turns":3,"cooldown_seconds":0.1}`)
	req := httptest.NewRequest(http.MethodPost, "/api/queen/sessions", body)
	rec := httptest.NewRecorder()

	QueenSessionsHandler(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}

	var createResponse struct {
		Session queenManagedSessionSnapshot `json:"session"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &createResponse); err != nil {
		t.Fatalf("json.Unmarshal returned error: %v", err)
	}
	if createResponse.Session.ID == "" {
		t.Fatal("expected created session id")
	}
	if createResponse.Session.ThreadID == "" {
		t.Fatal("expected created thread id")
	}
	if createResponse.Session.ThreadTitle == "" {
		t.Fatal("expected created thread title")
	}
	if createResponse.Session.TranscriptFilename == "" {
		t.Fatal("expected transcript filename")
	}

	listReq := httptest.NewRequest(http.MethodGet, "/api/queen/sessions", nil)
	listRec := httptest.NewRecorder()
	QueenSessionsHandler(listRec, listReq)

	if listRec.Code != http.StatusOK {
		t.Fatalf("list status = %d, want 200; body=%s", listRec.Code, listRec.Body.String())
	}

	var listResponse queenSessionListResponse
	if err := json.Unmarshal(listRec.Body.Bytes(), &listResponse); err != nil {
		t.Fatalf("json.Unmarshal returned error: %v", err)
	}
	if len(listResponse.Sessions) != 1 {
		t.Fatalf("session count = %d, want 1", len(listResponse.Sessions))
	}
	if listResponse.Sessions[0].ThreadID == "" {
		t.Fatal("expected listed session to include thread id")
	}
}

func TestQueenSessionLifecycleCompletes(t *testing.T) {
	withQueenSessionTestState(t)

	manager := managedQueenSessions
	snapshot, err := manager.StartSession(queenSessionStartRequest{
		Prompt: "Complete quickly",
	})
	if err != nil {
		t.Fatalf("StartSession returned error: %v", err)
	}

	waitForQueenSessionStatus(t, manager, snapshot.ID, "completed")

	finalSnapshot, ok := manager.GetSnapshot(snapshot.ID)
	if !ok {
		t.Fatal("expected session snapshot")
	}
	if finalSnapshot.ExitCode == nil || *finalSnapshot.ExitCode != 0 {
		t.Fatalf("exit code = %v, want 0", finalSnapshot.ExitCode)
	}
	if finalSnapshot.ProgressPhase != "completed" {
		t.Fatalf("progress phase = %q, want %q", finalSnapshot.ProgressPhase, "completed")
	}
	if finalSnapshot.ProgressTone != "success" {
		t.Fatalf("progress tone = %q, want %q", finalSnapshot.ProgressTone, "success")
	}
	if finalSnapshot.ProgressNote != "Queen completed the managed session." {
		t.Fatalf("progress note = %q, want completion note", finalSnapshot.ProgressNote)
	}
}

func TestQueenSessionStopTransitionsToStopped(t *testing.T) {
	withQueenSessionTestState(t)

	manager := managedQueenSessions
	snapshot, err := manager.StartSession(queenSessionStartRequest{
		Prompt: "LONG_RUNNING session for stop test",
	})
	if err != nil {
		t.Fatalf("StartSession returned error: %v", err)
	}

	if _, err := manager.StopSession(snapshot.ID); err != nil {
		t.Fatalf("StopSession returned error: %v", err)
	}

	waitForQueenSessionStatus(t, manager, snapshot.ID, "stopped")
}

func TestQueenSessionRefreshDefersTerminalTransitionToAttachedMonitor(t *testing.T) {
	projectRoot := t.TempDir()
	now := time.Now()
	manager := newQueenSessionManager()
	session := &queenManagedSession{
		ID:            "monitored-stop",
		ProjectRoot:   projectRoot,
		Status:        "stopping",
		ProcessID:     999_999_999,
		StopRequested: true,
		CreatedAt:     now,
		UpdatedAt:     now,
		process:       &execQueenSessionProcess{},
	}

	manager.refreshRuntimeStateLocked(session)

	if session.Status != "stopping" {
		t.Fatalf("status = %q, want monitor-owned stopping state", session.Status)
	}
	if session.process == nil {
		t.Fatal("expected attached process monitor ownership to remain intact")
	}
	if session.FinishedAt != nil {
		t.Fatalf("finished at = %v, want monitor to set terminal timestamp", session.FinishedAt)
	}
}

func TestQueenSessionMonitorIgnoresSupersededProcess(t *testing.T) {
	manager := newQueenSessionManager()
	oldProcess := &controlledQueenSessionProcess{
		waitStarted: make(chan struct{}),
		releaseWait: make(chan struct{}),
	}
	newProcess := &execQueenSessionProcess{}
	now := time.Now()
	manager.sessions["relaunched"] = &queenManagedSession{
		ID:          "relaunched",
		ProjectRoot: t.TempDir(),
		Status:      "running",
		ProcessID:   oldProcess.PID(),
		CreatedAt:   now,
		UpdatedAt:   now,
		process:     oldProcess,
	}

	monitorDone := make(chan struct{})
	go func() {
		manager.monitor("relaunched", oldProcess)
		close(monitorDone)
	}()

	select {
	case <-oldProcess.waitStarted:
	case <-time.After(time.Second):
		t.Fatal("old process monitor did not begin waiting")
	}

	manager.mu.Lock()
	session := manager.sessions["relaunched"]
	session.Status = "resuming"
	session.ProcessID = 999_999_997
	session.process = newProcess
	manager.mu.Unlock()
	close(oldProcess.releaseWait)

	select {
	case <-monitorDone:
	case <-time.After(time.Second):
		t.Fatal("old process monitor did not finish")
	}

	manager.mu.RLock()
	defer manager.mu.RUnlock()
	current := manager.sessions["relaunched"]
	if current.Status != "resuming" {
		t.Fatalf("status = %q, want relaunched process state to remain resuming", current.Status)
	}
	if current.process != newProcess {
		t.Fatal("old monitor replaced the relaunched process handle")
	}
	if current.FinishedAt != nil {
		t.Fatalf("finished at = %v, want relaunched process to remain active", current.FinishedAt)
	}
}

func TestQueenSessionHandlerReturnsNotFoundForUnknownSession(t *testing.T) {
	withQueenSessionTestState(t)

	req := httptest.NewRequest(http.MethodGet, "/api/queen/session?id=missing", nil)
	rec := httptest.NewRecorder()

	QueenSessionHandler(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestQueenSessionMessageHandlerResumesAwaitingHumanSession(t *testing.T) {
	withQueenSessionTestState(t)

	manager := managedQueenSessions
	snapshot, err := manager.StartSession(queenSessionStartRequest{
		Prompt: "LONG_RUNNING session for follow-up test",
	})
	if err != nil {
		t.Fatalf("StartSession returned error: %v", err)
	}
	session := managedQueenSessionForTest(t, manager, snapshot.ID)
	markQueenSessionAwaitingHumanForTest(t, session, "Choose the browser path or backend path first.")

	body := strings.NewReader(`{"id":"` + snapshot.ID + `","message":"Focus on the failing logs first."}`)
	req := httptest.NewRequest(http.MethodPost, "/api/queen/session/message", body)
	rec := httptest.NewRecorder()

	QueenSessionMessageHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	var response struct {
		Session queenManagedSessionSnapshot `json:"session"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("json.Unmarshal returned error: %v", err)
	}
	if response.Session.Status != "resuming" {
		t.Fatalf("session status = %q, want %q", response.Session.Status, "resuming")
	}
	if response.Session.ProgressPhase != "resuming" {
		t.Fatalf("progress phase = %q, want %q", response.Session.ProgressPhase, "resuming")
	}
	if response.Session.ProgressTone != "info" {
		t.Fatalf("progress tone = %q, want %q", response.Session.ProgressTone, "info")
	}
	if response.Session.ProgressNote != "Queen is resuming from a browser reply." {
		t.Fatalf("progress note = %q, want resume note", response.Session.ProgressNote)
	}
	if !response.Session.HumanFollowupQueued {
		t.Fatal("expected human follow-up to be marked queued")
	}
	if response.Session.CanAcceptHumanFollowup {
		t.Fatal("expected human follow-up acceptance to be disabled after queueing one message")
	}
	if !strings.Contains(response.Session.StatusReason, "Queen is resuming") {
		t.Fatalf("status reason = %q, want resume explanation", response.Session.StatusReason)
	}

	payload, err := os.ReadFile(session.HumanInboxPath)
	if err != nil {
		t.Fatalf("os.ReadFile returned error: %v", err)
	}
	if !strings.Contains(string(payload), "Focus on the failing logs first.") {
		t.Fatalf("human inbox payload = %q, want queued follow-up text", string(payload))
	}

	if _, err := manager.StopSession(snapshot.ID); err != nil {
		t.Fatalf("StopSession returned error: %v", err)
	}
	waitForQueenSessionStatus(t, manager, snapshot.ID, "stopped")
}

func TestQueenSessionMessageHandlerRejectsSecondQueuedHumanReply(t *testing.T) {
	withQueenSessionTestState(t)

	manager := managedQueenSessions
	snapshot, err := manager.StartSession(queenSessionStartRequest{
		Prompt: "LONG_RUNNING session for duplicate follow-up test",
	})
	if err != nil {
		t.Fatalf("StartSession returned error: %v", err)
	}
	session := managedQueenSessionForTest(t, manager, snapshot.ID)
	markQueenSessionAwaitingHumanForTest(t, session, "Should Queen continue with the browser path?")

	firstBody := strings.NewReader(`{"id":"` + snapshot.ID + `","message":"First follow-up"}`)
	firstReq := httptest.NewRequest(http.MethodPost, "/api/queen/session/message", firstBody)
	firstRec := httptest.NewRecorder()
	QueenSessionMessageHandler(firstRec, firstReq)
	if firstRec.Code != http.StatusOK {
		t.Fatalf("first status = %d, want 200; body=%s", firstRec.Code, firstRec.Body.String())
	}

	secondBody := strings.NewReader(`{"id":"` + snapshot.ID + `","message":"Second follow-up"}`)
	secondReq := httptest.NewRequest(http.MethodPost, "/api/queen/session/message", secondBody)
	secondRec := httptest.NewRecorder()
	QueenSessionMessageHandler(secondRec, secondReq)

	if secondRec.Code != http.StatusConflict {
		t.Fatalf("second status = %d, want 409; body=%s", secondRec.Code, secondRec.Body.String())
	}

	if _, err := manager.StopSession(snapshot.ID); err != nil {
		t.Fatalf("StopSession returned error: %v", err)
	}
	waitForQueenSessionStatus(t, manager, snapshot.ID, "stopped")
}

func TestQueenSessionMessageHandlerRejectsRunningSession(t *testing.T) {
	withQueenSessionTestState(t)

	manager := managedQueenSessions
	snapshot, err := manager.StartSession(queenSessionStartRequest{
		Prompt: "LONG_RUNNING session for follow-up test",
	})
	if err != nil {
		t.Fatalf("StartSession returned error: %v", err)
	}

	body := strings.NewReader(`{"id":"` + snapshot.ID + `","message":"Please focus on the browser path first"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/queen/session/message", body)
	rec := httptest.NewRecorder()

	QueenSessionMessageHandler(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body=%s", rec.Code, rec.Body.String())
	}

	if _, err := manager.StopSession(snapshot.ID); err != nil {
		t.Fatalf("StopSession returned error: %v", err)
	}
	waitForQueenSessionStatus(t, manager, snapshot.ID, "stopped")
}

func TestQueenSessionSnapshotReflectsAwaitingHumanRuntimeState(t *testing.T) {
	withQueenSessionTestState(t)

	manager := managedQueenSessions
	snapshot, err := manager.StartSession(queenSessionStartRequest{
		Prompt: "LONG_RUNNING session for browser follow-up",
	})
	if err != nil {
		t.Fatalf("StartSession returned error: %v", err)
	}
	session := managedQueenSessionForTest(t, manager, snapshot.ID)
	markQueenSessionAwaitingHumanForTest(t, session, "Should Queen prioritize the browser flow?")

	refreshedSnapshot, ok := manager.GetSnapshot(snapshot.ID)
	if !ok {
		t.Fatal("expected session snapshot after writing runtime state")
	}
	if refreshedSnapshot.Status != "awaiting_human" {
		t.Fatalf("session status = %q, want %q", refreshedSnapshot.Status, "awaiting_human")
	}
	if refreshedSnapshot.StatusReason != "Should Queen prioritize the browser flow?" {
		t.Fatalf("status reason = %q, want awaiting-human reason", refreshedSnapshot.StatusReason)
	}
	if refreshedSnapshot.ProgressPhase != "awaiting_human" {
		t.Fatalf("progress phase = %q, want %q", refreshedSnapshot.ProgressPhase, "awaiting_human")
	}
	if refreshedSnapshot.ProgressTone != "warning" {
		t.Fatalf("progress tone = %q, want %q", refreshedSnapshot.ProgressTone, "warning")
	}
	if refreshedSnapshot.ProgressNote != "Queen is awaiting a human reply." {
		t.Fatalf("progress note = %q, want awaiting-human note", refreshedSnapshot.ProgressNote)
	}
	if refreshedSnapshot.ProgressUpdatedAt == nil || strings.TrimSpace(*refreshedSnapshot.ProgressUpdatedAt) == "" {
		t.Fatal("expected progress_updated_at to mirror the runtime-state timestamp")
	}
	if !refreshedSnapshot.CanAcceptHumanFollowup {
		t.Fatal("expected snapshot to accept one human follow-up while awaiting human input")
	}
	if refreshedSnapshot.HumanFollowupQueued {
		t.Fatal("expected no human follow-up to be queued yet")
	}

	if _, err := manager.StopSession(snapshot.ID); err != nil {
		t.Fatalf("StopSession returned error: %v", err)
	}
	waitForQueenSessionStatus(t, manager, snapshot.ID, "stopped")
}

func TestQueenSessionSnapshotIncludesPendingTurnTelemetry(t *testing.T) {
	withQueenSessionTestState(t)

	manager := managedQueenSessions
	snapshot, err := manager.StartSession(queenSessionStartRequest{
		Prompt: "LONG_RUNNING session for pending turn telemetry",
	})
	if err != nil {
		t.Fatalf("StartSession returned error: %v", err)
	}

	session := managedQueenSessionForTest(t, manager, snapshot.ID)
	runtimeUpdatedAt := time.Date(2026, time.April, 2, 0, 40, 0, 0, time.UTC)
	runtimeState := queenSessionRuntimeState{
		Status:        "running",
		Reason:        "",
		UpdatedAt:     runtimeUpdatedAt.Format(time.RFC3339),
		ProgressPhase: "reviewing_worker_result",
		ProgressTone:  "info",
		ProgressNote:  "Queen is reviewing the latest worker result.",
		PendingTurn: &queenSessionPendingTurn{
			Version:        1,
			AgentName:      "heisenberg",
			LoopTurnCount:  4,
			StartedAt:      "2026-04-02T00:39:30Z",
			MessagePreview: "Review the structured logging verification results first.",
		},
	}
	payload, err := json.Marshal(runtimeState)
	if err != nil {
		t.Fatalf("json.Marshal returned error: %v", err)
	}
	if err := os.WriteFile(session.SessionStatePath, append(payload, '\n'), 0o644); err != nil {
		t.Fatalf("os.WriteFile returned error: %v", err)
	}

	refreshedSnapshot, ok := manager.GetSnapshot(snapshot.ID)
	if !ok {
		t.Fatal("expected session snapshot after writing pending-turn runtime state")
	}
	if refreshedSnapshot.ProgressUpdatedAt == nil || *refreshedSnapshot.ProgressUpdatedAt != runtimeUpdatedAt.Format(time.RFC3339) {
		t.Fatalf("progress_updated_at = %v, want %q", refreshedSnapshot.ProgressUpdatedAt, runtimeUpdatedAt.Format(time.RFC3339))
	}
	if refreshedSnapshot.PendingTurn == nil {
		t.Fatal("expected pending_turn telemetry in the session snapshot")
	}
	if refreshedSnapshot.PendingTurn.AgentName != "heisenberg" {
		t.Fatalf("pending turn agent = %q, want %q", refreshedSnapshot.PendingTurn.AgentName, "heisenberg")
	}
	if refreshedSnapshot.PendingTurn.StartedAt != "2026-04-02T00:39:30Z" {
		t.Fatalf("pending turn started_at = %q, want fixed test timestamp", refreshedSnapshot.PendingTurn.StartedAt)
	}
	if refreshedSnapshot.PendingTurn.MessagePreview != "Review the structured logging verification results first." {
		t.Fatalf("pending turn message preview = %q, want worker preview", refreshedSnapshot.PendingTurn.MessagePreview)
	}

	if _, err := manager.StopSession(snapshot.ID); err != nil {
		t.Fatalf("StopSession returned error: %v", err)
	}
	waitForQueenSessionStatus(t, manager, snapshot.ID, "stopped")
}

func TestQueenSessionManagerHydratesAwaitingHumanSessionFromRegistry(t *testing.T) {
	withQueenSessionTestState(t)

	manager := managedQueenSessions
	snapshot, err := manager.StartSession(queenSessionStartRequest{
		Prompt: "LONG_RUNNING session for hydration test",
	})
	if err != nil {
		t.Fatalf("StartSession returned error: %v", err)
	}
	session := managedQueenSessionForTest(t, manager, snapshot.ID)
	markQueenSessionAwaitingHumanForTest(t, session, "Should Queen continue after backend restart?")

	hydratedManager := newQueenSessionManager()
	hydratedSnapshot, ok := hydratedManager.GetSnapshot(snapshot.ID)
	if !ok {
		t.Fatal("expected hydrated manager to load the persisted session")
	}
	if hydratedSnapshot.Status != "awaiting_human" {
		t.Fatalf("hydrated status = %q, want %q", hydratedSnapshot.Status, "awaiting_human")
	}
	if !hydratedSnapshot.CanAcceptHumanFollowup {
		t.Fatal("expected hydrated awaiting-human session to accept a browser follow-up")
	}
	if hydratedSnapshot.ProgressPhase != "awaiting_human" {
		t.Fatalf("hydrated progress phase = %q, want %q", hydratedSnapshot.ProgressPhase, "awaiting_human")
	}
	if hydratedSnapshot.ProgressTone != "warning" {
		t.Fatalf("hydrated progress tone = %q, want %q", hydratedSnapshot.ProgressTone, "warning")
	}
	if hydratedSnapshot.ProgressNote != "Queen is awaiting a human reply." {
		t.Fatalf("hydrated progress note = %q, want awaiting-human note", hydratedSnapshot.ProgressNote)
	}

	if _, err := hydratedManager.StopSession(snapshot.ID); err != nil {
		t.Fatalf("StopSession on hydrated manager returned error: %v", err)
	}
	waitForQueenSessionStatus(t, hydratedManager, snapshot.ID, "stopped")
}

func TestQueenSessionHydratedManagerCanEnqueueAwaitingHumanMessage(t *testing.T) {
	withQueenSessionTestState(t)

	manager := managedQueenSessions
	snapshot, err := manager.StartSession(queenSessionStartRequest{
		Prompt: "LONG_RUNNING session for hydrated follow-up test",
	})
	if err != nil {
		t.Fatalf("StartSession returned error: %v", err)
	}
	session := managedQueenSessionForTest(t, manager, snapshot.ID)
	markQueenSessionAwaitingHumanForTest(t, session, "Pick the safest migration path.")

	hydratedManager := newQueenSessionManager()
	hydratedSnapshot, err := hydratedManager.EnqueueHumanMessage(snapshot.ID, "Use the rollback-friendly path.")
	if err != nil {
		t.Fatalf("EnqueueHumanMessage on hydrated manager returned error: %v", err)
	}
	if hydratedSnapshot.Status != "resuming" {
		t.Fatalf("hydrated status = %q, want %q", hydratedSnapshot.Status, "resuming")
	}
	if hydratedSnapshot.ProgressPhase != "resuming" {
		t.Fatalf("hydrated progress phase = %q, want %q", hydratedSnapshot.ProgressPhase, "resuming")
	}
	if hydratedSnapshot.ProgressTone != "info" {
		t.Fatalf("hydrated progress tone = %q, want %q", hydratedSnapshot.ProgressTone, "info")
	}
	if hydratedSnapshot.ProgressNote != "Queen is resuming from a browser reply." {
		t.Fatalf("hydrated progress note = %q, want resume note", hydratedSnapshot.ProgressNote)
	}

	payload, err := os.ReadFile(session.HumanInboxPath)
	if err != nil {
		t.Fatalf("os.ReadFile returned error: %v", err)
	}
	if !strings.Contains(string(payload), "Use the rollback-friendly path.") {
		t.Fatalf("human inbox payload = %q, want hydrated reply text", string(payload))
	}

	if _, err := hydratedManager.StopSession(snapshot.ID); err != nil {
		t.Fatalf("StopSession on hydrated manager returned error: %v", err)
	}
	waitForQueenSessionStatus(t, hydratedManager, snapshot.ID, "stopped")
}

func TestQueenSessionHydratedManagerKeepsDeadAwaitingHumanSessionResumable(t *testing.T) {
	withQueenSessionTestState(t)

	manager := managedQueenSessions
	snapshot, err := manager.StartSession(queenSessionStartRequest{
		Prompt: "LONG_RUNNING session for dead awaiting-human hydration",
	})
	if err != nil {
		t.Fatalf("StartSession returned error: %v", err)
	}

	forceDeadAwaitingHumanResumeBoundaryForTest(
		t,
		manager,
		snapshot.ID,
		"Should Queen keep waiting after the backend restarts?",
	)

	hydratedManager := newQueenSessionManager()
	hydratedSnapshot, ok := hydratedManager.GetSnapshot(snapshot.ID)
	if !ok {
		t.Fatal("expected hydrated manager to load the persisted dead session")
	}
	if hydratedSnapshot.Status != "awaiting_human" {
		t.Fatalf("hydrated status = %q, want %q", hydratedSnapshot.Status, "awaiting_human")
	}
	if hydratedSnapshot.ProcessID != 0 {
		t.Fatalf("hydrated process id = %d, want 0 for dead resumable session", hydratedSnapshot.ProcessID)
	}
	if !hydratedSnapshot.CanAcceptHumanFollowup {
		t.Fatal("expected dead resumable session to still accept a human follow-up")
	}
	if hydratedSnapshot.ProgressPhase != "awaiting_human" {
		t.Fatalf("hydrated progress phase = %q, want %q", hydratedSnapshot.ProgressPhase, "awaiting_human")
	}
	if hydratedSnapshot.ProgressTone != "warning" {
		t.Fatalf("hydrated progress tone = %q, want %q", hydratedSnapshot.ProgressTone, "warning")
	}
	if hydratedSnapshot.ProgressNote != "Queen is awaiting a human reply." {
		t.Fatalf("hydrated progress note = %q, want awaiting-human note", hydratedSnapshot.ProgressNote)
	}
}

func TestQueenSessionHydratedManagerRelaunchesDeadAwaitingHumanSessionOnReply(t *testing.T) {
	withQueenSessionTestState(t)

	manager := managedQueenSessions
	snapshot, err := manager.StartSession(queenSessionStartRequest{
		Prompt: "LONG_RUNNING session for dead awaiting-human relaunch",
	})
	if err != nil {
		t.Fatalf("StartSession returned error: %v", err)
	}

	forceDeadAwaitingHumanResumeBoundaryForTest(
		t,
		manager,
		snapshot.ID,
		"Should Queen relaunch from the saved checkpoint after restart?",
	)

	originalCommandBuilder := queenSessionCommandBuilder
	var launchedSpecs []queenManagedSessionCommandSpec
	queenSessionCommandBuilder = func(ctx context.Context, spec queenManagedSessionCommandSpec) *exec.Cmd {
		launchedSpecs = append(launchedSpecs, spec)
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=TestQueenSessionHelperProcess", "--", "sleep", spec.TranscriptPath)
		command.Env = append(os.Environ(), "GO_WANT_QUEEN_HELPER_PROCESS=1")
		command.Dir = spec.ProjectRoot
		return command
	}
	t.Cleanup(func() {
		queenSessionCommandBuilder = originalCommandBuilder
	})

	hydratedManager := newQueenSessionManager()
	hydratedSnapshot, err := hydratedManager.EnqueueHumanMessage(snapshot.ID, "Resume from the checkpointed browser reply.")
	if err != nil {
		t.Fatalf("EnqueueHumanMessage returned error: %v", err)
	}
	if hydratedSnapshot.Status != "resuming" {
		t.Fatalf("hydrated status = %q, want %q", hydratedSnapshot.Status, "resuming")
	}
	if hydratedSnapshot.ProcessID <= 0 {
		t.Fatalf("hydrated process id = %d, want a relaunched process", hydratedSnapshot.ProcessID)
	}
	if len(launchedSpecs) != 1 {
		t.Fatalf("launch count = %d, want 1", len(launchedSpecs))
	}
	if launchedSpecs[0].ResumeSessionID != snapshot.ID {
		t.Fatalf("resume session id = %q, want %q", launchedSpecs[0].ResumeSessionID, snapshot.ID)
	}

	if _, err := hydratedManager.StopSession(snapshot.ID); err != nil {
		t.Fatalf("StopSession on relaunched hydrated manager returned error: %v", err)
	}
	waitForQueenSessionStatus(t, hydratedManager, snapshot.ID, "stopped")
}

func TestQueenSessionHydratedManagerKeepsDeadPendingWorkerTurnRecoverable(t *testing.T) {
	withQueenSessionTestState(t)

	manager := managedQueenSessions
	snapshot, err := manager.StartSession(queenSessionStartRequest{
		Prompt: "LONG_RUNNING session for dead pending-worker recovery",
	})
	if err != nil {
		t.Fatalf("StartSession returned error: %v", err)
	}

	forceDeadPendingWorkerTurnForTest(
		t,
		manager,
		snapshot.ID,
		"Continue from the last safe Queen checkpoint.",
	)

	hydratedManager := newQueenSessionManager()
	hydratedSnapshot, ok := hydratedManager.GetSnapshot(snapshot.ID)
	if !ok {
		t.Fatal("expected hydrated manager to load the persisted dead pending-worker session")
	}
	if hydratedSnapshot.Status != "awaiting_human" {
		t.Fatalf("hydrated status = %q, want %q", hydratedSnapshot.Status, "awaiting_human")
	}
	if hydratedSnapshot.ProcessID != 0 {
		t.Fatalf("hydrated process id = %d, want 0 for recoverable dead worker turn", hydratedSnapshot.ProcessID)
	}
	if !hydratedSnapshot.CanAcceptHumanFollowup {
		t.Fatal("expected dead pending-worker session to accept a recovery reply")
	}
	if !strings.Contains(hydratedSnapshot.StatusReason, "waiting for heisenberg") {
		t.Fatalf("status reason = %q, want worker-turn recovery explanation", hydratedSnapshot.StatusReason)
	}
	if hydratedSnapshot.ProgressPhase != "reviewing_worker_result" {
		t.Fatalf("hydrated progress phase = %q, want %q", hydratedSnapshot.ProgressPhase, "reviewing_worker_result")
	}
	if hydratedSnapshot.ProgressTone != "info" {
		t.Fatalf("hydrated progress tone = %q, want %q", hydratedSnapshot.ProgressTone, "info")
	}
	if hydratedSnapshot.ProgressNote != "Queen is reviewing the latest worker result." {
		t.Fatalf("hydrated progress note = %q, want worker-review note", hydratedSnapshot.ProgressNote)
	}
}

func TestQueenSessionHydratedManagerFailsDeadPendingQueenTurnWithRecoveryReason(t *testing.T) {
	withQueenSessionTestState(t)

	manager := managedQueenSessions
	snapshot, err := manager.StartSession(queenSessionStartRequest{
		Prompt: "LONG_RUNNING session for dead pending-queen recovery",
	})
	if err != nil {
		t.Fatalf("StartSession returned error: %v", err)
	}

	forceDeadPendingQueenTurnForTest(
		t,
		manager,
		snapshot.ID,
		"Queen turn crashed before completion.",
	)

	hydratedManager := newQueenSessionManager()
	hydratedSnapshot, ok := hydratedManager.GetSnapshot(snapshot.ID)
	if !ok {
		t.Fatal("expected hydrated manager to load the persisted dead pending-queen session")
	}
	if hydratedSnapshot.Status != "failed" {
		t.Fatalf("hydrated status = %q, want %q", hydratedSnapshot.Status, "failed")
	}
	if hydratedSnapshot.ProcessID != 0 {
		t.Fatalf("hydrated process id = %d, want 0 for dead pending queen turn", hydratedSnapshot.ProcessID)
	}
	if hydratedSnapshot.CanAcceptHumanFollowup {
		t.Fatal("expected dead pending-queen session to reject human follow-up replies")
	}
	if !strings.Contains(strings.ToLower(hydratedSnapshot.StatusReason), "mid-turn") {
		t.Fatalf("status reason = %q, want queen-turn crash explanation", hydratedSnapshot.StatusReason)
	}
}

func TestQueenSessionHydratedManagerRelaunchesDeadPendingWorkerTurnOnReply(t *testing.T) {
	withQueenSessionTestState(t)

	manager := managedQueenSessions
	snapshot, err := manager.StartSession(queenSessionStartRequest{
		Prompt: "LONG_RUNNING session for dead pending-worker relaunch",
	})
	if err != nil {
		t.Fatalf("StartSession returned error: %v", err)
	}

	forceDeadPendingWorkerTurnForTest(
		t,
		manager,
		snapshot.ID,
		"Continue from the last safe Queen checkpoint.",
	)

	originalCommandBuilder := queenSessionCommandBuilder
	var launchedSpecs []queenManagedSessionCommandSpec
	queenSessionCommandBuilder = func(ctx context.Context, spec queenManagedSessionCommandSpec) *exec.Cmd {
		launchedSpecs = append(launchedSpecs, spec)
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=TestQueenSessionHelperProcess", "--", "sleep", spec.TranscriptPath)
		command.Env = append(os.Environ(), "GO_WANT_QUEEN_HELPER_PROCESS=1")
		command.Dir = spec.ProjectRoot
		return command
	}
	t.Cleanup(func() {
		queenSessionCommandBuilder = originalCommandBuilder
	})

	hydratedManager := newQueenSessionManager()
	hydratedSnapshot, err := hydratedManager.EnqueueHumanMessage(snapshot.ID, "Restart the worker and continue from Queen's last safe checkpoint.")
	if err != nil {
		t.Fatalf("EnqueueHumanMessage returned error: %v", err)
	}
	if hydratedSnapshot.Status != "resuming" {
		t.Fatalf("hydrated status = %q, want %q", hydratedSnapshot.Status, "resuming")
	}
	if hydratedSnapshot.ProgressPhase != "reviewing_worker_result" {
		t.Fatalf("hydrated progress phase = %q, want %q", hydratedSnapshot.ProgressPhase, "reviewing_worker_result")
	}
	if hydratedSnapshot.ProcessID <= 0 {
		t.Fatalf("hydrated process id = %d, want a relaunched process", hydratedSnapshot.ProcessID)
	}
	if len(launchedSpecs) != 1 {
		t.Fatalf("launch count = %d, want 1", len(launchedSpecs))
	}
	if launchedSpecs[0].ResumeSessionID != snapshot.ID {
		t.Fatalf("resume session id = %q, want %q", launchedSpecs[0].ResumeSessionID, snapshot.ID)
	}

	if _, err := hydratedManager.StopSession(snapshot.ID); err != nil {
		t.Fatalf("StopSession on relaunched hydrated manager returned error: %v", err)
	}
	waitForQueenSessionStatus(t, hydratedManager, snapshot.ID, "stopped")
}

func TestQueenSessionHydratedManagerBlocksSecondActiveSession(t *testing.T) {
	withQueenSessionTestState(t)

	manager := managedQueenSessions
	snapshot, err := manager.StartSession(queenSessionStartRequest{
		Prompt: "LONG_RUNNING session for active-session gate",
	})
	if err != nil {
		t.Fatalf("StartSession returned error: %v", err)
	}

	hydratedManager := newQueenSessionManager()
	if _, err := hydratedManager.StartSession(queenSessionStartRequest{
		Prompt: "A second managed Queen run should be blocked",
	}); err == nil {
		t.Fatal("expected hydrated manager to reject a second active session")
	} else if !strings.Contains(err.Error(), errManagedQueenSessionAlreadyActive.Error()) {
		t.Fatalf("error = %v, want active-session conflict", err)
	}

	if _, err := manager.StopSession(snapshot.ID); err != nil {
		t.Fatalf("StopSession returned error: %v", err)
	}
	waitForQueenSessionStatus(t, manager, snapshot.ID, "stopped")
}

func withQueenSessionTestState(t *testing.T) string {
	t.Helper()

	transcriptDir := t.TempDir()
	projectRoot := t.TempDir()
	if err := os.WriteFile(filepath.Join(projectRoot, "main.go"), []byte("package main\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile main.go returned error: %v", err)
	}
	queenDir := filepath.Join(projectRoot, "server_tools", "queen")
	if err := os.MkdirAll(queenDir, 0o755); err != nil {
		t.Fatalf("os.MkdirAll returned error: %v", err)
	}
	if err := os.WriteFile(filepath.Join(queenDir, "main.py"), []byte("# test\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile main.py returned error: %v", err)
	}

	originalTranscriptResolver := queenTranscriptDirResolver
	originalProjectRootResolver := queenProjectRootResolver
	originalManager := managedQueenSessions
	originalCommandBuilder := queenSessionCommandBuilder

	queenTranscriptDirResolver = func() string { return transcriptDir }
	queenProjectRootResolver = func() (string, error) { return projectRoot, nil }
	managedQueenSessions = newQueenSessionManager()
	queenSessionCommandBuilder = func(ctx context.Context, spec queenManagedSessionCommandSpec) *exec.Cmd {
		scenario := "complete"
		if strings.Contains(spec.Prompt, "LONG_RUNNING") {
			scenario = "sleep"
		}

		command := exec.CommandContext(ctx, os.Args[0], "-test.run=TestQueenSessionHelperProcess", "--", scenario, spec.TranscriptPath)
		command.Env = append(os.Environ(), "GO_WANT_QUEEN_HELPER_PROCESS=1")
		command.Dir = spec.ProjectRoot
		return command
	}

	t.Cleanup(func() {
		queenTranscriptDirResolver = originalTranscriptResolver
		queenProjectRootResolver = originalProjectRootResolver
		managedQueenSessions = originalManager
		queenSessionCommandBuilder = originalCommandBuilder
	})

	return transcriptDir
}

func waitForQueenSessionStatus(t *testing.T, manager *queenSessionManager, sessionID string, expectedStatus string) {
	t.Helper()

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		snapshot, ok := manager.GetSnapshot(sessionID)
		if ok && snapshot.Status == expectedStatus {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}

	snapshot, _ := manager.GetSnapshot(sessionID)
	t.Fatalf("session %s did not reach status %s; last snapshot=%+v", sessionID, expectedStatus, snapshot)
}

func managedQueenSessionForTest(t *testing.T, manager *queenSessionManager, sessionID string) *queenManagedSession {
	t.Helper()

	manager.mu.RLock()
	defer manager.mu.RUnlock()

	session := manager.sessions[sessionID]
	if session == nil {
		t.Fatalf("expected managed session %s to exist", sessionID)
	}
	return session
}

func markQueenSessionAwaitingHumanForTest(t *testing.T, session *queenManagedSession, reason string) {
	t.Helper()

	if err := writeQueenSessionRuntimeState(
		session.SessionStatePath,
		"awaiting_human",
		reason,
		time.Now(),
		"awaiting_human",
		"Queen is awaiting a human reply.",
	); err != nil {
		t.Fatalf("writeQueenSessionRuntimeState returned error: %v", err)
	}
}

func forceDeadAwaitingHumanResumeBoundaryForTest(
	t *testing.T,
	manager *queenSessionManager,
	sessionID string,
	reason string,
) {
	t.Helper()

	session := managedQueenSessionForTest(t, manager, sessionID)
	if session.ProcessID > 0 {
		if err := signalQueenSessionProcess(session.ProcessID, syscall.SIGKILL); err != nil {
			t.Fatalf("signalQueenSessionProcess returned error: %v", err)
		}
		waitForQueenSessionStatus(t, manager, sessionID, "failed")
		session = managedQueenSessionForTest(t, manager, sessionID)
	}

	runtimeState := queenSessionRuntimeState{
		Status:        "awaiting_human",
		Reason:        reason,
		UpdatedAt:     time.Now().Format(time.RFC3339),
		ProgressPhase: "awaiting_human",
		ProgressTone:  "warning",
		ProgressNote:  "Queen is awaiting a human reply.",
		ResumeCheckpoint: &queenSessionResumeCheckpoint{
			Version:          1,
			QueenSessionID:   "queen-session-test",
			WorkerSessionID:  "worker-session-test",
			LoopTurnCount:    3,
			QueenTurnCount:   2,
			WorkerTurnCount:  1,
			HumanInputOffset: 0,
		},
	}
	payload, err := json.Marshal(runtimeState)
	if err != nil {
		t.Fatalf("json.Marshal returned error: %v", err)
	}
	if err := os.WriteFile(session.SessionStatePath, append(payload, '\n'), 0o644); err != nil {
		t.Fatalf("os.WriteFile returned error: %v", err)
	}

	manager.mu.Lock()
	defer manager.mu.Unlock()

	session.Status = "awaiting_human"
	session.StatusReason = reason
	session.HumanFollowupQueued = false
	session.HumanFollowupQueuedAt = nil
	session.ProcessID = 999999
	session.ExitCode = nil
	session.Error = ""
	session.FinishedAt = nil
	session.StopRequested = false
	session.process = nil
	session.UpdatedAt = time.Now()
	if err := manager.persistSessionLocked(session); err != nil {
		t.Fatalf("persistSessionLocked returned error: %v", err)
	}
}

func forceDeadPendingWorkerTurnForTest(
	t *testing.T,
	manager *queenSessionManager,
	sessionID string,
	messagePreview string,
) {
	t.Helper()

	session := managedQueenSessionForTest(t, manager, sessionID)
	if session.ProcessID > 0 {
		if err := signalQueenSessionProcess(session.ProcessID, syscall.SIGKILL); err != nil {
			t.Fatalf("signalQueenSessionProcess returned error: %v", err)
		}
		waitForQueenSessionStatus(t, manager, sessionID, "failed")
		session = managedQueenSessionForTest(t, manager, sessionID)
	}

	runtimeState := queenSessionRuntimeState{
		Status:        "running",
		Reason:        "",
		UpdatedAt:     time.Now().Format(time.RFC3339),
		ProgressPhase: "reviewing_worker_result",
		ProgressTone:  "info",
		ProgressNote:  "Queen is reviewing the latest worker result.",
		ResumeCheckpoint: &queenSessionResumeCheckpoint{
			Version:          1,
			QueenSessionID:   "queen-session-test",
			WorkerSessionID:  "worker-session-test",
			LoopTurnCount:    3,
			QueenTurnCount:   2,
			WorkerTurnCount:  1,
			HumanInputOffset: 0,
		},
		PendingTurn: &queenSessionPendingTurn{
			Version:        1,
			AgentName:      "heisenberg",
			LoopTurnCount:  4,
			StartedAt:      time.Now().Format(time.RFC3339),
			MessagePreview: messagePreview,
		},
	}
	payload, err := json.Marshal(runtimeState)
	if err != nil {
		t.Fatalf("json.Marshal returned error: %v", err)
	}
	if err := os.WriteFile(session.SessionStatePath, append(payload, '\n'), 0o644); err != nil {
		t.Fatalf("os.WriteFile returned error: %v", err)
	}

	manager.mu.Lock()
	defer manager.mu.Unlock()

	session.Status = "running"
	session.StatusReason = ""
	session.HumanFollowupQueued = false
	session.HumanFollowupQueuedAt = nil
	session.ProcessID = 999999
	session.ExitCode = nil
	session.Error = ""
	session.FinishedAt = nil
	session.StopRequested = false
	session.process = nil
	session.UpdatedAt = time.Now()
	if err := manager.persistSessionLocked(session); err != nil {
		t.Fatalf("persistSessionLocked returned error: %v", err)
	}
}

func forceDeadPendingQueenTurnForTest(
	t *testing.T,
	manager *queenSessionManager,
	sessionID string,
	messagePreview string,
) {
	t.Helper()

	session := managedQueenSessionForTest(t, manager, sessionID)
	if session.ProcessID > 0 {
		if err := signalQueenSessionProcess(session.ProcessID, syscall.SIGKILL); err != nil {
			t.Fatalf("signalQueenSessionProcess returned error: %v", err)
		}
		waitForQueenSessionStatus(t, manager, sessionID, "failed")
		session = managedQueenSessionForTest(t, manager, sessionID)
	}

	runtimeState := queenSessionRuntimeState{
		Status:        "running",
		Reason:        "",
		UpdatedAt:     time.Now().Format(time.RFC3339),
		ProgressPhase: "reviewing_worker_result",
		ProgressTone:  "info",
		ProgressNote:  "Queen is reviewing the latest worker result.",
		ResumeCheckpoint: &queenSessionResumeCheckpoint{
			Version:          1,
			QueenSessionID:   "queen-session-test",
			WorkerSessionID:  "worker-session-test",
			LoopTurnCount:    3,
			QueenTurnCount:   2,
			WorkerTurnCount:  1,
			HumanInputOffset: 0,
		},
		PendingTurn: &queenSessionPendingTurn{
			Version:        1,
			AgentName:      "queen",
			LoopTurnCount:  4,
			StartedAt:      time.Now().Format(time.RFC3339),
			MessagePreview: messagePreview,
		},
	}
	payload, err := json.Marshal(runtimeState)
	if err != nil {
		t.Fatalf("json.Marshal returned error: %v", err)
	}
	if err := os.WriteFile(session.SessionStatePath, append(payload, '\n'), 0o644); err != nil {
		t.Fatalf("os.WriteFile returned error: %v", err)
	}

	manager.mu.Lock()
	defer manager.mu.Unlock()

	session.Status = "running"
	session.StatusReason = ""
	session.HumanFollowupQueued = false
	session.HumanFollowupQueuedAt = nil
	session.ProcessID = 999999
	session.ExitCode = nil
	session.Error = ""
	session.FinishedAt = nil
	session.StopRequested = false
	session.process = nil
	session.UpdatedAt = time.Now()
	if err := manager.persistSessionLocked(session); err != nil {
		t.Fatalf("persistSessionLocked returned error: %v", err)
	}
}

func TestQueenSessionHelperProcess(_ *testing.T) {
	if os.Getenv("GO_WANT_QUEEN_HELPER_PROCESS") != "1" {
		return
	}

	args := os.Args
	for index, arg := range args {
		if arg == "--" && index+2 < len(args) {
			scenario := args[index+1]
			transcriptPath := args[index+2]
			_ = os.WriteFile(transcriptPath, []byte("{\"role\":\"human\",\"agent\":\"human\",\"text\":\"hello\",\"turn\":0,\"timestamp\":\"2026-03-31T15:00:00Z\"}\n"), 0o644)

			switch scenario {
			case "sleep":
				time.Sleep(2 * time.Second)
				os.Exit(0)
			default:
				time.Sleep(50 * time.Millisecond)
				os.Exit(0)
			}
		}
	}

	os.Exit(1)
}
