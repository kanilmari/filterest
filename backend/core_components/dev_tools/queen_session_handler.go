// queen_session_handler.go
// Admin-only HTTP handlers for managed Queen subprocess sessions started from the browser.
// Bridges the SPA admin tools with the existing Python Queen CLI by tracking launched runs in an in-memory registry.
// Exists to add the first safe managed-session slice without rewriting the underlying Queen runtime yet.
package devtools

import (
	"context"
	"easelect/backend/core_components/httpresponse"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

type queenSessionStartRequest struct {
	Prompt          string   `json:"prompt"`
	TaskID          *int     `json:"task_id"`
	MaxTurns        *int     `json:"max_turns"`
	CooldownSeconds *float64 `json:"cooldown_seconds"`
	QueenFamily     string   `json:"queen_family"`
	WorkerFamily    string   `json:"worker_family"`
	ThreadID        string   `json:"thread_id"`
	TitleHint       string   `json:"title_hint"`
	ContinueFromRun string   `json:"continue_from_run_filename"`
}

type queenSessionStopRequest struct {
	ID string `json:"id"`
}

type queenSessionMessageRequest struct {
	ID      string `json:"id"`
	Message string `json:"message"`
}

type queenManagedSessionCommandSpec struct {
	ID               string
	ResumeSessionID  string
	Prompt           string
	TaskID           *int
	MaxTurns         int
	CooldownSeconds  float64
	QueenFamily      string
	WorkerFamily     string
	ProjectRoot      string
	TranscriptPath   string
	LogPath          string
	HumanInboxPath   string
	SessionStatePath string
}

type queenSessionProcess interface {
	Start() error
	Wait() error
	PID() int
	SignalTerminate() error
	SignalKill() error
}

type execQueenSessionProcess struct {
	cmd     *exec.Cmd
	logFile *os.File
}

type queenManagedSession struct {
	ID                    string
	ProjectRoot           string
	Status                string
	ProgressPhase         string
	ProgressTone          string
	ProgressNote          string
	ProgressUpdatedAt     *time.Time
	PendingTurn           *queenSessionPendingTurn
	Prompt                string
	TaskID                *int
	MaxTurns              int
	CooldownSeconds       float64
	QueenFamily           string
	WorkerFamily          string
	TranscriptPath        string
	TranscriptName        string
	LogPath               string
	LogName               string
	HumanInboxPath        string
	HumanInboxName        string
	SessionStatePath      string
	SessionStateName      string
	ThreadID              string
	ThreadTitle           string
	StatusReason          string
	HumanFollowupQueued   bool
	HumanFollowupQueuedAt *time.Time
	ProcessID             int
	ExitCode              *int
	Error                 string
	CreatedAt             time.Time
	UpdatedAt             time.Time
	FinishedAt            *time.Time
	StopRequested         bool
	process               queenSessionProcess
}

type queenManagedSessionSnapshot struct {
	ID                     string                   `json:"id"`
	Status                 string                   `json:"status"`
	StatusReason           string                   `json:"status_reason,omitempty"`
	ProgressPhase          string                   `json:"progress_phase,omitempty"`
	ProgressTone           string                   `json:"progress_tone,omitempty"`
	ProgressNote           string                   `json:"progress_note,omitempty"`
	ProgressUpdatedAt      *string                  `json:"progress_updated_at,omitempty"`
	PendingTurn            *queenSessionPendingTurn `json:"pending_turn,omitempty"`
	Prompt                 string                   `json:"prompt"`
	TaskID                 *int                     `json:"task_id,omitempty"`
	MaxTurns               int                      `json:"max_turns"`
	CooldownSeconds        float64                  `json:"cooldown_seconds"`
	QueenFamily            string                   `json:"queen_family,omitempty"`
	WorkerFamily           string                   `json:"worker_family,omitempty"`
	ThreadID               string                   `json:"thread_id,omitempty"`
	ThreadTitle            string                   `json:"thread_title,omitempty"`
	TranscriptName         string                   `json:"transcript_name"`
	TranscriptFilename     string                   `json:"transcript_filename"`
	LogName                string                   `json:"log_name"`
	LogFilename            string                   `json:"log_filename"`
	CanAcceptHumanFollowup bool                     `json:"can_accept_human_followup"`
	HumanFollowupQueued    bool                     `json:"human_followup_queued"`
	HumanFollowupQueuedAt  *string                  `json:"human_followup_queued_at,omitempty"`
	ProcessID              int                      `json:"process_id"`
	ExitCode               *int                     `json:"exit_code,omitempty"`
	Error                  string                   `json:"error,omitempty"`
	CreatedAt              string                   `json:"created_at"`
	UpdatedAt              string                   `json:"updated_at"`
	FinishedAt             *string                  `json:"finished_at,omitempty"`
}

type queenSessionListResponse struct {
	Sessions []queenManagedSessionSnapshot `json:"sessions"`
}

type queenSessionManager struct {
	mu            sync.RWMutex
	startMu       sync.Mutex
	hydrationOnce sync.Once
	hydrationErr  error
	sessions      map[string]*queenManagedSession
	counter       uint64
}

var (
	errManagedQueenSessionAlreadyActive = errors.New("a managed queen session is already active")
	errQueenSessionNotFound             = errors.New("queen session not found")
	errQueenSessionNotAwaitingHuman     = errors.New("queen session is not awaiting human input")
	errQueenSessionHumanFollowupQueued  = errors.New("a human follow-up has already been queued for this session")

	managedQueenSessions       = newQueenSessionManager()
	queenProjectRootResolver   = resolveQueenProjectRoot
	queenSessionCommandBuilder = buildQueenSessionCommand
)

type queenSessionRuntimeState struct {
	Status           string                        `json:"status"`
	Reason           string                        `json:"reason,omitempty"`
	UpdatedAt        string                        `json:"updated_at"`
	ProcessID        int                           `json:"process_id,omitempty"`
	ProgressPhase    string                        `json:"progress_phase,omitempty"`
	ProgressTone     string                        `json:"progress_tone,omitempty"`
	ProgressNote     string                        `json:"progress_note,omitempty"`
	ResumeCheckpoint *queenSessionResumeCheckpoint `json:"resume_checkpoint,omitempty"`
	PendingTurn      *queenSessionPendingTurn      `json:"pending_turn,omitempty"`
	WorktreeEvidence *queenSessionWorktreeEvidence `json:"worktree_evidence,omitempty"`
}

type queenSessionResumeCheckpoint struct {
	Version          int    `json:"version"`
	QueenSessionID   string `json:"queen_session_id"`
	WorkerSessionID  string `json:"worker_session_id"`
	LoopTurnCount    int    `json:"loop_turn_count"`
	QueenTurnCount   int    `json:"queen_turn_count"`
	WorkerTurnCount  int    `json:"worker_turn_count"`
	HumanInputOffset int64  `json:"human_input_offset"`
}

type queenSessionPendingTurn struct {
	Version        int    `json:"version"`
	AgentName      string `json:"agent_name"`
	LoopTurnCount  int    `json:"loop_turn_count"`
	StartedAt      string `json:"started_at"`
	MessagePreview string `json:"message_preview,omitempty"`
}

type queenSessionWorktreeEvidence struct {
	Version          int      `json:"version"`
	CapturedAt       string   `json:"captured_at"`
	ChangedPathCount int      `json:"changed_path_count"`
	ChangedPaths     []string `json:"changed_paths,omitempty"`
	Summary          string   `json:"summary,omitempty"`
}

type queenManagedSessionManifest struct {
	ID                    string  `json:"id"`
	ProjectRoot           string  `json:"project_root"`
	Status                string  `json:"status"`
	Prompt                string  `json:"prompt"`
	TaskID                *int    `json:"task_id,omitempty"`
	MaxTurns              int     `json:"max_turns"`
	CooldownSeconds       float64 `json:"cooldown_seconds"`
	QueenFamily           string  `json:"queen_family,omitempty"`
	WorkerFamily          string  `json:"worker_family,omitempty"`
	TranscriptPath        string  `json:"transcript_path"`
	LogPath               string  `json:"log_path"`
	HumanInboxPath        string  `json:"human_inbox_path"`
	SessionStatePath      string  `json:"session_state_path"`
	ThreadID              string  `json:"thread_id,omitempty"`
	ThreadTitle           string  `json:"thread_title,omitempty"`
	StatusReason          string  `json:"status_reason,omitempty"`
	HumanFollowupQueued   bool    `json:"human_followup_queued"`
	HumanFollowupQueuedAt *string `json:"human_followup_queued_at,omitempty"`
	ProcessID             int     `json:"process_id"`
	ExitCode              *int    `json:"exit_code,omitempty"`
	Error                 string  `json:"error,omitempty"`
	CreatedAt             string  `json:"created_at"`
	UpdatedAt             string  `json:"updated_at"`
	FinishedAt            *string `json:"finished_at,omitempty"`
	StopRequested         bool    `json:"stop_requested"`
}

// QueenSessionsHandler lists managed sessions and starts new ones.
func QueenSessionsHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		httpresponse.RespondWithJSON(w, http.StatusOK, queenSessionListResponse{
			Sessions: managedQueenSessions.ListSessions(),
		})
	case http.MethodPost:
		var request queenSessionStartRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}

		snapshot, err := managedQueenSessions.StartSession(request)
		if err != nil {
			if errors.Is(err, errManagedQueenSessionAlreadyActive) {
				httpresponse.RespondWithError(w, http.StatusConflict, err.Error())
				return
			}
			httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
			return
		}

		httpresponse.RespondWithJSON(w, http.StatusCreated, map[string]any{
			"session": snapshot,
		})
	default:
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only GET and POST methods allowed")
	}
}

