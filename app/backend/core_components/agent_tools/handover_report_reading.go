// handover_report_reading.go
// Renders a handover for reading: the newest report of each line, the open lines it lacks, and its comments.
// Bridges immutable handover manifests with the workline reports and notes written after them.
// Exists so a report update or a short note never needs a new handover (owner decision K248).
package agent_tools

import (
	"database/sql"
	"encoding/json"
	"net/http"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/httpresponse"

	"github.com/lib/pq"
)

// readHandoverReport renders a final handover with each line's newest final report and the open lines missing from
// its manifest; asWritten, or a superseded or archived handover, keeps the manifest's own versions. Comments are
// read either way.
func readHandoverReport(id int64, asWritten bool) (AgentHandoverReport, error) {
	report, err := fetchHandoverReportByID(id, true)
	if err != nil {
		return report, err
	}
	report.AsWritten = asWritten
	if !asWritten && report.State == "final" {
		if err := refreshHandoverItems(&report); err != nil {
			return report, err
		}
	}
	if report.Comments, err = fetchHandoverComments(id); err != nil {
		return report, err
	}
	report.Markdown = renderHandoverMarkdown(report)
	return report, nil
}

func refreshHandoverItems(report *AgentHandoverReport) error {
	listed := make([]int64, 0, len(report.Items))
	for index, item := range report.Items {
		listed = append(listed, item.Report.WorklineID)
		var newerID int64
		err := backend.Db.QueryRow(
			`SELECT r.id
			 FROM dev_agent_workline_reports r
			 JOIN dev_agent_workline_reports pinned ON pinned.id = $2
			 WHERE r.workline_id = $1 AND r.state = 'final' AND r.id <> pinned.id
			   AND (r.created, r.id) > (pinned.created, pinned.id)
			 ORDER BY r.created DESC, r.id DESC
			 LIMIT 1`,
			item.Report.WorklineID,
			item.Report.ID,
		).Scan(&newerID)
		if err == sql.ErrNoRows {
			continue
		}
		if err != nil {
			return err
		}
		newer, err := fetchWorklineReportByID(newerID)
		if err != nil {
			return err
		}
		report.Items[index].PinnedReportID = item.Report.ID
		report.Items[index].Report = newer
	}

	rows, err := backend.Db.Query(
		`SELECT latest.id
		 FROM dev_agent_worklines w
		 JOIN LATERAL (
		     SELECT r.id FROM dev_agent_workline_reports r
		     WHERE r.workline_id = w.id AND r.state = 'final'
		     ORDER BY r.created DESC, r.id DESC
		     LIMIT 1
		 ) latest ON true
		 WHERE w.status IN ('active', 'paused') AND NOT (w.id = ANY($1))
		 ORDER BY w.id`,
		pq.Array(listed),
	)
	if err != nil {
		return err
	}
	var reportIDs []int64
	for rows.Next() {
		var reportID int64
		if err := rows.Scan(&reportID); err != nil {
			rows.Close()
			return err
		}
		reportIDs = append(reportIDs, reportID)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for _, reportID := range reportIDs {
		opened, err := fetchWorklineReportByID(reportID)
		if err != nil {
			return err
		}
		report.OpenedAfter = append(report.OpenedAfter, AgentHandoverReportItem{Report: opened})
	}
	return nil
}

func fetchHandoverComments(handoverID int64) ([]AgentHandoverComment, error) {
	rows, err := backend.Db.Query(
		`SELECT sc.id, sc.comment_text, COALESCE(su.username, ''), sc.created
		 FROM system_comments sc
		 LEFT JOIN system_users su ON su.id = sc.created_by
		 WHERE sc.table_name = $1 AND sc.row_id = $2
		 ORDER BY sc.created, sc.id`,
		agentHandoverReportTableName,
		handoverID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var comments []AgentHandoverComment
	for rows.Next() {
		var comment AgentHandoverComment
		if err := rows.Scan(&comment.ID, &comment.Text, &comment.Username, &comment.CreatedAt); err != nil {
			return nil, err
		}
		comments = append(comments, comment)
	}
	return comments, rows.Err()
}

// appendHandoverCommentHandler adds a screened note beside an immutable manifest and returns the handover as read.
func appendHandoverCommentHandler(w http.ResponseWriter, r *http.Request, patch handoverReportPatchRequest) {
	text, err := normalizeHandoverComment(*patch.Comment)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}
	if _, err := fetchHandoverReportByID(patch.ID, false); err == sql.ErrNoRows {
		httpresponse.RespondWithError(w, http.StatusNotFound, "handover_not_found")
		return
	} else if err != nil {
		respondAgentToolDatabaseError(w, "fetch handover before comment", err)
		return
	}
	if _, err := backend.Db.Exec(
		`INSERT INTO system_comments (table_name, row_id, comment_text, created_by)
		 VALUES ($1, $2, $3, CASE WHEN $4 > 1 THEN $4 END)`,
		agentHandoverReportTableName,
		patch.ID,
		text,
		currentAgentToolUserID(r),
	); err != nil {
		respondAgentToolDatabaseError(w, "append handover comment", err)
		return
	}
	report, err := readHandoverReport(patch.ID, false)
	if err != nil {
		respondAgentToolDatabaseError(w, "reload handover after comment", err)
		return
	}
	httpresponse.RespondWithJSON(w, http.StatusCreated, report)
}

// decodeHandoverPatch reads a state change or a comment; exactly one of them is allowed.
func decodeHandoverPatch(r *http.Request) (handoverReportPatchRequest, string) {
	var patch handoverReportPatchRequest
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		return patch, "invalid_json"
	}
	if patch.ID <= 0 || (patch.State == nil) == (patch.Comment == nil) {
		return patch, "id_and_either_state_or_comment_are_required"
	}
	return patch, ""
}
