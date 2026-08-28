// queen_chat_handler.go
// Admin-only HTTP handlers for browsing Queen JSONL transcripts in the browser.
// Bridges the local .queen/transcripts directory with JSON and SSE responses for the SPA admin tools.
// Exists to expose the existing read-only Queen chat logs without requiring terminal-only tooling.
package devtools

import (
	"bufio"
	"easelect/backend/core_components/httpresponse"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type queenRunSummary struct {
	Filename          string                        `json:"filename"`
	Timestamp         string                        `json:"timestamp"`
	TaskID            string                        `json:"task_id"`
	MessageCount      int                           `json:"message_count"`
	Roles             []string                      `json:"roles"`
	ThreadID          string                        `json:"thread_id,omitempty"`
	ThreadTitle       string                        `json:"thread_title,omitempty"`
	ThreadRuns        int                           `json:"thread_runs,omitempty"`
	Status            string                        `json:"status,omitempty"`
	StatusReason      string                        `json:"status_reason,omitempty"`
	ProgressPhase     string                        `json:"progress_phase,omitempty"`
	ProgressTone      string                        `json:"progress_tone,omitempty"`
	ProgressNote      string                        `json:"progress_note,omitempty"`
	ProgressUpdatedAt string                        `json:"progress_updated_at,omitempty"`
	ProcessID         int                           `json:"process_id,omitempty"`
	ProcessAlive      bool                          `json:"process_alive,omitempty"`
	PendingTurn       *queenSessionPendingTurn      `json:"pending_turn,omitempty"`
	WorktreeEvidence  *queenSessionWorktreeEvidence `json:"worktree_evidence,omitempty"`
}

type queenTranscriptEntry struct {
	Role      string `json:"role"`
	Agent     string `json:"agent"`
	Text      string `json:"text"`
	Turn      int    `json:"turn"`
	Timestamp string `json:"timestamp"`
}

type queenRunRuntimeSnapshot struct {
	Status            string                        `json:"status,omitempty"`
	StatusReason      string                        `json:"status_reason,omitempty"`
	ProgressPhase     string                        `json:"progress_phase,omitempty"`
	ProgressTone      string                        `json:"progress_tone,omitempty"`
	ProgressNote      string                        `json:"progress_note,omitempty"`
	ProgressUpdatedAt string                        `json:"progress_updated_at,omitempty"`
	ProcessID         int                           `json:"process_id,omitempty"`
	ProcessAlive      bool                          `json:"process_alive,omitempty"`
	PendingTurn       *queenSessionPendingTurn      `json:"pending_turn,omitempty"`
	WorktreeEvidence  *queenSessionWorktreeEvidence `json:"worktree_evidence,omitempty"`
}

var queenTranscriptDirResolver = resolveQueenTranscriptDir

// QueenRunsHandler returns transcript run summaries for the browser admin view.
func QueenRunsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only GET method allowed")
		return
	}

	runs, err := loadQueenRunSummaries(queenTranscriptDirResolver())
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("could not list queen transcripts: %v", err))
		return
	}

	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]any{
		"runs": runs,
	})
}

// QueenTranscriptHandler returns the full parsed transcript for one run.
func QueenTranscriptHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only GET method allowed")
		return
	}

	transcriptPath, err := resolveQueenTranscriptPath(r.URL.Query().Get("name"), queenTranscriptDirResolver())
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	entries, err := readQueenTranscriptEntries(transcriptPath)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("could not read queen transcript: %v", err))
		return
	}

	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]any{
		"filename": filepath.Base(transcriptPath),
		"entries":  entries,
	})
}