// QueenSessionHandler returns one managed session by id.
func QueenSessionHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only GET method allowed")
		return
	}

	sessionID := strings.TrimSpace(r.URL.Query().Get("id"))
	if sessionID == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "missing session id")
		return
	}

	snapshot, ok := managedQueenSessions.GetSnapshot(sessionID)
	if !ok {
		httpresponse.RespondWithError(w, http.StatusNotFound, errQueenSessionNotFound.Error())
		return
	}

	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]any{
		"session": snapshot,
	})
}

// QueenSessionStreamHandler streams managed session status updates over SSE.
func QueenSessionStreamHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only GET method allowed for SSE")
		return
	}

	sessionID := strings.TrimSpace(r.URL.Query().Get("id"))
	if sessionID == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "missing session id")
		return
	}

	initialSnapshot, ok := managedQueenSessions.GetSnapshot(sessionID)
	if !ok {
		httpresponse.RespondWithError(w, http.StatusNotFound, errQueenSessionNotFound.Error())
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "server does not support streaming")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	sendSnapshot := func(snapshot queenManagedSessionSnapshot) error {
		payload, err := json.Marshal(snapshot)
		if err != nil {
			return err
		}
		if _, err := fmt.Fprintf(w, "event: session\ndata: %s\n\n", payload); err != nil {
			return err
		}
		flusher.Flush()
		return nil
	}

	if err := sendSnapshot(initialSnapshot); err != nil {
		return
	}
	lastUpdatedAt := initialSnapshot.UpdatedAt

	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			snapshot, exists := managedQueenSessions.GetSnapshot(sessionID)
			if !exists {
				return
			}

			if snapshot.UpdatedAt != lastUpdatedAt {
				lastUpdatedAt = snapshot.UpdatedAt
				if err := sendSnapshot(snapshot); err != nil {
					return
				}
			} else {
				fmt.Fprint(w, ": keepalive\n\n")
				flusher.Flush()
			}

			if snapshot.Status == "completed" || snapshot.Status == "failed" || snapshot.Status == "stopped" {
				return
			}
		}
	}
}

// QueenSessionStopHandler requests graceful termination for one managed session.
func QueenSessionStopHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only POST method allowed")
		return
	}

	var request queenSessionStopRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	snapshot, err := managedQueenSessions.StopSession(strings.TrimSpace(request.ID))
	if err != nil {
		if errors.Is(err, errQueenSessionNotFound) {
			httpresponse.RespondWithError(w, http.StatusNotFound, err.Error())
			return
		}
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]any{
		"session": snapshot,
	})
}

// QueenSessionMessageHandler queues one browser-authored follow-up message for a managed session.
func QueenSessionMessageHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only POST method allowed")
		return
	}

	var request queenSessionMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	snapshot, err := managedQueenSessions.EnqueueHumanMessage(strings.TrimSpace(request.ID), request.Message)
	if err != nil {
		switch {
		case errors.Is(err, errQueenSessionNotFound):
			httpresponse.RespondWithError(w, http.StatusNotFound, err.Error())
		case errors.Is(err, errQueenSessionNotAwaitingHuman):
			httpresponse.RespondWithError(w, http.StatusConflict, err.Error())
		case errors.Is(err, errQueenSessionHumanFollowupQueued):
			httpresponse.RespondWithError(w, http.StatusConflict, err.Error())
		default:
			httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		}
		return
	}

	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]any{
		"session": snapshot,
	})
}

func newQueenSessionManager() *queenSessionManager {
	return &queenSessionManager{
		sessions: make(map[string]*queenManagedSession),
	}
}

func (manager *queenSessionManager) ensureHydrated() error {
	manager.hydrationOnce.Do(func() {
		projectRoot, err := queenProjectRootResolver()
		if err != nil {
			manager.hydrationErr = err
			return
		}

		hydratedSessions, err := loadQueenSessionRegistry(projectRoot)
		if err != nil {
			manager.hydrationErr = err
			return
		}

		manager.mu.Lock()
		defer manager.mu.Unlock()

		for _, session := range hydratedSessions {
			if existing, exists := manager.sessions[session.ID]; exists && existing != nil {
				continue
			}
			manager.sessions[session.ID] = session
		}
	})

	return manager.hydrationErr
}

