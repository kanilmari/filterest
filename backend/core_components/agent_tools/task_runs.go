// task_runs.go
// Serves backend endpoints for DB-native task run records.
// Bridges dev_agent_tasks ticket rows, Queen dispatch state, and worker artifact paths.
// Exists so execution attempts can be tracked in DB without using markdown tickets as state.

package agent_tools

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	backend "easelect/backend/core_components"
)

type AgentTaskRun struct {
	ID               int64      `json:"id"`
	RunID            string     `json:"run_id"`
	TaskID           int        `json:"task_id"`
	TriggeredBy      string     `json:"triggered_by"`
	WorkerBackend    string     `json:"worker_backend,omitempty"`
	Status           string     `json:"status"`
	SummaryRelpath   string     `json:"summary_relpath,omitempty"`
	ProgressRelpath  string     `json:"progress_relpath,omitempty"`
	LogRelpath       string     `json:"log_relpath,omitempty"`
	PromptRelpath    string     `json:"prompt_relpath,omitempty"`
	RunStatusRelpath string     `json:"run_status_relpath,omitempty"`
	ExitCode         *int       `json:"exit_code,omitempty"`
	StartedAt        time.Time  `json:"started_at"`
	FinishedAt       *time.Time `json:"finished_at,omitempty"`
	ReviewedAt       *time.Time `json:"reviewed_at,omitempty"`
	ReviewNotes      string     `json:"review_notes,omitempty"`
}

type taskRunCreateRequest struct {
	RunID            string     `json:"run_id"`
	TaskID           int        `json:"task_id"`
	TriggeredBy      string     `json:"triggered_by"`
	WorkerBackend    string     `json:"worker_backend"`
	Status           string     `json:"status"`
	SummaryRelpath   string     `json:"summary_relpath"`
	ProgressRelpath  string     `json:"progress_relpath"`
	LogRelpath       string     `json:"log_relpath"`
	PromptRelpath    string     `json:"prompt_relpath"`
	RunStatusRelpath string     `json:"run_status_relpath"`
	ExitCode         *int       `json:"exit_code"`
	FinishedAt       *time.Time `json:"finished_at"`
	ReviewedAt       *time.Time `json:"reviewed_at"`
	ReviewNotes      string     `json:"review_notes"`
}

type taskRunUpdateRequest struct {
	ID               int64      `json:"id"`
	RunID            string     `json:"run_id"`
	TriggeredBy      *string    `json:"triggered_by"`
	WorkerBackend    *string    `json:"worker_backend"`
	Status           *string    `json:"status"`
	SummaryRelpath   *string    `json:"summary_relpath"`
	ProgressRelpath  *string    `json:"progress_relpath"`
	LogRelpath       *string    `json:"log_relpath"`
	PromptRelpath    *string    `json:"prompt_relpath"`
	RunStatusRelpath *string    `json:"run_status_relpath"`
	ExitCode         *int       `json:"exit_code"`
	FinishedAt       *time.Time `json:"finished_at"`
	ReviewedAt       *time.Time `json:"reviewed_at"`
	ReviewNotes      *string    `json:"review_notes"`
}

const taskRunColumns = `id, run_id, task_id, triggered_by, worker_backend, status, summary_relpath, progress_relpath, log_relpath, prompt_relpath, run_status_relpath, exit_code, started_at, finished_at, reviewed_at, review_notes`

func normalizeTaskRunStatusForDB(status string) string {
	trimmed := strings.TrimSpace(status)
	switch trimmed {
	case "awaiting_human_decision":
		return "awaiting_review"
	default:
		return trimmed
	}
}

func normalizeTaskRunStatusForClient(status string) string {
	switch status {
	case "awaiting_review":
		return "awaiting_human_decision"
	default:
		return status
	}
}

func normalizeTaskRunTriggeredBy(triggeredBy string) string {
	switch strings.TrimSpace(triggeredBy) {
	case "queen", "human", "routine", "manual":
		return strings.TrimSpace(triggeredBy)
	default:
		return ""
	}
}