// QueenTranscriptStreamHandler streams appended transcript entries over SSE.
func QueenTranscriptStreamHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only GET method allowed for SSE")
		return
	}

	transcriptPath, err := resolveQueenTranscriptPath(r.URL.Query().Get("name"), queenTranscriptDirResolver())
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	if _, err := os.Stat(transcriptPath); err != nil {
		if os.IsNotExist(err) {
			httpresponse.RespondWithError(w, http.StatusNotFound, "queen transcript not found")
			return
		}
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("could not stat queen transcript: %v", err))
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

	sendSSE := func(eventName string, payload any) error {
		bytes, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", eventName, bytes); err != nil {
			return err
		}
		flusher.Flush()
		return nil
	}

	offset, err := os.Stat(transcriptPath)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("could not stat queen transcript: %v", err))
		return
	}
	readOffset := offset.Size()
	pendingFragment := ""

	if err := sendSSE("ready", buildQueenTranscriptStreamPulse(transcriptPath, offset, readOffset)); err != nil {
		return
	}

	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			info, statErr := os.Stat(transcriptPath)
			if statErr != nil {
				_ = sendSSE("warning", map[string]string{"message": "queen transcript is no longer available"})
				continue
			}

			if info.Size() < readOffset {
				readOffset = 0
				pendingFragment = ""
			}

			if info.Size() == readOffset {
				if err := sendSSE("heartbeat", buildQueenTranscriptStreamPulse(transcriptPath, info, readOffset)); err != nil {
					return
				}
				continue
			}

			chunk, nextOffset, readErr := readQueenTranscriptChunk(transcriptPath, readOffset)
			if readErr != nil {
				_ = sendSSE("error", map[string]string{"message": fmt.Sprintf("could not stream queen transcript: %v", readErr)})
				continue
			}
			readOffset = nextOffset

			if chunk == "" {
				continue
			}

			pendingFragment += chunk
			for {
				newlineIndex := strings.IndexByte(pendingFragment, '\n')
				if newlineIndex < 0 {
					break
				}

				rawLine := pendingFragment[:newlineIndex]
				pendingFragment = pendingFragment[newlineIndex+1:]

				entry, parseErr := parseQueenTranscriptLine(rawLine)
				if parseErr != nil || entry == nil {
					continue
				}
				if err := sendSSE("entry", entry); err != nil {
					return
				}
			}
			if err := sendSSE("heartbeat", buildQueenTranscriptStreamPulse(transcriptPath, info, readOffset)); err != nil {
				return
			}
		}
	}
}

func buildQueenTranscriptStreamPulse(transcriptPath string, info os.FileInfo, readOffset int64) map[string]any {
	modifiedAt := ""
	if info != nil {
		modifiedAt = info.ModTime().UTC().Format(time.RFC3339Nano)
	}
	payload := map[string]any{
		"filename":    filepath.Base(transcriptPath),
		"modified_at": modifiedAt,
		"read_offset": readOffset,
		"server_time": time.Now().UTC().Format(time.RFC3339Nano),
	}
	if runtimeState, ok := buildQueenDirectRunRuntimeSnapshot(transcriptPath); ok {
		payload["runtime_state"] = runtimeState
	}
	return payload
}

func resolveQueenTranscriptDir() string {
	if override := strings.TrimSpace(os.Getenv("QUEEN_TRANSCRIPT_DIR")); override != "" {
		return override
	}

	candidates := []string{
		filepath.Join(".queen", "transcripts"),
		filepath.Join("..", ".queen", "transcripts"),
		filepath.Join("..", "..", ".queen", "transcripts"),
	}

	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			return candidate
		}
	}

	return filepath.Join(".queen", "transcripts")
}