func (manager *queenSessionManager) StartSession(request queenSessionStartRequest) (queenManagedSessionSnapshot, error) {
	if err := manager.ensureHydrated(); err != nil {
		return queenManagedSessionSnapshot{}, fmt.Errorf("could not hydrate queen session registry: %v", err)
	}

	prompt := strings.TrimSpace(request.Prompt)
	if prompt == "" {
		return queenManagedSessionSnapshot{}, fmt.Errorf("prompt is required")
	}

	maxTurns := 20
	if request.MaxTurns != nil {
		maxTurns = *request.MaxTurns
	}
	if maxTurns < 1 {
		return queenManagedSessionSnapshot{}, fmt.Errorf("max_turns must be at least 1")
	}

	cooldownSeconds := 2.0
	if request.CooldownSeconds != nil {
		cooldownSeconds = *request.CooldownSeconds
	}
	if cooldownSeconds < 0 {
		return queenManagedSessionSnapshot{}, fmt.Errorf("cooldown_seconds cannot be negative")
	}

	manager.startMu.Lock()
	defer manager.startMu.Unlock()

	manager.mu.Lock()
	if existing := manager.activeSessionLocked(); existing != nil {
		manager.mu.Unlock()
		return queenManagedSessionSnapshot{}, errManagedQueenSessionAlreadyActive
	}
	manager.mu.Unlock()

	projectRoot, err := queenProjectRootResolver()
	if err != nil {
		return queenManagedSessionSnapshot{}, fmt.Errorf("could not resolve queen project root: %v", err)
	}

	sessionID := manager.nextID()
	transcriptPath, logPath, humanInboxPath, sessionStatePath, err := prepareQueenSessionFiles(projectRoot, sessionID, request.TaskID)
	if err != nil {
		return queenManagedSessionSnapshot{}, fmt.Errorf("could not prepare queen session files: %v", err)
	}

	spec := queenManagedSessionCommandSpec{
		ID:               sessionID,
		Prompt:           prompt,
		TaskID:           request.TaskID,
		MaxTurns:         maxTurns,
		CooldownSeconds:  cooldownSeconds,
		QueenFamily:      strings.TrimSpace(request.QueenFamily),
		WorkerFamily:     strings.TrimSpace(request.WorkerFamily),
		ProjectRoot:      projectRoot,
		TranscriptPath:   transcriptPath,
		LogPath:          logPath,
		HumanInboxPath:   humanInboxPath,
		SessionStatePath: sessionStatePath,
	}

	threadRecord, err := ensureQueenThreadForStart(
		projectRoot,
		strings.TrimSpace(request.ThreadID),
		strings.TrimSpace(request.ContinueFromRun),
		filepath.Base(transcriptPath),
		strings.TrimSpace(request.TitleHint),
		request.TaskID,
	)
	if err != nil {
		return queenManagedSessionSnapshot{}, fmt.Errorf("could not prepare queen thread registry: %v", err)
	}

	process, err := launchQueenSessionProcess(context.Background(), spec)
	if err != nil {
		return queenManagedSessionSnapshot{}, fmt.Errorf("could not prepare queen subprocess: %v", err)
	}
	if err := process.Start(); err != nil {
		return queenManagedSessionSnapshot{}, fmt.Errorf("could not start queen subprocess: %v", err)
	}

	now := time.Now()
	session := &queenManagedSession{
		ID:                  sessionID,
		ProjectRoot:         projectRoot,
		Status:              "running",
		ProgressPhase:       "started",
		ProgressTone:        "info",
		ProgressNote:        "Queen started working on this conversation.",
		ProgressUpdatedAt:   &now,
		Prompt:              prompt,
		TaskID:              request.TaskID,
		MaxTurns:            maxTurns,
		CooldownSeconds:     cooldownSeconds,
		QueenFamily:         spec.QueenFamily,
		WorkerFamily:        spec.WorkerFamily,
		TranscriptPath:      transcriptPath,
		TranscriptName:      filepath.Base(transcriptPath),
		LogPath:             logPath,
		LogName:             filepath.Base(logPath),
		HumanInboxPath:      humanInboxPath,
		HumanInboxName:      filepath.Base(humanInboxPath),
		SessionStatePath:    sessionStatePath,
		SessionStateName:    filepath.Base(sessionStatePath),
		ThreadID:            threadRecord.ID,
		ThreadTitle:         threadRecord.Title,
		StatusReason:        "",
		HumanFollowupQueued: false,
		ProcessID:           process.PID(),
		CreatedAt:           now,
		UpdatedAt:           now,
		process:             process,
	}

	manager.mu.Lock()
	if existing := manager.activeSessionLocked(); existing != nil {
		manager.mu.Unlock()
		_ = process.SignalKill()
		go func() {
			_ = process.Wait()
		}()
		return queenManagedSessionSnapshot{}, errManagedQueenSessionAlreadyActive
	}
	manager.sessions[session.ID] = session
	if err := manager.persistSessionLocked(session); err != nil {
		delete(manager.sessions, session.ID)
		manager.mu.Unlock()
		_ = process.SignalKill()
		go func() {
			_ = process.Wait()
		}()
		return queenManagedSessionSnapshot{}, fmt.Errorf("could not persist queen session registry entry: %v", err)
	}
	snapshot := session.snapshot()
	manager.mu.Unlock()

	go manager.monitor(session.ID, process)

	return snapshot, nil
}

func (manager *queenSessionManager) ListSessions() []queenManagedSessionSnapshot {
	if err := manager.ensureHydrated(); err != nil {
		return []queenManagedSessionSnapshot{}
	}

	manager.mu.Lock()
	defer manager.mu.Unlock()

	snapshots := make([]queenManagedSessionSnapshot, 0, len(manager.sessions))
	for _, session := range manager.sessions {
		manager.refreshRuntimeStateLocked(session)
		snapshots = append(snapshots, session.snapshot())
	}
	sort.Slice(snapshots, func(i, j int) bool {
		return snapshots[i].CreatedAt > snapshots[j].CreatedAt
	})
	return snapshots
}

func (manager *queenSessionManager) GetSnapshot(sessionID string) (queenManagedSessionSnapshot, bool) {
	if err := manager.ensureHydrated(); err != nil {
		return queenManagedSessionSnapshot{}, false
	}

	manager.mu.Lock()
	defer manager.mu.Unlock()

	session, ok := manager.sessions[sessionID]
	if !ok {
		return queenManagedSessionSnapshot{}, false
	}
	manager.refreshRuntimeStateLocked(session)
	return session.snapshot(), true
}

func (manager *queenSessionManager) StopSession(sessionID string) (queenManagedSessionSnapshot, error) {
	if err := manager.ensureHydrated(); err != nil {
		return queenManagedSessionSnapshot{}, fmt.Errorf("could not hydrate queen session registry: %v", err)
	}
	if sessionID == "" {
		return queenManagedSessionSnapshot{}, fmt.Errorf("session id is required")
	}

	manager.mu.Lock()
	session, ok := manager.sessions[sessionID]
	if !ok {
		manager.mu.Unlock()
		return queenManagedSessionSnapshot{}, errQueenSessionNotFound
	}
	if session.Status == "completed" || session.Status == "failed" || session.Status == "stopped" {
		snapshot := session.snapshot()
		manager.mu.Unlock()
		return snapshot, nil
	}
	session.Status = "stopping"
	session.StopRequested = true
	session.UpdatedAt = time.Now()
	processID := session.ProcessID
	if err := manager.persistSessionLocked(session); err != nil {
		manager.mu.Unlock()
		return queenManagedSessionSnapshot{}, fmt.Errorf("could not persist queen session stop request: %v", err)
	}
	snapshot := session.snapshot()
	manager.mu.Unlock()

	if processID <= 0 {
		return snapshot, nil
	}
	if err := signalQueenSessionProcess(processID, syscall.SIGTERM); err != nil {
		return queenManagedSessionSnapshot{}, fmt.Errorf("could not stop queen session: %v", err)
	}

	go func(pid int) {
		time.Sleep(5 * time.Second)
		manager.mu.RLock()
		current, ok := manager.sessions[sessionID]
		manager.mu.RUnlock()
		if !ok || current.Status == "completed" || current.Status == "failed" || current.Status == "stopped" {
			return
		}
		_ = signalQueenSessionProcess(pid, syscall.SIGKILL)
	}(processID)

	return snapshot, nil
}

