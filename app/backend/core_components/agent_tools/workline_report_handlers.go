// workline_report_handlers.go
// Serves append-first retrospective reports for stable development worklines.
// Bridges authenticated Agent Tools requests with canonical report persistence and redaction.
// Exists so later agents can search concise history without treating reports as new work orders.
package agent_tools

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/event_bus"
	"easelect/backend/core_components/httpresponse"

	"github.com/lib/pq"
)

const agentWorklineReportTableName = "dev_agent_workline_reports"

const worklineReportColumns = `r.id, r.workline_id, w.title, r.title, r.report_type, r.outcome, r.state, r.content, r.source_kind, COALESCE(r.source_ref, ''), r.tags, r.metadata_json, r.content_hash, r.format_version, COALESCE(r.phase_gate, ''), r.current_phase, COALESCE(r.workline_status_snapshot, ''), r.changed_this_turn, COALESCE(r.context_text, ''), COALESCE(r.plain_language_text, ''), COALESCE(r.technical_text, ''), COALESCE(r.next_step_text, ''), r.snapshot_json, COALESCE(r.git_head_commit, ''), COALESCE(r.git_worktree_state, ''), r.git_has_other_changes, r.git_workline_changed_paths, r.supersedes_report_id, COALESCE(r.redaction_reason, ''), r.created_by, COALESCE(created_user.username, ''), r.created, r.state_changed`
const worklineReportSummaryColumns = `r.id, r.workline_id, w.title, r.title, r.report_type, r.outcome, r.state, ''::text, r.source_kind, COALESCE(r.source_ref, ''), r.tags, '{}'::jsonb, r.content_hash, r.format_version, COALESCE(r.phase_gate, ''), r.current_phase, COALESCE(r.workline_status_snapshot, ''), r.changed_this_turn, ''::text, ''::text, ''::text, ''::text, '{}'::jsonb, COALESCE(r.git_head_commit, ''), COALESCE(r.git_worktree_state, ''), r.git_has_other_changes, '{}'::text[], r.supersedes_report_id, COALESCE(r.redaction_reason, ''), r.created_by, COALESCE(created_user.username, ''), r.created, r.state_changed`
const worklineReportFromClause = ` FROM dev_agent_workline_reports r JOIN dev_agent_worklines w ON w.id = r.workline_id LEFT JOIN system_users created_user ON created_user.id = r.created_by`