func scanTaskRun(scanner interface {
	Scan(dest ...interface{}) error
}) (AgentTaskRun, error) {
	var run AgentTaskRun
	var workerBackend, summaryRelpath, progressRelpath, logRelpath, promptRelpath, runStatusRelpath, reviewNotes *string
	var finishedAt, reviewedAt *time.Time

	err := scanner.Scan(
		&run.ID,
		&run.RunID,
		&run.TaskID,
		&run.TriggeredBy,
		&workerBackend,
		&run.Status,
		&summaryRelpath,
		&progressRelpath,
		&logRelpath,
		&promptRelpath,
		&runStatusRelpath,
		&run.ExitCode,
		&run.StartedAt,
		&finishedAt,
		&reviewedAt,
		&reviewNotes,
	)
	if err != nil {
		return run, err
	}

	if workerBackend != nil {
		run.WorkerBackend = *workerBackend
	}
	if summaryRelpath != nil {
		run.SummaryRelpath = *summaryRelpath
	}
	if progressRelpath != nil {
		run.ProgressRelpath = *progressRelpath
	}
	if logRelpath != nil {
		run.LogRelpath = *logRelpath
	}
	if promptRelpath != nil {
		run.PromptRelpath = *promptRelpath
	}
	if runStatusRelpath != nil {
		run.RunStatusRelpath = *runStatusRelpath
	}
	if finishedAt != nil {
		run.FinishedAt = finishedAt
	}
	if reviewedAt != nil {
		run.ReviewedAt = reviewedAt
	}
	if reviewNotes != nil {
		run.ReviewNotes = *reviewNotes
	}
	if run.ExitCode != nil {
		exitCode := *run.ExitCode
		run.ExitCode = &exitCode
	}

	run.Status = normalizeTaskRunStatusForClient(run.Status)
	return run, nil
}