func (manager *queenSessionManager) EnqueueHumanMessage(sessionID string, message string) (queenManagedSessionSnapshot, error) {
	if err := manager.ensureHydrated(); err != nil {
		return queenManagedSessionSnapshot{}, fmt.Errorf("could not hydrate queen session registry: %v", err)
	}
	if sessionID == "" {
		return queenManagedSessionSnapshot{}, fmt.Errorf("session id is required")
	}

	trimmedMessage := strings.TrimSpace(message)
	if trimmedMessage == "" {
		return queenManagedSessionSnapshot{}, fmt.Errorf("message is required")
	}

	manager.mu.Lock()
	session, ok := manager.sessions[sessionID]
	if !ok {
		manager.mu.Unlock()
		return queenManagedSessionSnapshot{}, errQueenSessionNotFound
	}
	manager.refreshRuntimeStateLocked(session)
	if session.Status != "awaiting_human" {
		manager.mu.Unlock()
		return queenManagedSessionSnapshot{}, errQueenSessionNotAwaitingHuman
	}
	if session.HumanFollowupQueued {
		manager.mu.Unlock()
		return queenManagedSessionSnapshot{}, errQueenSessionHumanFollowupQueued
	}
	processAlive := queenSessionProcessAlive(session.ProcessID)
	now := time.Now()
	progressPhase := "resuming"
	progressNote := "Queen is resuming from a browser reply."
	var runtimeState queenSessionRuntimeState
	if !processAlive {
		var runtimeErr error
		runtimeState, _, runtimeErr = readQueenSessionRuntimeState(session.SessionStatePath)
		if runtimeErr == nil && queenSessionRuntimeHasRecoverablePendingWorkerTurn(runtimeState) {
			progressPhase = strings.TrimSpace(runtimeState.ProgressPhase)
			if progressPhase == "" {
				progressPhase = "reviewing_worker_result"
			}
			progressNote = strings.TrimSpace(runtimeState.ProgressNote)
			if progressNote == "" {
				progressNote = "Queen is reviewing the latest worker result."
			}
		}
	}
	if err := appendHumanInboxMessage(session.HumanInboxPath, trimmedMessage, now); err != nil {
		manager.mu.Unlock()
		return queenManagedSessionSnapshot{}, fmt.Errorf("could not queue human message: %v", err)
	}
	resumeReason := "Human reply received from the browser. Queen is resuming."
	if err := writeQueenSessionRuntimeState(
		session.SessionStatePath,
		"resuming",
		resumeReason,
		now,
		progressPhase,
		progressNote,
	); err != nil {
		manager.mu.Unlock()
		return queenManagedSessionSnapshot{}, fmt.Errorf("could not update queen session state: %v", err)
	}
	session.Status = "resuming"
	session.StatusReason = resumeReason
	session.ProgressPhase = progressPhase
	session.ProgressTone = queenSessionProgressToneForPhase(progressPhase)
	session.ProgressNote = progressNote
	session.ProgressUpdatedAt = &now
	if !processAlive {
		session.PendingTurn = cloneQueenSessionPendingTurn(runtimeState.PendingTurn)
	}
	session.HumanFollowupQueued = true
	session.HumanFollowupQueuedAt = &now
	session.UpdatedAt = now
	session.Error = ""
	session.ExitCode = nil
	session.FinishedAt = nil
	if !processAlive {
		if err := manager.relaunchResumingSessionLocked(session); err != nil {
			failedAt := time.Now()
			session.Status = "failed"
			session.Error = err.Error()
			session.ProcessID = 0
			session.process = nil
			session.FinishedAt = &failedAt
			session.UpdatedAt = failedAt
			_ = manager.persistSessionLocked(session)
			manager.mu.Unlock()
			return queenManagedSessionSnapshot{}, fmt.Errorf("could not relaunch resumed queen session: %v", err)
		}
	} else if err := manager.persistSessionLocked(session); err != nil {
		manager.mu.Unlock()
		return queenManagedSessionSnapshot{}, fmt.Errorf("could not persist queued human message state: %v", err)
	}
	snapshot := session.snapshot()
	manager.mu.Unlock()
	return snapshot, nil
}

func (manager *queenSessionManager) relaunchResumingSessionLocked(session *queenManagedSession) error {
	if session == nil {
		return fmt.Errorf("session is required")
	}

	spec := queenManagedSessionCommandSpec{
		ID:               session.ID,
		ResumeSessionID:  session.ID,
		Prompt:           session.Prompt,
		TaskID:           session.TaskID,
		MaxTurns:         session.MaxTurns,
		CooldownSeconds:  session.CooldownSeconds,
		QueenFamily:      session.QueenFamily,
		WorkerFamily:     session.WorkerFamily,
		ProjectRoot:      session.ProjectRoot,
		TranscriptPath:   session.TranscriptPath,
		LogPath:          session.LogPath,
		HumanInboxPath:   session.HumanInboxPath,
		SessionStatePath: session.SessionStatePath,
	}

	process, err := launchQueenSessionProcess(context.Background(), spec)
	if err != nil {
		return err
	}
	if err := process.Start(); err != nil {
		return err
	}

	session.process = process
	session.ProcessID = process.PID()
	session.UpdatedAt = time.Now()
	if err := manager.persistSessionLocked(session); err != nil {
		_ = process.SignalKill()
		go func() {
			_ = process.Wait()
		}()
		return err
	}

	go manager.monitor(session.ID, process)
	return nil
}

func (manager *queenSessionManager) monitor(sessionID string, process queenSessionProcess) {
	if process == nil {
		return
	}

	waitErr := process.Wait()
	now := time.Now()

	manager.mu.Lock()
	defer manager.mu.Unlock()

	current, ok := manager.sessions[sessionID]
	if !ok || current == nil || current.process != process {
		return
	}

	current.UpdatedAt = now
	current.FinishedAt = &now

	if waitErr == nil {
		exitCode := 0
		current.ExitCode = &exitCode
		current.HumanFollowupQueued = false
		current.HumanFollowupQueuedAt = nil
		if current.StopRequested || current.Status == "stopping" {
			current.Status = "stopped"
		} else {
			current.Status = "completed"
		}
		current.ProgressPhase = current.Status
		current.ProgressTone = queenSessionProgressToneForPhase(current.ProgressPhase)
		if current.Status == "completed" {
			current.ProgressNote = "Queen completed the managed session."
		} else {
			current.ProgressNote = "This managed Queen session was stopped."
		}
		current.ProgressUpdatedAt = &now
		current.PendingTurn = nil
		current.process = nil
		_ = manager.persistSessionLocked(current)
		return
	}

	current.Error = waitErr.Error()
	current.process = nil
	current.HumanFollowupQueued = false
	current.HumanFollowupQueuedAt = nil

	var exitError *exec.ExitError
	if errors.As(waitErr, &exitError) {
		exitCode := exitError.ExitCode()
		current.ExitCode = &exitCode
		if current.StopRequested || current.Status == "stopping" {
			current.Status = "stopped"
		} else {
			current.Status = "failed"
		}
		current.ProgressPhase = current.Status
		current.ProgressTone = queenSessionProgressToneForPhase(current.ProgressPhase)
		if current.Status == "stopped" {
			current.ProgressNote = "This managed Queen session was stopped."
		} else {
			current.ProgressNote = "This managed Queen session failed."
		}
		current.ProgressUpdatedAt = &now
		current.PendingTurn = nil
		_ = manager.persistSessionLocked(current)
		return
	}

	if current.StopRequested || current.Status == "stopping" {
		current.Status = "stopped"
		current.ProgressPhase = "stopped"
		current.ProgressTone = queenSessionProgressToneForPhase(current.ProgressPhase)
		current.ProgressNote = "This managed Queen session was stopped."
		current.ProgressUpdatedAt = &now
		current.PendingTurn = nil
		_ = manager.persistSessionLocked(current)
		return
	}
	current.Status = "failed"
	current.ProgressPhase = "failed"
	current.ProgressTone = queenSessionProgressToneForPhase(current.ProgressPhase)
	current.ProgressNote = "This managed Queen session failed."
	current.ProgressUpdatedAt = &now
	current.PendingTurn = nil
	_ = manager.persistSessionLocked(current)
}

func (manager *queenSessionManager) nextID() string {
	sequence := atomic.AddUint64(&manager.counter, 1)
	return fmt.Sprintf("qs_%s_%03d", time.Now().Format("20060102_150405"), sequence)
}

func (manager *queenSessionManager) activeSessionLocked() *queenManagedSession {
	for _, session := range manager.sessions {
		manager.refreshRuntimeStateLocked(session)
		if isManagedSessionActiveStatus(session.Status) {
			return session
		}
	}
	return nil
}