// WorklineReportsHandler dispatches private report list/create/state-management requests.
// Between: authenticated Agent Tools sessions and canonical retrospective report rows.
// Why: report bodies must pass server-side validation and secret screening before persistence.
func WorklineReportsHandler(w http.ResponseWriter, r *http.Request) {
	if !requireAuthenticatedAgentToolUser(w, r) {
		return
	}

	switch r.Method {
	case http.MethodGet:
		listWorklineReportsHandler(w, r)
	case http.MethodPost:
		createWorklineReportHandler(w, r)
	case http.MethodPatch, http.MethodPut:
		updateWorklineReportStateHandler(w, r)
	default:
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func scanWorklineReport(scanner interface {
	Scan(dest ...interface{}) error
}) (AgentWorklineReport, error) {
	var report AgentWorklineReport
	var metadataJSON []byte
	var snapshotJSON []byte
	var supersedes sql.NullInt64
	var createdBy sql.NullInt64
	var changedThisTurn sql.NullBool
	var gitHasOtherChanges sql.NullBool
	err := scanner.Scan(
		&report.ID,
		&report.WorklineID,
		&report.WorklineTitle,
		&report.Title,
		&report.ReportType,
		&report.Outcome,
		&report.State,
		&report.Content,
		&report.SourceKind,
		&report.SourceRef,
		pq.Array(&report.Tags),
		&metadataJSON,
		&report.ContentHash,
		&report.FormatVersion,
		&report.PhaseGate,
		&report.CurrentPhase,
		&report.WorklineStatusSnapshot,
		&changedThisTurn,
		&report.ContextText,
		&report.PlainLanguageText,
		&report.TechnicalText,
		&report.NextStepText,
		&snapshotJSON,
		&report.GitHeadCommit,
		&report.GitWorktreeState,
		&gitHasOtherChanges,
		pq.Array(&report.GitWorklineChangedPaths),
		&supersedes,
		&report.RedactionReason,
		&createdBy,
		&report.CreatedByUsername,
		&report.CreatedAt,
		&report.StateChangedAt,
	)
	if err != nil {
		return report, err
	}
	if report.Tags == nil {
		report.Tags = []string{}
	}
	if report.GitWorklineChangedPaths == nil {
		report.GitWorklineChangedPaths = []string{}
	}
	report.GitWorklineChangedPathCount = len(report.GitWorklineChangedPaths)
	if gitHasOtherChanges.Valid {
		value := gitHasOtherChanges.Bool
		report.GitHasOtherChanges = &value
	}
	if changedThisTurn.Valid {
		value := changedThisTurn.Bool
		report.ChangedThisTurn = &value
	}
	report.Metadata = map[string]any{}
	if len(metadataJSON) > 0 {
		if err := json.Unmarshal(metadataJSON, &report.Metadata); err != nil {
			return report, fmt.Errorf("decode report metadata: %w", err)
		}
	}
	report.Snapshot = map[string]any{}
	if len(snapshotJSON) > 0 {
		if err := json.Unmarshal(snapshotJSON, &report.Snapshot); err != nil {
			return report, fmt.Errorf("decode report snapshot: %w", err)
		}
	}
	if supersedes.Valid {
		value := supersedes.Int64
		report.SupersedesReportID = &value
	}
	if createdBy.Valid {
		value := int(createdBy.Int64)
		report.CreatedBy = &value
	}
	return report, nil
}

func fetchWorklineReportByID(id int64) (AgentWorklineReport, error) {
	query := "SELECT " + worklineReportColumns + worklineReportFromClause + " WHERE r.id = $1"
	return scanWorklineReport(backend.Db.QueryRow(query, id))
}

func listWorklineReportsHandler(w http.ResponseWriter, r *http.Request) {
	if rawID := strings.TrimSpace(r.URL.Query().Get("id")); rawID != "" {
		id, err := strconv.ParseInt(rawID, 10, 64)
		if err != nil || id <= 0 {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "id_must_be_positive")
			return
		}
		report, err := fetchWorklineReportByID(id)
		if err == sql.ErrNoRows {
			httpresponse.RespondWithError(w, http.StatusNotFound, "report_not_found")
			return
		}
		if err != nil {
			respondAgentToolDatabaseError(w, "fetch workline report", err)
			return
		}
		httpresponse.RespondWithJSON(w, http.StatusOK, report)
		return
	}

	limit, err := parseAgentToolLimit(r.URL.Query().Get("limit"))
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}
	query := "SELECT " + worklineReportSummaryColumns + worklineReportFromClause
	conditions := []string{}
	args := []interface{}{}
	if rawWorklineID := strings.TrimSpace(r.URL.Query().Get("workline_id")); rawWorklineID != "" {
		worklineID, parseErr := strconv.ParseInt(rawWorklineID, 10, 64)
		if parseErr != nil || worklineID <= 0 {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "workline_id_must_be_positive")
			return
		}
		args = append(args, worklineID)
		conditions = append(conditions, fmt.Sprintf("r.workline_id = $%d", len(args)))
	}
	if state := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("state"))); state != "" {
		if state != "final" && state != "superseded" && state != "redacted" && state != "archived" {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid_state")
			return
		}
		args = append(args, state)
		conditions = append(conditions, fmt.Sprintf("r.state = $%d", len(args)))
	}
	if search := strings.TrimSpace(r.URL.Query().Get("q")); search != "" {
		args = append(args, "%"+search+"%")
		conditions = append(conditions, fmt.Sprintf(
			"(r.title ILIKE $%d OR r.content ILIKE $%d OR w.title ILIKE $%d OR array_to_string(r.tags, ' ') ILIKE $%d)",
			len(args), len(args), len(args), len(args),
		))
	}
	if len(conditions) > 0 {
		query += " WHERE " + strings.Join(conditions, " AND ")
	}
	args = append(args, limit)
	query += fmt.Sprintf(" ORDER BY r.created DESC, r.id DESC LIMIT $%d", len(args))

	rows, err := backend.Db.Query(query, args...)
	if err != nil {
		respondAgentToolDatabaseError(w, "list workline reports", err)
		return
	}
	defer rows.Close()
	reports := []AgentWorklineReport{}
	for rows.Next() {
		report, scanErr := scanWorklineReport(rows)
		if scanErr != nil {
			respondAgentToolDatabaseError(w, "scan workline report", scanErr)
			return
		}
		reports = append(reports, report)
	}
	if err := rows.Err(); err != nil {
		respondAgentToolDatabaseError(w, "iterate workline reports", err)
		return
	}
	httpresponse.RespondWithJSON(w, http.StatusOK, reports)
}

func nullableReportSourceRef(value string) interface{} {
	if value == "" {
		return nil
	}
	return value
}

// validateWorklineStatusReconciliation decides whether one report may also move its workline lifecycle.
// Between: the locked current identity and the requested canonical report snapshot.
// Why: ordinary reports must reject stale state while explicitly synchronized reports stay atomic.
func validateWorklineStatusReconciliation(currentStatus, requestedStatus string, syncStatus bool) (bool, string) {
	if currentStatus == "archived" {
		return false, "archived_workline_rejects_new_reports"
	}
	changed := currentStatus != requestedStatus
	if changed && !syncStatus {
		return false, "workline_status_snapshot_is_stale"
	}
	return changed, ""
}