func TaskRunsHandler(w http.ResponseWriter, r *http.Request) {
	if !requireAuthenticatedAgentToolUser(w, r) {
		return
	}

	switch r.Method {
	case http.MethodGet:
		ListTaskRunsHandler(w, r)
	case http.MethodPost:
		CreateTaskRunHandler(w, r)
	case http.MethodPut, http.MethodPatch:
		UpdateTaskRunHandler(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func ListTaskRunsHandler(w http.ResponseWriter, r *http.Request) {
	if runID := strings.TrimSpace(r.URL.Query().Get("run_id")); runID != "" {
		query := "SELECT " + taskRunColumns + " FROM dev_agent_task_runs WHERE run_id = $1"
		row := backend.Db.QueryRow(query, runID)
		run, err := scanTaskRun(row)
		if err != nil {
			http.Error(w, "Task run not found", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(run)
		return
	}

	query := "SELECT " + taskRunColumns + " FROM dev_agent_task_runs"
	args := []interface{}{}
	conditions := []string{}

	if taskIDStr := strings.TrimSpace(r.URL.Query().Get("task_id")); taskIDStr != "" {
		taskID, err := strconv.Atoi(taskIDStr)
		if err != nil {
			http.Error(w, "Invalid task_id", http.StatusBadRequest)
			return
		}
		conditions = append(conditions, fmt.Sprintf("task_id = $%d", len(args)+1))
		args = append(args, taskID)
	}

	if status := strings.TrimSpace(r.URL.Query().Get("status")); status != "" {
		normalizedStatus := normalizeTaskRunStatusForDB(status)
		conditions = append(conditions, fmt.Sprintf("status = $%d", len(args)+1))
		args = append(args, normalizedStatus)
	}

	if len(conditions) > 0 {
		query += " WHERE " + strings.Join(conditions, " AND ")
	}
	query += " ORDER BY started_at DESC, id DESC"

	rows, err := backend.Db.Query(query, args...)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	runs := []AgentTaskRun{}
	for rows.Next() {
		run, err := scanTaskRun(rows)
		if err != nil {
			http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
			return
		}
		runs = append(runs, run)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(runs)
}

func CreateTaskRunHandler(w http.ResponseWriter, r *http.Request) {
	var req taskRunCreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if strings.TrimSpace(req.RunID) == "" || req.TaskID == 0 {
		http.Error(w, "run_id and task_id are required", http.StatusBadRequest)
		return
	}
	req.TriggeredBy = normalizeTaskRunTriggeredBy(req.TriggeredBy)
	if req.TriggeredBy == "" {
		http.Error(w, "Invalid triggered_by", http.StatusBadRequest)
		return
	}
	if req.Status == "" {
		req.Status = "queued"
	}
	req.Status = normalizeTaskRunStatusForDB(req.Status)

	query := `
		INSERT INTO dev_agent_task_runs (
			run_id, task_id, triggered_by, worker_backend, status,
			summary_relpath, progress_relpath, log_relpath, prompt_relpath, run_status_relpath,
			exit_code, finished_at, reviewed_at, review_notes
		) VALUES (
			$1, $2, $3, $4, $5,
			$6, $7, $8, $9, $10,
			$11, $12, $13, $14
		)
		RETURNING ` + taskRunColumns
	row := backend.Db.QueryRow(
		query,
		req.RunID,
		req.TaskID,
		req.TriggeredBy,
		emptyStringToNil(req.WorkerBackend),
		req.Status,
		emptyStringToNil(req.SummaryRelpath),
		emptyStringToNil(req.ProgressRelpath),
		emptyStringToNil(req.LogRelpath),
		emptyStringToNil(req.PromptRelpath),
		emptyStringToNil(req.RunStatusRelpath),
		req.ExitCode,
		req.FinishedAt,
		req.ReviewedAt,
		emptyStringToNil(req.ReviewNotes),
	)

	run, err := scanTaskRun(row)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(run)
}

func UpdateTaskRunHandler(w http.ResponseWriter, r *http.Request) {
	var req taskRunUpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if req.ID == 0 && strings.TrimSpace(req.RunID) == "" {
		http.Error(w, "id or run_id is required", http.StatusBadRequest)
		return
	}

	query := "UPDATE dev_agent_task_runs SET "
	args := []interface{}{}
	first := true
	appendField := func(fragment string, value interface{}) {
		if !first {
			query += ", "
		}
		query += fmt.Sprintf(fragment, len(args)+1)
		args = append(args, value)
		first = false
	}

	if req.TriggeredBy != nil {
		triggeredBy := normalizeTaskRunTriggeredBy(*req.TriggeredBy)
		if triggeredBy == "" {
			http.Error(w, "Invalid triggered_by", http.StatusBadRequest)
			return
		}
		appendField("triggered_by = $%d", triggeredBy)
	}
	if req.WorkerBackend != nil {
		appendField("worker_backend = $%d", emptyStringToNil(*req.WorkerBackend))
	}
	if req.Status != nil {
		appendField("status = $%d", normalizeTaskRunStatusForDB(*req.Status))
	}
	if req.SummaryRelpath != nil {
		appendField("summary_relpath = $%d", emptyStringToNil(*req.SummaryRelpath))
	}
	if req.ProgressRelpath != nil {
		appendField("progress_relpath = $%d", emptyStringToNil(*req.ProgressRelpath))
	}
	if req.LogRelpath != nil {
		appendField("log_relpath = $%d", emptyStringToNil(*req.LogRelpath))
	}
	if req.PromptRelpath != nil {
		appendField("prompt_relpath = $%d", emptyStringToNil(*req.PromptRelpath))
	}
	if req.RunStatusRelpath != nil {
		appendField("run_status_relpath = $%d", emptyStringToNil(*req.RunStatusRelpath))
	}
	if req.ExitCode != nil {
		appendField("exit_code = $%d", req.ExitCode)
	}
	if req.FinishedAt != nil {
		appendField("finished_at = $%d", req.FinishedAt)
	}
	if req.ReviewedAt != nil {
		appendField("reviewed_at = $%d", req.ReviewedAt)
	}
	if req.ReviewNotes != nil {
		appendField("review_notes = $%d", emptyStringToNil(*req.ReviewNotes))
	}

	if first {
		http.Error(w, "No fields to update", http.StatusBadRequest)
		return
	}

	if req.ID != 0 {
		query += fmt.Sprintf(" WHERE id = $%d RETURNING ", len(args)+1) + taskRunColumns
		args = append(args, req.ID)
	} else {
		query += fmt.Sprintf(" WHERE run_id = $%d RETURNING ", len(args)+1) + taskRunColumns
		args = append(args, strings.TrimSpace(req.RunID))
	}

	row := backend.Db.QueryRow(query, args...)
	run, err := scanTaskRun(row)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(run)
}

func emptyStringToNil(value string) interface{} {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return strings.TrimSpace(value)
}