func isManagedSessionActiveStatus(status string) bool {
	return status == "running" || status == "awaiting_human" || status == "resuming" || status == "stopping"
}

func isManagedSessionTerminalStatus(status string) bool {
	return status == "completed" || status == "failed" || status == "stopped"
}

func (session *queenManagedSession) snapshot() queenManagedSessionSnapshot {
	var finishedAt *string
	if session.FinishedAt != nil {
		formatted := session.FinishedAt.Format(time.RFC3339)
		finishedAt = &formatted
	}
	var humanFollowupQueuedAt *string
	if session.HumanFollowupQueuedAt != nil {
		formatted := session.HumanFollowupQueuedAt.Format(time.RFC3339)
		humanFollowupQueuedAt = &formatted
	}
	var progressUpdatedAt *string
	if session.ProgressUpdatedAt != nil {
		formatted := session.ProgressUpdatedAt.Format(time.RFC3339)
		progressUpdatedAt = &formatted
	}
	var pendingTurn *queenSessionPendingTurn
	if session.PendingTurn != nil && session.PendingTurn.isValid() {
		clonedTurn := *session.PendingTurn
		pendingTurn = &clonedTurn
	}

	return queenManagedSessionSnapshot{
		ID:                     session.ID,
		Status:                 session.Status,
		StatusReason:           session.StatusReason,
		ProgressPhase:          session.ProgressPhase,
		ProgressTone:           session.ProgressTone,
		ProgressNote:           session.ProgressNote,
		ProgressUpdatedAt:      progressUpdatedAt,
		PendingTurn:            pendingTurn,
		Prompt:                 queenPromptPreview(session.Prompt),
		TaskID:                 session.TaskID,
		MaxTurns:               session.MaxTurns,
		CooldownSeconds:        session.CooldownSeconds,
		QueenFamily:            session.QueenFamily,
		WorkerFamily:           session.WorkerFamily,
		ThreadID:               session.ThreadID,
		ThreadTitle:            session.ThreadTitle,
		TranscriptName:         session.TranscriptName,
		TranscriptFilename:     session.TranscriptName,
		LogName:                session.LogName,
		LogFilename:            session.LogName,
		CanAcceptHumanFollowup: session.Status == "awaiting_human" && !session.HumanFollowupQueued,
		HumanFollowupQueued:    session.HumanFollowupQueued,
		HumanFollowupQueuedAt:  humanFollowupQueuedAt,
		ProcessID:              session.ProcessID,
		ExitCode:               session.ExitCode,
		Error:                  session.Error,
		CreatedAt:              session.CreatedAt.Format(time.RFC3339),
		UpdatedAt:              session.UpdatedAt.Format(time.RFC3339),
		FinishedAt:             finishedAt,
	}
}

func queenPromptPreview(prompt string) string {
	normalized := strings.Join(strings.Fields(prompt), " ")
	if len(normalized) <= 140 {
		return normalized
	}
	return normalized[:140] + "..."
}

func (manager *queenSessionManager) refreshRuntimeStateLocked(session *queenManagedSession) {
	if session == nil {
		return
	}
	if isManagedSessionTerminalStatus(session.Status) {
		return
	}

	changed := false
	runtimeState, updatedAt, err := readQueenSessionRuntimeState(session.SessionStatePath)
	if err == nil {
		if !queenSessionOptionalTimeEqual(session.ProgressUpdatedAt, &updatedAt) {
			progressUpdatedAt := updatedAt
			session.ProgressUpdatedAt = &progressUpdatedAt
			changed = true
		}
		if session.ProgressPhase != runtimeState.ProgressPhase {
			session.ProgressPhase = runtimeState.ProgressPhase
			changed = true
		}
		if session.ProgressTone != runtimeState.ProgressTone {
			session.ProgressTone = runtimeState.ProgressTone
			changed = true
		}
		if session.ProgressNote != runtimeState.ProgressNote {
			session.ProgressNote = runtimeState.ProgressNote
			changed = true
		}
		if !queenSessionPendingTurnEqual(session.PendingTurn, runtimeState.PendingTurn) {
			session.PendingTurn = cloneQueenSessionPendingTurn(runtimeState.PendingTurn)
			changed = true
		}
		switch runtimeState.Status {
		case "running":
			if session.Status != "running" {
				session.Status = "running"
				changed = true
			}
			if session.StatusReason != runtimeState.Reason {
				session.StatusReason = runtimeState.Reason
				changed = true
			}
			if session.HumanFollowupQueued {
				session.HumanFollowupQueued = false
				changed = true
			}
			if session.HumanFollowupQueuedAt != nil {
				session.HumanFollowupQueuedAt = nil
				changed = true
			}
		case "awaiting_human":
			if session.Status != "awaiting_human" {
				session.Status = "awaiting_human"
				changed = true
			}
			if session.StatusReason != runtimeState.Reason {
				session.StatusReason = runtimeState.Reason
				changed = true
			}
			if session.HumanFollowupQueued {
				session.HumanFollowupQueued = false
				changed = true
			}
			if session.HumanFollowupQueuedAt != nil {
				session.HumanFollowupQueuedAt = nil
				changed = true
			}
		case "resuming":
			if session.Status != "resuming" {
				session.Status = "resuming"
				changed = true
			}
			if session.StatusReason != runtimeState.Reason {
				session.StatusReason = runtimeState.Reason
				changed = true
			}
			if !session.HumanFollowupQueued {
				session.HumanFollowupQueued = true
				changed = true
			}
			if session.HumanFollowupQueuedAt == nil {
				queuedAt := updatedAt
				session.HumanFollowupQueuedAt = &queuedAt
				changed = true
			}
		}

		if updatedAt.After(session.UpdatedAt) {
			session.UpdatedAt = updatedAt
			changed = true
		}
	}

	if session.StopRequested && queenSessionProcessAlive(session.ProcessID) {
		if session.Status != "stopping" {
			session.Status = "stopping"
			changed = true
		}
		if session.StatusReason != "" {
			session.StatusReason = ""
			changed = true
		}
	}

	// A locally launched process has a monitor goroutine that owns its terminal
	// transition and final registry write. Falling back to process liveness while
	// that monitor is still attached can expose a terminal snapshot before the
	// monitor has finished persisting it, allowing callers to tear down the
	// session directory underneath the final write. Hydrated sessions have no
	// process handle, so they still need the liveness-based recovery below.
	if isManagedSessionActiveStatus(session.Status) && session.process == nil && !queenSessionProcessAlive(session.ProcessID) {
		now := time.Now()
		session.process = nil
		if queenTranscriptEndsWithDone(session.TranscriptPath) {
			session.Status = "completed"
			session.StatusReason = ""
			session.ProgressPhase = "completed"
			session.ProgressTone = queenSessionProgressToneForPhase(session.ProgressPhase)
			session.ProgressNote = "Queen completed the managed session."
			session.ProgressUpdatedAt = &now
			session.PendingTurn = nil
			session.HumanFollowupQueued = false
			session.HumanFollowupQueuedAt = nil
			session.ProcessID = 0
			if session.ExitCode == nil {
				exitCode := 0
				session.ExitCode = &exitCode
			}
			session.FinishedAt = &now
		} else if session.StopRequested || session.Status == "stopping" {
			session.Status = "stopped"
			session.StatusReason = ""
			session.ProgressPhase = "stopped"
			session.ProgressTone = queenSessionProgressToneForPhase(session.ProgressPhase)
			session.ProgressNote = "This managed Queen session was stopped."
			session.ProgressUpdatedAt = &now
			session.PendingTurn = nil
			session.HumanFollowupQueued = false
			session.HumanFollowupQueuedAt = nil
			session.ProcessID = 0
			session.FinishedAt = &now
		} else if queenSessionRuntimeHasRecoverablePendingWorkerTurn(runtimeState) {
			session.Status = "awaiting_human"
			session.StatusReason = queenSessionPendingWorkerTurnReason(runtimeState)
			session.HumanFollowupQueued = false
			session.HumanFollowupQueuedAt = nil
			session.ProcessID = 0
			session.ExitCode = nil
			session.Error = ""
			session.FinishedAt = nil
		} else if queenSessionRuntimeHasRecoverablePendingQueenTurn(runtimeState) {
			session.Status = "failed"
			session.StatusReason = queenSessionPendingQueenTurnReason(runtimeState)
			session.HumanFollowupQueued = false
			session.HumanFollowupQueuedAt = nil
			session.ProcessID = 0
			session.ExitCode = nil
			session.Error = session.StatusReason
			session.ProgressUpdatedAt = &now
			session.FinishedAt = &now
		} else if queenSessionRuntimeCanResume(runtimeState) {
			session.ProcessID = 0
			session.ExitCode = nil
			session.Error = ""
			session.FinishedAt = nil
		} else {
			session.Status = "failed"
			session.StatusReason = ""
			session.ProgressPhase = "failed"
			session.ProgressTone = queenSessionProgressToneForPhase(session.ProgressPhase)
			session.ProgressNote = "This managed Queen session failed."
			session.ProgressUpdatedAt = &now
			session.PendingTurn = nil
			session.HumanFollowupQueued = false
			session.HumanFollowupQueuedAt = nil
			session.ProcessID = 0
			if strings.TrimSpace(session.Error) == "" {
				session.Error = "Managed Queen process is no longer running."
			}
			session.FinishedAt = &now
		}
		if now.After(session.UpdatedAt) {
			session.UpdatedAt = now
		}
		changed = true
	}

	if changed {
		_ = manager.persistSessionLocked(session)
	}
}