func createWorklineReportHandler(w http.ResponseWriter, r *http.Request) {
	var input worklineReportCreateRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	normalized, err := normalizeWorklineReportCreate(input)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	tx, err := backend.Db.Begin()
	if err != nil {
		respondAgentToolDatabaseError(w, "begin workline report create", err)
		return
	}
	defer tx.Rollback()

	var worklineStatus string
	if err := tx.QueryRow(
		"SELECT status FROM dev_agent_worklines WHERE id = $1 FOR UPDATE",
		normalized.WorklineID,
	).Scan(&worklineStatus); err == sql.ErrNoRows {
		httpresponse.RespondWithError(w, http.StatusNotFound, "workline_not_found")
		return
	} else if err != nil {
		respondAgentToolDatabaseError(w, "lock report workline", err)
		return
	}
	worklineStatusChanged, statusError := validateWorklineStatusReconciliation(
		worklineStatus,
		normalized.WorklineStatusSnapshot,
		normalized.SyncWorklineStatus,
	)
	if statusError != "" {
		httpresponse.RespondWithError(w, http.StatusConflict, statusError)
		return
	}

	if normalized.SupersedesReportID != nil {
		var oldWorklineID int64
		var oldState string
		if err := tx.QueryRow(
			"SELECT workline_id, state FROM dev_agent_workline_reports WHERE id = $1 FOR UPDATE",
			*normalized.SupersedesReportID,
		).Scan(&oldWorklineID, &oldState); err == sql.ErrNoRows {
			httpresponse.RespondWithError(w, http.StatusNotFound, "superseded_report_not_found")
			return
		} else if err != nil {
			respondAgentToolDatabaseError(w, "lock superseded report", err)
			return
		}
		if oldWorklineID != normalized.WorklineID {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "superseded_report_belongs_to_another_workline")
			return
		}
		if oldState == "superseded" || oldState == "redacted" {
			httpresponse.RespondWithError(w, http.StatusConflict, "superseded_report_is_not_replaceable")
			return
		}
	}

	var reportID int64
	err = tx.QueryRow(
		`INSERT INTO dev_agent_workline_reports (
			workline_id, title, report_type, outcome, content, source_kind,
			source_ref, tags, metadata_json, content_hash, format_version, phase_gate, current_phase,
			workline_status_snapshot, changed_this_turn, context_text, plain_language_text,
			technical_text, next_step_text, snapshot_json, git_head_commit,
			git_worktree_state, git_has_other_changes, git_workline_changed_paths,
			supersedes_report_id, created_by
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, 2, $11, $12,
			$13, $14, $15, $16, $17, $18, $19::jsonb, $20, $21, $22, $23, $24, $25
		)
		RETURNING id`,
		normalized.WorklineID,
		normalized.Title,
		normalized.ReportType,
		normalized.Outcome,
		normalized.Content,
		normalized.SourceKind,
		nullableReportSourceRef(normalized.SourceRef),
		pq.Array(normalized.Tags),
		normalized.MetadataJSON,
		normalized.ContentHash,
		normalized.PhaseGate,
		*normalized.CurrentPhase,
		normalized.WorklineStatusSnapshot,
		*normalized.ChangedThisTurn,
		normalized.ContextText,
		normalized.PlainLanguageText,
		normalized.TechnicalText,
		nullableReportSourceRef(normalized.NextStepText),
		normalized.SnapshotJSON,
		normalized.GitHeadCommit,
		normalized.GitWorktreeState,
		*normalized.GitHasOtherChanges,
		pq.Array(normalized.GitWorklineChangedPaths),
		normalized.SupersedesReportID,
		currentAgentToolUserID(r),
	).Scan(&reportID)
	if err != nil {
		respondAgentToolDatabaseError(w, "create workline report", err)
		return
	}

	if normalized.SupersedesReportID != nil {
		if _, err := tx.Exec(
			"UPDATE dev_agent_workline_reports SET state = 'superseded', state_changed = now() WHERE id = $1",
			*normalized.SupersedesReportID,
		); err != nil {
			respondAgentToolDatabaseError(w, "mark report superseded", err)
			return
		}
	}
	worklineUpdateQuery := "UPDATE dev_agent_worklines SET status = $1, updated = now() WHERE id = $2"
	worklineUpdateArgs := []interface{}{normalized.WorklineStatusSnapshot, normalized.WorklineID}
	if worklineStatusChanged {
		worklineUpdateQuery = `UPDATE dev_agent_worklines
			SET status = $1, updated = now(), status_changed_by = $3,
				status_changed_at = now(), status_change_source = 'report_sync',
				status_revision = status_revision + 1
			WHERE id = $2`
		worklineUpdateArgs = append(worklineUpdateArgs, currentAgentToolUserID(r))
	}
	if _, err := tx.Exec(worklineUpdateQuery, worklineUpdateArgs...); err != nil {
		respondAgentToolDatabaseError(w, "touch report workline", err)
		return
	}
	if err := tx.Commit(); err != nil {
		respondAgentToolDatabaseError(w, "commit workline report", err)
		return
	}

	event_bus.Bus.Publish(agentWorklineReportTableName, event_bus.Event{
		Table: agentWorklineReportTableName, RowID: reportID, Action: "create",
	})
	if worklineStatusChanged {
		event_bus.Bus.Publish(agentWorklineTableName, event_bus.Event{
			Table: agentWorklineTableName, RowID: normalized.WorklineID,
			Action: "update", ChangedFields: []string{"status"},
		})
	}
	if normalized.SupersedesReportID != nil {
		event_bus.Bus.Publish(agentWorklineReportTableName, event_bus.Event{
			Table: agentWorklineReportTableName, RowID: *normalized.SupersedesReportID,
			Action: "update", ChangedFields: []string{"state"},
		})
	}
	report, err := fetchWorklineReportByID(reportID)
	if err != nil {
		respondAgentToolDatabaseError(w, "reload workline report", err)
		return
	}
	httpresponse.RespondWithJSON(w, http.StatusCreated, report)
}