func loadQueenRunSummaries(transcriptDir string) ([]queenRunSummary, error) {
	entries, err := os.ReadDir(transcriptDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []queenRunSummary{}, nil
		}
		return nil, err
	}

	threadIndex, err := loadQueenThreadRunIndex(queenThreadRegistryDirFromTranscriptDir(transcriptDir))
	if err != nil {
		return nil, err
	}

	runs := make([]queenRunSummary, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		filename := entry.Name()
		if !strings.HasPrefix(filename, "queen_run_") || !strings.HasSuffix(filename, ".jsonl") {
			continue
		}

		fullPath := filepath.Join(transcriptDir, filename)
		timestamp, taskID := parseQueenRunFilename(filename)
		if timestamp.IsZero() {
			if info, statErr := os.Stat(fullPath); statErr == nil {
				timestamp = info.ModTime()
			}
		}

		messageCount, roles, scanErr := scanQueenTranscript(fullPath)
		if scanErr != nil {
			if os.IsNotExist(scanErr) {
				continue
			}
			return nil, scanErr
		}

		summary := queenRunSummary{
			Filename:     filename,
			Timestamp:    timestamp.Format("2006-01-02 15:04:05"),
			TaskID:       taskID,
			MessageCount: messageCount,
			Roles:        roles,
		}
		if threadLink, ok := threadIndex[filename]; ok {
			summary.ThreadID = threadLink.ThreadID
			summary.ThreadTitle = threadLink.ThreadTitle
			summary.ThreadRuns = threadLink.ThreadRuns
		}
		applyQueenRunRuntimeState(&summary, fullPath)

		runs = append(runs, summary)
	}

	sort.Slice(runs, func(i, j int) bool {
		return runs[i].Timestamp > runs[j].Timestamp
	})

	return runs, nil
}

func applyQueenRunRuntimeState(summary *queenRunSummary, transcriptPath string) {
	if summary == nil {
		return
	}
	runtimeState, _, err := readQueenSessionRuntimeState(queenRuntimeStatePathForTranscript(transcriptPath))
	if err != nil {
		return
	}
	summary.Status = strings.TrimSpace(runtimeState.Status)
	summary.StatusReason = strings.TrimSpace(runtimeState.Reason)
	summary.ProgressPhase = strings.TrimSpace(runtimeState.ProgressPhase)
	summary.ProgressTone = strings.TrimSpace(runtimeState.ProgressTone)
	summary.ProgressNote = strings.TrimSpace(runtimeState.ProgressNote)
	summary.ProgressUpdatedAt = strings.TrimSpace(runtimeState.UpdatedAt)
	summary.ProcessID = runtimeState.ProcessID
	summary.ProcessAlive = queenSessionProcessAlive(runtimeState.ProcessID)
	summary.PendingTurn = runtimeState.PendingTurn
	summary.WorktreeEvidence = runtimeState.WorktreeEvidence
}

func buildQueenDirectRunRuntimeSnapshot(transcriptPath string) (*queenRunRuntimeSnapshot, bool) {
	runtimeStatePath := queenRuntimeStatePathForTranscript(transcriptPath)
	runtimeState, _, err := readQueenSessionRuntimeState(runtimeStatePath)
	if err != nil {
		return nil, false
	}
	processAlive := queenSessionProcessAlive(runtimeState.ProcessID)
	status := strings.TrimSpace(runtimeState.Status)

	// Runs killed externally (not via the managed-session lifecycle) never go
	// through refreshRuntimeStateLocked, so their runtime.json stays "running"
	// forever. Correct the status here on the first heartbeat that detects the
	// dead PID, so the UI reflects the actual state.
	if !processAlive && runtimeState.ProcessID > 0 && isQueenDirectRunActiveStatus(status) {
		status = "failed"
		_ = writeQueenSessionRuntimeState(runtimeStatePath, status, "process no longer alive", time.Now().UTC(), "", "")
	}

	snapshot := &queenRunRuntimeSnapshot{
		Status:            status,
		StatusReason:      strings.TrimSpace(runtimeState.Reason),
		ProgressPhase:     strings.TrimSpace(runtimeState.ProgressPhase),
		ProgressTone:      strings.TrimSpace(runtimeState.ProgressTone),
		ProgressNote:      strings.TrimSpace(runtimeState.ProgressNote),
		ProgressUpdatedAt: strings.TrimSpace(runtimeState.UpdatedAt),
		ProcessID:         runtimeState.ProcessID,
		ProcessAlive:      processAlive,
		PendingTurn:       runtimeState.PendingTurn,
		WorktreeEvidence:  runtimeState.WorktreeEvidence,
	}
	return snapshot, true
}

// isQueenDirectRunActiveStatus returns true for statuses that indicate the run
// is expected to be alive. Terminal statuses (completed, failed, stopped) and
// the empty string return false.
func isQueenDirectRunActiveStatus(status string) bool {
	switch status {
	case "completed", "failed", "stopped", "":
		return false
	default:
		return true
	}
}