func (manager *queenSessionManager) persistSessionLocked(session *queenManagedSession) error {
	if session == nil || strings.TrimSpace(session.ProjectRoot) == "" {
		return nil
	}

	registryDir := queenSessionRegistryDir(session.ProjectRoot)
	if err := os.MkdirAll(registryDir, 0o755); err != nil {
		return err
	}

	payload, err := json.Marshal(session.manifest())
	if err != nil {
		return err
	}

	manifestPath := queenSessionManifestPath(session.ProjectRoot, session.ID)
	tmpFile, err := os.CreateTemp(registryDir, filepath.Base(manifestPath)+".tmp-*")
	if err != nil {
		return err
	}
	tmpPath := tmpFile.Name()
	defer func() {
		_ = os.Remove(tmpPath)
	}()

	if _, err := tmpFile.Write(append(payload, '\n')); err != nil {
		_ = tmpFile.Close()
		return err
	}
	if err := tmpFile.Chmod(0o644); err != nil {
		_ = tmpFile.Close()
		return err
	}
	if err := tmpFile.Close(); err != nil {
		return err
	}

	return os.Rename(tmpPath, manifestPath)
}

func (session *queenManagedSession) manifest() queenManagedSessionManifest {
	var humanFollowupQueuedAt *string
	if session.HumanFollowupQueuedAt != nil {
		formatted := session.HumanFollowupQueuedAt.Format(time.RFC3339Nano)
		humanFollowupQueuedAt = &formatted
	}
	var finishedAt *string
	if session.FinishedAt != nil {
		formatted := session.FinishedAt.Format(time.RFC3339Nano)
		finishedAt = &formatted
	}

	return queenManagedSessionManifest{
		ID:                    session.ID,
		ProjectRoot:           session.ProjectRoot,
		Status:                session.Status,
		Prompt:                session.Prompt,
		TaskID:                session.TaskID,
		MaxTurns:              session.MaxTurns,
		CooldownSeconds:       session.CooldownSeconds,
		QueenFamily:           session.QueenFamily,
		WorkerFamily:          session.WorkerFamily,
		TranscriptPath:        session.TranscriptPath,
		LogPath:               session.LogPath,
		HumanInboxPath:        session.HumanInboxPath,
		SessionStatePath:      session.SessionStatePath,
		ThreadID:              session.ThreadID,
		ThreadTitle:           session.ThreadTitle,
		StatusReason:          session.StatusReason,
		HumanFollowupQueued:   session.HumanFollowupQueued,
		HumanFollowupQueuedAt: humanFollowupQueuedAt,
		ProcessID:             session.ProcessID,
		ExitCode:              session.ExitCode,
		Error:                 session.Error,
		CreatedAt:             session.CreatedAt.Format(time.RFC3339Nano),
		UpdatedAt:             session.UpdatedAt.Format(time.RFC3339Nano),
		FinishedAt:            finishedAt,
		StopRequested:         session.StopRequested,
	}
}

func loadQueenSessionRegistry(projectRoot string) ([]*queenManagedSession, error) {
	registryDir := queenSessionRegistryDir(projectRoot)
	entries, err := os.ReadDir(registryDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []*queenManagedSession{}, nil
		}
		return nil, err
	}

	sessions := make([]*queenManagedSession, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}

		payload, err := os.ReadFile(filepath.Join(registryDir, entry.Name()))
		if err != nil {
			return nil, err
		}

		var manifest queenManagedSessionManifest
		if err := json.Unmarshal(payload, &manifest); err != nil {
			return nil, err
		}

		session, err := queenManagedSessionFromManifest(manifest, projectRoot)
		if err != nil {
			return nil, err
		}
		sessions = append(sessions, session)
	}

	return sessions, nil
}

func queenManagedSessionFromManifest(manifest queenManagedSessionManifest, fallbackProjectRoot string) (*queenManagedSession, error) {
	projectRoot := strings.TrimSpace(manifest.ProjectRoot)
	if projectRoot == "" {
		projectRoot = fallbackProjectRoot
	}

	createdAt, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(manifest.CreatedAt))
	if err != nil {
		return nil, err
	}
	updatedAt, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(manifest.UpdatedAt))
	if err != nil {
		return nil, err
	}

	humanFollowupQueuedAt, err := parseQueenSessionOptionalTime(manifest.HumanFollowupQueuedAt)
	if err != nil {
		return nil, err
	}
	finishedAt, err := parseQueenSessionOptionalTime(manifest.FinishedAt)
	if err != nil {
		return nil, err
	}

	return &queenManagedSession{
		ID:                    manifest.ID,
		ProjectRoot:           projectRoot,
		Status:                manifest.Status,
		Prompt:                manifest.Prompt,
		TaskID:                manifest.TaskID,
		MaxTurns:              manifest.MaxTurns,
		CooldownSeconds:       manifest.CooldownSeconds,
		QueenFamily:           manifest.QueenFamily,
		WorkerFamily:          manifest.WorkerFamily,
		TranscriptPath:        manifest.TranscriptPath,
		TranscriptName:        filepath.Base(manifest.TranscriptPath),
		LogPath:               manifest.LogPath,
		LogName:               filepath.Base(manifest.LogPath),
		HumanInboxPath:        manifest.HumanInboxPath,
		HumanInboxName:        filepath.Base(manifest.HumanInboxPath),
		SessionStatePath:      manifest.SessionStatePath,
		SessionStateName:      filepath.Base(manifest.SessionStatePath),
		ThreadID:              manifest.ThreadID,
		ThreadTitle:           manifest.ThreadTitle,
		StatusReason:          manifest.StatusReason,
		HumanFollowupQueued:   manifest.HumanFollowupQueued,
		HumanFollowupQueuedAt: humanFollowupQueuedAt,
		ProcessID:             manifest.ProcessID,
		ExitCode:              manifest.ExitCode,
		Error:                 manifest.Error,
		CreatedAt:             createdAt,
		UpdatedAt:             updatedAt,
		FinishedAt:            finishedAt,
		StopRequested:         manifest.StopRequested,
	}, nil
}