func updateWorklineReportStateHandler(w http.ResponseWriter, r *http.Request) {
	var patch worklineReportPatchRequest
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if patch.ID <= 0 || patch.State == nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "id_and_state_are_required")
		return
	}
	current, err := fetchWorklineReportByID(patch.ID)
	if err == sql.ErrNoRows {
		httpresponse.RespondWithError(w, http.StatusNotFound, "report_not_found")
		return
	}
	if err != nil {
		respondAgentToolDatabaseError(w, "fetch report before state update", err)
		return
	}

	state := strings.ToLower(strings.TrimSpace(*patch.State))
	changedFields := []string{"state"}
	switch state {
	case "final", "archived":
		if current.State != "final" && current.State != "archived" {
			httpresponse.RespondWithError(w, http.StatusConflict, "invalid_report_state_transition")
			return
		}
		_, err = backend.Db.Exec(
			"UPDATE dev_agent_workline_reports SET state = $1, state_changed = now() WHERE id = $2",
			state, patch.ID,
		)
	case "redacted":
		if current.State == "redacted" {
			httpresponse.RespondWithError(w, http.StatusConflict, "report_already_redacted")
			return
		}
		if patch.RedactionReason == nil {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "redaction_reason_is_required")
			return
		}
		var reason string
		reason, err = normalizeBoundedText(*patch.RedactionReason, "redaction_reason", 500)
		if err != nil || utf8RuneCount(reason) < 3 {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "redaction_reason_must_be_3_to_500_characters")
			return
		}
		if category := detectReportSecret(reason); category != "" {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "redaction_reason_rejected_secret_detected:"+category)
			return
		}
		redactedHash := reportContentHash("Redacted report", current.ReportType, current.Outcome, "[redacted]")
		_, err = backend.Db.Exec(
			`UPDATE dev_agent_workline_reports
			 SET state = 'redacted', state_changed = now(), title = 'Redacted report',
			     content = '[redacted]', source_ref = NULL, tags = '{}'::text[],
			     metadata_json = '{}'::jsonb, content_hash = $1, redaction_reason = $2,
			     context_text = NULL, plain_language_text = NULL, technical_text = NULL,
			     next_step_text = NULL, snapshot_json = '{}'::jsonb,
			     git_workline_changed_paths = '{}'::text[]
			 WHERE id = $3`,
			redactedHash, reason, patch.ID,
		)
		changedFields = []string{"state", "title", "content", "source_ref", "tags", "metadata_json", "content_hash", "redaction_reason", "context_text", "plain_language_text", "technical_text", "next_step_text", "snapshot_json", "git_workline_changed_paths"}
	default:
		httpresponse.RespondWithError(w, http.StatusBadRequest, "state_must_be_final_archived_or_redacted")
		return
	}
	if err != nil {
		respondAgentToolDatabaseError(w, "update workline report state", err)
		return
	}
	event_bus.Bus.Publish(agentWorklineReportTableName, event_bus.Event{
		Table: agentWorklineReportTableName, RowID: patch.ID, Action: "update", ChangedFields: changedFields,
	})
	report, err := fetchWorklineReportByID(patch.ID)
	if err != nil {
		respondAgentToolDatabaseError(w, "reload updated report", err)
		return
	}
	httpresponse.RespondWithJSON(w, http.StatusOK, report)
}

func utf8RuneCount(value string) int {
	return len([]rune(value))
}