func queenRuntimeStatePathForTranscript(transcriptPath string) string {
	extension := filepath.Ext(transcriptPath)
	if extension == "" {
		return transcriptPath + ".runtime.json"
	}
	return strings.TrimSuffix(transcriptPath, extension) + ".runtime.json"
}

func parseQueenRunFilename(filename string) (time.Time, string) {
	base := strings.TrimSuffix(filename, ".jsonl")
	parts := strings.Split(base, "_")
	if len(parts) < 4 {
		return time.Time{}, "manual"
	}

	taskID := "manual"
	for index := 0; index < len(parts)-1; index++ {
		if parts[index] == "task" {
			taskID = parts[index+1]
			break
		}
	}

	datePart := parts[2]
	timePart := parts[3]
	layout := ""
	switch len(timePart) {
	case 4:
		layout = "20060102 1504"
	case 6:
		layout = "20060102 150405"
	default:
		return time.Time{}, taskID
	}

	parsed, err := time.ParseInLocation(layout, datePart+" "+timePart, time.Local)
	if err != nil {
		return time.Time{}, taskID
	}
	return parsed, taskID
}

func scanQueenTranscript(transcriptPath string) (int, []string, error) {
	file, err := os.Open(transcriptPath)
	if err != nil {
		return 0, nil, err
	}
	defer file.Close()

	rolesSeen := make(map[string]struct{})
	messageCount := 0

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		entry, parseErr := parseQueenTranscriptLine(scanner.Text())
		if parseErr != nil || entry == nil {
			continue
		}
		messageCount++
		if entry.Role != "" {
			rolesSeen[entry.Role] = struct{}{}
		}
	}
	if err := scanner.Err(); err != nil {
		return 0, nil, err
	}

	roles := make([]string, 0, len(rolesSeen))
	for role := range rolesSeen {
		roles = append(roles, role)
	}
	sort.Strings(roles)

	return messageCount, roles, nil
}

func readQueenTranscriptEntries(transcriptPath string) ([]queenTranscriptEntry, error) {
	file, err := os.Open(transcriptPath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	entries := make([]queenTranscriptEntry, 0, 32)
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		entry, parseErr := parseQueenTranscriptLine(scanner.Text())
		if parseErr != nil || entry == nil {
			continue
		}
		entries = append(entries, *entry)
	}

	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return entries, nil
}

func parseQueenTranscriptLine(rawLine string) (*queenTranscriptEntry, error) {
	if strings.TrimSpace(rawLine) == "" {
		return nil, nil
	}

	var entry queenTranscriptEntry
	if err := json.Unmarshal([]byte(rawLine), &entry); err != nil {
		return nil, err
	}
	return &entry, nil
}

func resolveQueenTranscriptPath(name string, transcriptDir string) (string, error) {
	trimmedName := strings.TrimSpace(name)
	if trimmedName == "" {
		return "", fmt.Errorf("missing transcript name")
	}
	if trimmedName != filepath.Base(trimmedName) {
		return "", fmt.Errorf("invalid transcript name")
	}
	if !strings.HasSuffix(trimmedName, ".jsonl") || !strings.HasPrefix(trimmedName, "queen_run_") {
		return "", fmt.Errorf("invalid transcript name")
	}
	return filepath.Join(transcriptDir, trimmedName), nil
}

func readQueenTranscriptChunk(transcriptPath string, offset int64) (string, int64, error) {
	file, err := os.Open(transcriptPath)
	if err != nil {
		return "", offset, err
	}
	defer file.Close()

	if _, err := file.Seek(offset, io.SeekStart); err != nil {
		return "", offset, err
	}

	bytes, err := io.ReadAll(file)
	if err != nil {
		return "", offset, err
	}

	nextOffset, err := file.Seek(0, io.SeekCurrent)
	if err != nil {
		return "", offset, err
	}

	return string(bytes), nextOffset, nil
}