func parseQueenSessionOptionalTime(raw *string) (*time.Time, error) {
	if raw == nil || strings.TrimSpace(*raw) == "" {
		return nil, nil
	}

	parsed, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(*raw))
	if err != nil {
		return nil, err
	}
	return &parsed, nil
}

func queenSessionRegistryDir(projectRoot string) string {
	return filepath.Join(projectRoot, ".queen", "session_registry")
}

func queenSessionManifestPath(projectRoot string, sessionID string) string {
	return filepath.Join(queenSessionRegistryDir(projectRoot), fmt.Sprintf("queen_session_%s.json", sessionID))
}

func resolveQueenProjectRoot() (string, error) {
	if override := strings.TrimSpace(os.Getenv("QUEEN_PROJECT_ROOT")); override != "" {
		return filepath.Abs(override)
	}

	transcriptDir, err := filepath.Abs(queenTranscriptDirResolver())
	if err == nil {
		candidate := filepath.Dir(filepath.Dir(transcriptDir))
		if info, statErr := os.Stat(filepath.Join(candidate, "main.go")); statErr == nil && !info.IsDir() {
			return candidate, nil
		}
	}

	return os.Getwd()
}

func prepareQueenSessionFiles(projectRoot string, sessionID string, taskID *int) (string, string, string, string, error) {
	transcriptDir := filepath.Join(projectRoot, ".queen", "transcripts")
	logDir := filepath.Join(projectRoot, ".queen", "session_logs")
	humanInboxDir := filepath.Join(projectRoot, ".queen", "session_inputs")
	sessionStateDir := filepath.Join(projectRoot, ".queen", "session_state")
	if err := os.MkdirAll(transcriptDir, 0o755); err != nil {
		return "", "", "", "", err
	}
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		return "", "", "", "", err
	}
	if err := os.MkdirAll(humanInboxDir, 0o755); err != nil {
		return "", "", "", "", err
	}
	if err := os.MkdirAll(sessionStateDir, 0o755); err != nil {
		return "", "", "", "", err
	}

	timestamp := time.Now().Format("20060102_150405")
	taskLabel := "manual"
	if taskID != nil {
		taskLabel = fmt.Sprintf("task_%d", *taskID)
	}

	transcriptPath := filepath.Join(transcriptDir, fmt.Sprintf("queen_run_%s_%s_session_%s.jsonl", timestamp, taskLabel, sessionID))
	logPath := filepath.Join(logDir, fmt.Sprintf("queen_session_%s.log", sessionID))
	humanInboxPath := filepath.Join(humanInboxDir, fmt.Sprintf("queen_session_%s_human_inbox.jsonl", sessionID))
	sessionStatePath := filepath.Join(sessionStateDir, fmt.Sprintf("queen_session_%s_state.json", sessionID))

	if err := os.WriteFile(transcriptPath, []byte(""), 0o644); err != nil {
		return "", "", "", "", err
	}
	if err := os.WriteFile(humanInboxPath, []byte(""), 0o644); err != nil {
		return "", "", "", "", err
	}
	if err := writeQueenSessionRuntimeState(
		sessionStatePath,
		"running",
		"",
		time.Now(),
		"started",
		"Queen started working on this conversation.",
	); err != nil {
		return "", "", "", "", err
	}

	return transcriptPath, logPath, humanInboxPath, sessionStatePath, nil
}

func launchQueenSessionProcess(ctx context.Context, spec queenManagedSessionCommandSpec) (queenSessionProcess, error) {
	logFile, err := os.OpenFile(spec.LogPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return nil, err
	}

	cmd := queenSessionCommandBuilder(ctx, spec)
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	cmd.Stdin = nil
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	return &execQueenSessionProcess{
		cmd:     cmd,
		logFile: logFile,
	}, nil
}

func buildQueenSessionCommand(ctx context.Context, spec queenManagedSessionCommandSpec) *exec.Cmd {
	args := []string{"-m", "server_tools.queen", "run"}
	if strings.TrimSpace(spec.ResumeSessionID) != "" {
		args = append(args, "--resume-managed-session", spec.ResumeSessionID)
	} else {
		args = append(args, spec.Prompt)
	}
	args = append(
		args,
		"--transcript-path", spec.TranscriptPath,
		"--max-turns", fmt.Sprintf("%d", spec.MaxTurns),
		"--cooldown-seconds", fmt.Sprintf("%.2f", spec.CooldownSeconds),
	)
	if spec.TaskID != nil {
		args = append(args, "--task-id", fmt.Sprintf("%d", *spec.TaskID))
	}
	if spec.QueenFamily != "" {
		args = append(args, "--queen-family", spec.QueenFamily)
	}
	if spec.WorkerFamily != "" {
		args = append(args, "--worker-family", spec.WorkerFamily)
	}
	if spec.HumanInboxPath != "" {
		args = append(args, "--human-inbox-path", spec.HumanInboxPath)
	}
	if spec.SessionStatePath != "" {
		args = append(args, "--human-state-path", spec.SessionStatePath)
	}

	command := exec.CommandContext(ctx, "python3", args...)
	command.Dir = spec.ProjectRoot
	return command
}

func writeQueenSessionRuntimeState(
	sessionStatePath string,
	status string,
	reason string,
	updatedAt time.Time,
	progressPhase string,
	progressNote string,
) error {
	existingState, _, err := readQueenSessionRuntimeState(sessionStatePath)
	if err != nil && !os.IsNotExist(err) {
		return err
	}

	currentProgressPhase := strings.TrimSpace(progressPhase)
	if currentProgressPhase == "" {
		currentProgressPhase = strings.TrimSpace(existingState.ProgressPhase)
	}
	currentProgressTone := ""
	if currentProgressPhase != "" {
		currentProgressTone = queenSessionProgressToneForPhase(currentProgressPhase)
	}
	currentProgressNote := strings.TrimSpace(progressNote)
	if currentProgressNote == "" {
		currentProgressNote = strings.TrimSpace(existingState.ProgressNote)
	}

	payload, err := json.Marshal(queenSessionRuntimeState{
		Status:           status,
		Reason:           reason,
		UpdatedAt:        updatedAt.Format(time.RFC3339),
		ProgressPhase:    currentProgressPhase,
		ProgressTone:     currentProgressTone,
		ProgressNote:     currentProgressNote,
		ResumeCheckpoint: existingState.ResumeCheckpoint,
		PendingTurn:      existingState.PendingTurn,
	})
	if err != nil {
		return err
	}

	stateDir := filepath.Dir(sessionStatePath)
	tmpFile, err := os.CreateTemp(stateDir, filepath.Base(sessionStatePath)+".tmp-*")
	if err != nil {
		return err
	}
	tmpPath := tmpFile.Name()
	defer func() {
		_ = os.Remove(tmpPath)
	}()

	if _, err := tmpFile.Write(append(payload, '\n')); err != nil {
		_ = tmpFile.Close()
		return err
	}
	if err := tmpFile.Chmod(0o644); err != nil {
		_ = tmpFile.Close()
		return err
	}
	if err := tmpFile.Close(); err != nil {
		return err
	}

	return os.Rename(tmpPath, sessionStatePath)
}

func readQueenSessionRuntimeState(sessionStatePath string) (queenSessionRuntimeState, time.Time, error) {
	payload, err := os.ReadFile(sessionStatePath)
	if err != nil {
		return queenSessionRuntimeState{}, time.Time{}, err
	}

	var state queenSessionRuntimeState
	if err := json.Unmarshal(payload, &state); err != nil {
		return queenSessionRuntimeState{}, time.Time{}, err
	}
	updatedAt, err := time.Parse(time.RFC3339, strings.TrimSpace(state.UpdatedAt))
	if err != nil {
		return queenSessionRuntimeState{}, time.Time{}, err
	}
	return state, updatedAt, nil
}

