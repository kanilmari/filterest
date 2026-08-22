// handover_report_handlers.go
// Serves immutable chat handover manifests assembled from exact workline report versions.
// Bridges authenticated Agent Tools requests with ordered report references and rendered continuation context.
// Exists so later chats can load one canonical handover without replaying raw conversation history.
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

const (
	agentHandoverReportTableName     = "dev_agent_handover_reports"
	agentHandoverReportItemTableName = "dev_agent_handover_report_items"
)

const handoverReportColumns = `h.id, h.title, h.state, h.source_kind, COALESCE(h.source_ref, ''), h.tags, h.metadata_json, h.membership_hash, h.supersedes_handover_id, h.created_by, COALESCE(created_user.username, ''), h.created, h.state_changed`
const handoverReportFromClause = ` FROM dev_agent_handover_reports h LEFT JOIN system_users created_user ON created_user.id = h.created_by`

// HandoverReportsHandler dispatches private handover list/create/state requests.
// Between: authenticated Agent Tools sessions and immutable handover manifests.
// Why: every handover must reference validated, secret-screened workline snapshots.
func HandoverReportsHandler(w http.ResponseWriter, r *http.Request) {
	if !requireAuthenticatedAgentToolUser(w, r) {
		return
	}

	switch r.Method {
	case http.MethodGet:
		listHandoverReportsHandler(w, r)
	case http.MethodPost:
		createHandoverReportHandler(w, r)
	case http.MethodPatch, http.MethodPut:
		updateHandoverReportStateHandler(w, r)
	default:
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func scanHandoverReport(scanner interface {
	Scan(dest ...interface{}) error
}) (AgentHandoverReport, error) {
	var report AgentHandoverReport
	var metadataJSON []byte
	var supersedes sql.NullInt64
	var createdBy sql.NullInt64
	err := scanner.Scan(
		&report.ID,
		&report.Title,
		&report.State,
		&report.SourceKind,
		&report.SourceRef,
		pq.Array(&report.Tags),
		&metadataJSON,
		&report.MembershipHash,
		&supersedes,
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
	report.Metadata = map[string]any{}
	if len(metadataJSON) > 0 {
		if err := json.Unmarshal(metadataJSON, &report.Metadata); err != nil {
			return report, fmt.Errorf("decode handover metadata: %w", err)
		}
	}
	if supersedes.Valid {
		value := supersedes.Int64
		report.SupersedesHandoverID = &value
	}
	if createdBy.Valid {
		value := int(createdBy.Int64)
		report.CreatedBy = &value
	}
	return report, nil
}

func fetchHandoverReportByID(id int64, includeItems bool) (AgentHandoverReport, error) {
	query := "SELECT " + handoverReportColumns + handoverReportFromClause + " WHERE h.id = $1"
	report, err := scanHandoverReport(backend.Db.QueryRow(query, id))
	if err != nil || !includeItems {
		return report, err
	}
	items, err := fetchHandoverReportItems(id)
	if err != nil {
		return report, err
	}
	report.Items = items
	report.Markdown = renderHandoverMarkdown(report)
	return report, nil
}

func fetchHandoverReportItems(handoverID int64) ([]AgentHandoverReportItem, error) {
	rows, err := backend.Db.Query(
		`SELECT id, handover_report_id, workline_id, workline_report_id, sort_order
		 FROM dev_agent_handover_report_items
		 WHERE handover_report_id = $1
		 ORDER BY sort_order, id`,
		handoverID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []AgentHandoverReportItem{}
	for rows.Next() {
		var item AgentHandoverReportItem
		var worklineID int64
		var reportID int64
		if err := rows.Scan(&item.ID, &item.HandoverReportID, &worklineID, &reportID, &item.SortOrder); err != nil {
			return nil, err
		}
		report, err := fetchWorklineReportByID(reportID)
		if err != nil {
			return nil, err
		}
		if report.WorklineID != worklineID {
			return nil, fmt.Errorf("handover item workline mismatch")
		}
		item.Report = report
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func listHandoverReportsHandler(w http.ResponseWriter, r *http.Request) {
	if rawID := strings.TrimSpace(r.URL.Query().Get("id")); rawID != "" {
		id, err := strconv.ParseInt(rawID, 10, 64)
		if err != nil || id <= 0 {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "id_must_be_positive")
			return
		}
		report, err := fetchHandoverReportByID(id, true)
		if err == sql.ErrNoRows {
			httpresponse.RespondWithError(w, http.StatusNotFound, "handover_not_found")
			return
		}
		if err != nil {
			respondAgentToolDatabaseError(w, "fetch handover", err)
			return
		}
		httpresponse.RespondWithJSON(w, http.StatusOK, report)
		return
	}

	if strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("latest")), "true") {
		var id int64
		err := backend.Db.QueryRow(
			"SELECT id FROM dev_agent_handover_reports WHERE state = 'final' ORDER BY created DESC, id DESC LIMIT 1",
		).Scan(&id)
		if err == sql.ErrNoRows {
			httpresponse.RespondWithError(w, http.StatusNotFound, "handover_not_found")
			return
		}
		if err != nil {
			respondAgentToolDatabaseError(w, "find latest handover", err)
			return
		}
		report, err := fetchHandoverReportByID(id, true)
		if err != nil {
			respondAgentToolDatabaseError(w, "fetch latest handover", err)
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
	query := "SELECT " + handoverReportColumns + handoverReportFromClause
	conditions := []string{}
	args := []interface{}{}
	if state := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("state"))); state != "" {
		if state != "final" && state != "superseded" && state != "archived" {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid_state")
			return
		}
		args = append(args, state)
		conditions = append(conditions, fmt.Sprintf("h.state = $%d", len(args)))
	}
	if search := strings.TrimSpace(r.URL.Query().Get("q")); search != "" {
		args = append(args, "%"+search+"%")
		conditions = append(conditions, fmt.Sprintf(
			"(h.title ILIKE $%d OR array_to_string(h.tags, ' ') ILIKE $%d)",
			len(args), len(args),
		))
	}
	if len(conditions) > 0 {
		query += " WHERE " + strings.Join(conditions, " AND ")
	}
	args = append(args, limit)
	query += fmt.Sprintf(" ORDER BY h.created DESC, h.id DESC LIMIT $%d", len(args))

	rows, err := backend.Db.Query(query, args...)
	if err != nil {
		respondAgentToolDatabaseError(w, "list handovers", err)
		return
	}
	defer rows.Close()
	reports := []AgentHandoverReport{}
	for rows.Next() {
		report, scanErr := scanHandoverReport(rows)
		if scanErr != nil {
			respondAgentToolDatabaseError(w, "scan handover", scanErr)
			return
		}
		reports = append(reports, report)
	}
	if err := rows.Err(); err != nil {
		respondAgentToolDatabaseError(w, "iterate handovers", err)
		return
	}
	httpresponse.RespondWithJSON(w, http.StatusOK, reports)
}

func createHandoverReportHandler(w http.ResponseWriter, r *http.Request) {
	var input handoverReportCreateRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	normalized, err := normalizeHandoverReportCreate(input)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	tx, err := backend.Db.Begin()
	if err != nil {
		respondAgentToolDatabaseError(w, "begin handover create", err)
		return
	}
	defer tx.Rollback()

	if normalized.SupersedesHandoverID != nil {
		var oldState string
		if err := tx.QueryRow(
			"SELECT state FROM dev_agent_handover_reports WHERE id = $1 FOR UPDATE",
			*normalized.SupersedesHandoverID,
		).Scan(&oldState); err == sql.ErrNoRows {
			httpresponse.RespondWithError(w, http.StatusNotFound, "superseded_handover_not_found")
			return
		} else if err != nil {
			respondAgentToolDatabaseError(w, "lock superseded handover", err)
			return
		}
		if oldState == "superseded" {
			httpresponse.RespondWithError(w, http.StatusConflict, "superseded_handover_is_not_replaceable")
			return
		}
	}

	validatedItems := make([]validatedHandoverItem, 0, len(normalized.Items))
	for _, item := range normalized.Items {
		var report AgentWorklineReport
		var currentWorklineStatus string
		err := tx.QueryRow(
			`SELECT w.title, w.status, r.workline_id, r.state, r.format_version,
			        COALESCE(r.phase_gate, ''), COALESCE(r.workline_status_snapshot, ''),
			        COALESCE(r.next_step_text, ''), r.content_hash
			 FROM dev_agent_workline_reports r
			 JOIN dev_agent_worklines w ON w.id = r.workline_id
			 WHERE r.id = $1 AND w.id = $2
			 FOR UPDATE OF r, w`,
			item.WorklineReportID,
			item.WorklineID,
		).Scan(
			&report.WorklineTitle,
			&currentWorklineStatus,
			&report.WorklineID,
			&report.State,
			&report.FormatVersion,
			&report.PhaseGate,
			&report.WorklineStatusSnapshot,
			&report.NextStepText,
			&report.ContentHash,
		)
		if err == sql.ErrNoRows {
			httpresponse.RespondWithError(w, http.StatusNotFound, "handover_workline_report_not_found")
			return
		}
		if err != nil {
			respondAgentToolDatabaseError(w, "lock handover workline report", err)
			return
		}
		if report.State != "final" {
			httpresponse.RespondWithError(w, http.StatusConflict, "handover_requires_final_workline_reports")
			return
		}
		if err := validateHandoverWorklineReport(report, currentWorklineStatus); err != nil {
			httpresponse.RespondWithError(w, http.StatusConflict, err.Error())
			return
		}
		report.ID = item.WorklineReportID
		validatedItems = append(validatedItems, validatedHandoverItem{
			handoverReportItemCreateRequest: item,
			Report:                          report,
		})
	}

	membershipHash := handoverMembershipHash(validatedItems)
	var handoverID int64
	err = tx.QueryRow(
		`INSERT INTO dev_agent_handover_reports (
			title, source_kind, source_ref, tags, metadata_json, membership_hash,
			supersedes_handover_id, created_by
		) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
		RETURNING id`,
		normalized.Title,
		normalized.SourceKind,
		nullableReportSourceRef(normalized.SourceRef),
		pq.Array(normalized.Tags),
		normalized.MetadataJSON,
		membershipHash,
		normalized.SupersedesHandoverID,
		currentAgentToolUserID(r),
	).Scan(&handoverID)
	if err != nil {
		respondAgentToolDatabaseError(w, "create handover", err)
		return
	}

	for index, item := range validatedItems {
		if _, err := tx.Exec(
			`INSERT INTO dev_agent_handover_report_items (
				handover_report_id, workline_id, workline_report_id, sort_order
			) VALUES ($1, $2, $3, $4)`,
			handoverID,
			item.WorklineID,
			item.WorklineReportID,
			index+1,
		); err != nil {
			respondAgentToolDatabaseError(w, "create handover item", err)
			return
		}
	}

	if normalized.SupersedesHandoverID != nil {
		if _, err := tx.Exec(
			"UPDATE dev_agent_handover_reports SET state = 'superseded', state_changed = now() WHERE id = $1",
			*normalized.SupersedesHandoverID,
		); err != nil {
			respondAgentToolDatabaseError(w, "mark handover superseded", err)
			return
		}
	}
	if err := tx.Commit(); err != nil {
		respondAgentToolDatabaseError(w, "commit handover", err)
		return
	}

	event_bus.Bus.Publish(agentHandoverReportTableName, event_bus.Event{
		Table: agentHandoverReportTableName, RowID: handoverID, Action: "create",
	})
	if normalized.SupersedesHandoverID != nil {
		event_bus.Bus.Publish(agentHandoverReportTableName, event_bus.Event{
			Table: agentHandoverReportTableName, RowID: *normalized.SupersedesHandoverID,
			Action: "update", ChangedFields: []string{"state"},
		})
	}
	report, err := fetchHandoverReportByID(handoverID, true)
	if err != nil {
		respondAgentToolDatabaseError(w, "reload handover", err)
		return
	}
	httpresponse.RespondWithJSON(w, http.StatusCreated, report)
}

func updateHandoverReportStateHandler(w http.ResponseWriter, r *http.Request) {
	var patch handoverReportPatchRequest
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if patch.ID <= 0 || patch.State == nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "id_and_state_are_required")
		return
	}
	current, err := fetchHandoverReportByID(patch.ID, false)
	if err == sql.ErrNoRows {
		httpresponse.RespondWithError(w, http.StatusNotFound, "handover_not_found")
		return
	}
	if err != nil {
		respondAgentToolDatabaseError(w, "fetch handover before state update", err)
		return
	}
	state := strings.ToLower(strings.TrimSpace(*patch.State))
	if state != "final" && state != "archived" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "state_must_be_final_or_archived")
		return
	}
	if current.State != "final" && current.State != "archived" {
		httpresponse.RespondWithError(w, http.StatusConflict, "invalid_handover_state_transition")
		return
	}
	if _, err := backend.Db.Exec(
		"UPDATE dev_agent_handover_reports SET state = $1, state_changed = now() WHERE id = $2",
		state,
		patch.ID,
	); err != nil {
		respondAgentToolDatabaseError(w, "update handover state", err)
		return
	}
	event_bus.Bus.Publish(agentHandoverReportTableName, event_bus.Event{
		Table: agentHandoverReportTableName, RowID: patch.ID, Action: "update", ChangedFields: []string{"state"},
	})
	report, err := fetchHandoverReportByID(patch.ID, true)
	if err != nil {
		respondAgentToolDatabaseError(w, "reload handover", err)
		return
	}
	httpresponse.RespondWithJSON(w, http.StatusOK, report)
}