func queenSessionProgressToneForPhase(progressPhase string) string {
	switch strings.ToLower(strings.TrimSpace(progressPhase)) {
	case "awaiting_human":
		return "warning"
	case "completed":
		return "success"
	case "stopped":
		return "stopped"
	case "failed":
		return "danger"
	case "started", "delegating_to_worker", "reviewing_worker_result", "resuming":
		return "info"
	default:
		return "info"
	}
}

func (checkpoint *queenSessionResumeCheckpoint) isValid() bool {
	if checkpoint == nil {
		return false
	}
	return strings.TrimSpace(checkpoint.QueenSessionID) != "" &&
		strings.TrimSpace(checkpoint.WorkerSessionID) != "" &&
		checkpoint.LoopTurnCount >= 0 &&
		checkpoint.QueenTurnCount >= 0 &&
		checkpoint.WorkerTurnCount >= 0 &&
		checkpoint.HumanInputOffset >= 0
}

func (pendingTurn *queenSessionPendingTurn) isValid() bool {
	if pendingTurn == nil {
		return false
	}
	return strings.TrimSpace(pendingTurn.AgentName) != "" &&
		pendingTurn.LoopTurnCount >= 0 &&
		strings.TrimSpace(pendingTurn.StartedAt) != ""
}

func (pendingTurn *queenSessionPendingTurn) isWorkerTurn() bool {
	if pendingTurn == nil {
		return false
	}
	lowered := strings.ToLower(strings.TrimSpace(pendingTurn.AgentName))
	return lowered == "worker" || lowered == "heisenberg"
}

func (pendingTurn *queenSessionPendingTurn) isQueenTurn() bool {
	if pendingTurn == nil {
		return false
	}
	return strings.ToLower(strings.TrimSpace(pendingTurn.AgentName)) == "queen"
}

func cloneQueenSessionPendingTurn(pendingTurn *queenSessionPendingTurn) *queenSessionPendingTurn {
	if pendingTurn == nil {
		return nil
	}
	clonedTurn := *pendingTurn
	return &clonedTurn
}

func queenSessionPendingTurnEqual(left *queenSessionPendingTurn, right *queenSessionPendingTurn) bool {
	switch {
	case left == nil && right == nil:
		return true
	case left == nil || right == nil:
		return false
	default:
		return left.Version == right.Version &&
			left.AgentName == right.AgentName &&
			left.LoopTurnCount == right.LoopTurnCount &&
			left.StartedAt == right.StartedAt &&
			left.MessagePreview == right.MessagePreview
	}
}

func queenSessionOptionalTimeEqual(left *time.Time, right *time.Time) bool {
	switch {
	case left == nil && right == nil:
		return true
	case left == nil || right == nil:
		return false
	default:
		return left.Equal(*right)
	}
}

func queenSessionRuntimeCanResume(state queenSessionRuntimeState) bool {
	return (state.Status == "awaiting_human" || state.Status == "resuming") &&
		state.ResumeCheckpoint != nil &&
		state.ResumeCheckpoint.isValid()
}

func queenSessionRuntimeHasRecoverablePendingWorkerTurn(state queenSessionRuntimeState) bool {
	return state.ResumeCheckpoint != nil &&
		state.ResumeCheckpoint.isValid() &&
		state.PendingTurn != nil &&
		state.PendingTurn.isValid() &&
		state.PendingTurn.isWorkerTurn()
}

func queenSessionPendingWorkerTurnReason(state queenSessionRuntimeState) string {
	if state.PendingTurn == nil {
		return "Queen stopped while waiting for a worker reply. Review the situation and tell Queen how to continue."
	}
	preview := strings.TrimSpace(state.PendingTurn.MessagePreview)
	if preview == "" {
		return fmt.Sprintf(
			"Queen stopped while waiting for %s's reply. Review the situation and tell Queen how to continue.",
			state.PendingTurn.AgentName,
		)
	}
	return fmt.Sprintf(
		"Queen stopped while waiting for %s's reply to: %s Review the situation and tell Queen how to continue.",
		state.PendingTurn.AgentName,
		preview,
	)
}

func queenSessionRuntimeHasRecoverablePendingQueenTurn(state queenSessionRuntimeState) bool {
	return state.ResumeCheckpoint != nil &&
		state.ResumeCheckpoint.isValid() &&
		state.PendingTurn != nil &&
		state.PendingTurn.isValid() &&
		state.PendingTurn.isQueenTurn()
}

func queenSessionPendingQueenTurnReason(state queenSessionRuntimeState) string {
	if state.PendingTurn == nil {
		return "Queen stopped mid-turn. The safest recovery is human-guided continuation from the transcript."
	}
	agentName := strings.TrimSpace(state.PendingTurn.AgentName)
	preview := strings.TrimSpace(state.PendingTurn.MessagePreview)
	if preview == "" {
		return fmt.Sprintf(
			"Queen stopped while mid-turn handling %s's reply. The safest recovery is human-guided continuation from the transcript.",
			agentName,
		)
	}
	return fmt.Sprintf(
		"Queen stopped while mid-turn handling %s's reply to: %s The safest recovery is human-guided continuation from the transcript.",
		agentName,
		preview,
	)
}

func appendHumanInboxMessage(humanInboxPath string, message string, queuedAt time.Time) error {
	if strings.TrimSpace(humanInboxPath) == "" {
		return fmt.Errorf("human inbox path is required")
	}

	file, err := os.OpenFile(humanInboxPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}
	defer file.Close()

	payload, err := json.Marshal(map[string]string{
		"message":   message,
		"timestamp": queuedAt.Format(time.RFC3339),
		"source":    "browser",
	})
	if err != nil {
		return err
	}

	if _, err := file.Write(append(payload, '\n')); err != nil {
		return err
	}
	return nil
}

func queenSessionProcessAlive(processID int) bool {
	if processID <= 0 {
		return false
	}

	err := syscall.Kill(processID, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}

func signalQueenSessionProcess(processID int, signal syscall.Signal) error {
	if processID <= 0 {
		return nil
	}
	return syscall.Kill(-processID, signal)
}

func queenTranscriptEndsWithDone(transcriptPath string) bool {
	payload, err := os.ReadFile(transcriptPath)
	if err != nil {
		return false
	}

	lines := strings.Split(string(payload), "\n")
	for index := len(lines) - 1; index >= 0; index-- {
		line := strings.TrimSpace(lines[index])
		if line == "" {
			continue
		}

		var entry queenTranscriptEntry
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			return false
		}
		return strings.Contains(strings.ToLower(entry.Text), "[done]")
	}

	return false
}

func (process *execQueenSessionProcess) Start() error {
	return process.cmd.Start()
}

func (process *execQueenSessionProcess) Wait() error {
	defer func() {
		if process.logFile != nil {
			_ = process.logFile.Close()
		}
	}()
	return process.cmd.Wait()
}

func (process *execQueenSessionProcess) PID() int {
	if process.cmd.Process == nil {
		return 0
	}
	return process.cmd.Process.Pid
}

func (process *execQueenSessionProcess) SignalTerminate() error {
	if process.cmd.Process == nil {
		return nil
	}
	return syscall.Kill(-process.cmd.Process.Pid, syscall.SIGTERM)
}

func (process *execQueenSessionProcess) SignalKill() error {
	if process.cmd.Process == nil {
		return nil
	}
	return syscall.Kill(-process.cmd.Process.Pid, syscall.SIGKILL)
}
