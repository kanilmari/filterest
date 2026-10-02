// agent_tools_adapter.go
// Reads observatory state from the canonical private Agent Tools tables.
// Bridges the workline observatory API with worklines, reports, task links, and release goals.
// Exists to keep all feature-specific SQL inside the observatory module boundary.
package workline_observatory

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	dtt_search_vectors "easelect/backend/core_components/dynamic_table_tools/search_vectors"

	"github.com/lib/pq"
)

// boardReader is the database or one transaction over it. The board handler
// reads the board and its search through one repeatable-read transaction, so a
// report published between the two reads cannot pair one report's phase with
// another report's text.
type boardReader interface {
	QueryContext(ctx context.Context, query string, args ...interface{}) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...interface{}) *sql.Row
}

// boardLatestReportJoin is the one definition of a workline's latest final
// report. The board shows it and the search reads it, so both see the same text.
const boardLatestReportJoin = `
LEFT JOIN LATERAL (
    SELECT r.id, r.title, r.report_type, r.outcome, r.state,
           r.phase_gate, r.current_phase, r.workline_status_snapshot, r.context_text,
           r.plain_language_text, r.technical_text, r.next_step_text,
           r.git_head_commit, r.git_worktree_state, r.git_has_other_changes,
           r.git_workline_changed_paths, r.created
    FROM dev_agent_workline_reports AS r
    WHERE r.workline_id = w.id AND r.state = 'final'
    ORDER BY r.created DESC, r.id DESC
    LIMIT 1
) AS latest ON TRUE`

const boardWorklinesQuery = `
SELECT w.id, w.title, w.status, w.tags, w.updated, w.priority, w.priority_revision,
       w.status_revision, w.status_changed_by,
       COALESCE(status_user.username, ''), w.status_changed_at, w.status_change_source,
       COALESCE(latest.id, 0), COALESCE(latest.title, ''),
       COALESCE(latest.report_type, ''), COALESCE(latest.outcome, ''), COALESCE(latest.state, ''),
       COALESCE(latest.phase_gate, ''), COALESCE(latest.current_phase, 0),
       COALESCE(latest.workline_status_snapshot, ''),
       COALESCE(latest.context_text, ''), COALESCE(latest.plain_language_text, ''),
       COALESCE(latest.technical_text, ''), COALESCE(latest.next_step_text, ''),
       COALESCE(latest.git_head_commit, ''), COALESCE(latest.git_worktree_state, ''),
       COALESCE(latest.git_has_other_changes, FALSE),
       COALESCE(latest.git_workline_changed_paths, '{}'::TEXT[]), latest.created,
       COALESCE(tasks.task_ids, '{}'::BIGINT[])
FROM dev_agent_worklines AS w
LEFT JOIN system_users AS status_user ON status_user.id = w.status_changed_by` + boardLatestReportJoin + `
LEFT JOIN LATERAL (
    SELECT array_agg(link.task_id ORDER BY link.task_id) AS task_ids
    FROM dev_agent_workline_tasks AS link
    WHERE link.workline_id = w.id
) AS tasks ON TRUE
ORDER BY w.updated DESC, w.id DESC`

// maxBoardSearchLength bounds the search text a request may send to the database.
const maxBoardSearchLength = 2000

var errWorklineSearchTooLong = errors.New("workline_search_too_long")

// boardSearchVector is the text the search reads: a workline's title and its
// latest report's four text fields, split into words exactly as every dataset's
// search vector is.
var boardSearchVector = dtt_search_vectors.SearchVectorExpressionForValues([]string{
	"coalesce(w.title::text,'')",
	"coalesce(latest.context_text::text,'')",
	"coalesce(latest.plain_language_text::text,'')",
	"coalesce(latest.technical_text::text,'')",
	"coalesce(latest.next_step_text::text,'')",
})

// loadBoardSearchMatches returns the worklines a search finds, best match first.
// It is the search every dataset uses (dtt_search_vectors.TextSearchCondition):
// word beginnings, any of the words, and a plain number that also names the
// workline with that number, listed first. Without a search it returns nil.
func loadBoardSearchMatches(ctx context.Context, database boardReader, rawSearch string) ([]int64, error) {
	rawSearch = strings.TrimSpace(rawSearch)
	if len(rawSearch) > maxBoardSearchLength {
		return nil, errWorklineSearchTooLong
	}
	search, ok := dtt_search_vectors.TextSearchCondition(rawSearch, boardSearchVector, "w.id", 1)
	if !ok {
		return nil, nil
	}

	query := "SELECT w.id FROM dev_agent_worklines AS w" + boardLatestReportJoin +
		"\nWHERE " + search.Predicate + search.OrderBy
	rows, err := database.QueryContext(ctx, query, search.Args...)
	if err != nil {
		return nil, fmt.Errorf("search worklines: %w", err)
	}
	defer rows.Close()

	// Never nil: a search that finds nothing still filters the board to nothing.
	matches := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan workline search: %w", err)
		}
		matches = append(matches, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate workline search: %w", err)
	}
	return matches, nil
}

const boardWorklineReportHistoryQuery = `
SELECT r.id, r.title, r.report_type, r.outcome, r.state,
       COALESCE(r.phase_gate, ''), COALESCE(r.current_phase, 0),
       COALESCE(r.workline_status_snapshot, ''),
       COALESCE(r.context_text, ''), COALESCE(r.plain_language_text, ''),
       COALESCE(r.technical_text, ''), COALESCE(r.next_step_text, ''),
       COALESCE(r.git_head_commit, ''), COALESCE(r.git_worktree_state, ''),
       COALESCE(r.git_has_other_changes, FALSE),
       COALESCE(r.git_workline_changed_paths, '{}'::TEXT[]), r.created
FROM dev_agent_workline_reports AS r
WHERE r.workline_id = $1
ORDER BY r.created DESC, r.id DESC
LIMIT 100`

func loadBoardSnapshot(ctx context.Context, database boardReader) (BoardSnapshot, error) {
	snapshot := BoardSnapshot{
		GeneratedAt: time.Now().UTC(), Worklines: []BoardWorkline{},
		DatasetSurfaceProviderKey:    "workline-observatory",
		DatasetSurfaceCapabilityKeys: []string{"workline-board-query"},
	}
	rows, err := database.QueryContext(ctx, boardWorklinesQuery)
	if err != nil {
		return snapshot, fmt.Errorf("query worklines: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		workline, scanErr := scanBoardWorkline(rows)
		if scanErr != nil {
			return snapshot, scanErr
		}
		snapshot.Worklines = append(snapshot.Worklines, workline)
	}
	if err := rows.Err(); err != nil {
		return snapshot, fmt.Errorf("iterate worklines: %w", err)
	}

	goal, err := loadSelectedReleaseGoal(ctx, database)
	if err != nil {
		return snapshot, err
	}
	snapshot.ReleaseGoal = goal
	if goal != nil {
		contractsByWorkline := make(map[int64]BoardReleaseContract, len(goal.Contracts))
		for _, contract := range goal.Contracts {
			contractsByWorkline[contract.WorklineID] = contract
		}
		for index := range snapshot.Worklines {
			if contract, ok := contractsByWorkline[snapshot.Worklines[index].ID]; ok {
				copyOfContract := contract
				snapshot.Worklines[index].Contract = &copyOfContract
			}
		}
	}
	return snapshot, nil
}

func scanBoardWorkline(scanner interface{ Scan(...interface{}) error }) (BoardWorkline, error) {
	var workline BoardWorkline
	var report BoardWorklineReport
	var reportCreated sql.NullTime
	var statusChangedBy sql.NullInt64
	if err := scanner.Scan(
		&workline.ID, &workline.Title, &workline.Status, pq.Array(&workline.Tags), &workline.UpdatedAt, &workline.Priority, &workline.PriorityRevision,
		&workline.StatusRevision, &statusChangedBy,
		&workline.LatestStatusChange.ChangedByUsername, &workline.LatestStatusChange.ChangedAt,
		&workline.LatestStatusChange.Source,
		&report.ID, &report.Title, &report.ReportType, &report.Outcome, &report.State,
		&report.PhaseGate, &report.CurrentPhase,
		&report.WorklineStatusSnapshot,
		&report.Context, &report.PlainLanguage, &report.Technical, &report.NextStep,
		&report.GitHeadCommit, &report.GitWorktreeState, &report.GitHasOtherChanges,
		pq.Array(&report.GitWorklineChangedPaths), &reportCreated, pq.Array(&workline.TaskIDs),
	); err != nil {
		return workline, fmt.Errorf("scan workline: %w", err)
	}
	if workline.Tags == nil {
		workline.Tags = []string{}
	}
	if workline.TaskIDs == nil {
		workline.TaskIDs = []int64{}
	}
	if statusChangedBy.Valid {
		value := int(statusChangedBy.Int64)
		workline.LatestStatusChange.ChangedBy = &value
	}
	workline.CurrentPhase = report.CurrentPhase
	workline.StatusReconciliationNeeded = workline.StatusRevision > 0 && report.WorklineStatusSnapshot != workline.Status
	if report.ID > 0 {
		if report.GitWorklineChangedPaths == nil {
			report.GitWorklineChangedPaths = []string{}
		}
		if reportCreated.Valid {
			report.CreatedAt = reportCreated.Time
		}
		workline.LatestReport = &report
	}
	return workline, nil
}

func loadBoardWorklineReportHistory(ctx context.Context, database *sql.DB, worklineID int64) (BoardWorklineReportHistory, error) {
	history := BoardWorklineReportHistory{WorklineID: worklineID, Reports: []BoardWorklineReport{}}
	rows, err := database.QueryContext(ctx, boardWorklineReportHistoryQuery, worklineID)
	if err != nil {
		return history, fmt.Errorf("query workline report history: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var report BoardWorklineReport
		if err := rows.Scan(
			&report.ID, &report.Title, &report.ReportType, &report.Outcome, &report.State,
			&report.PhaseGate, &report.CurrentPhase, &report.WorklineStatusSnapshot,
			&report.Context, &report.PlainLanguage, &report.Technical, &report.NextStep,
			&report.GitHeadCommit, &report.GitWorktreeState, &report.GitHasOtherChanges,
			pq.Array(&report.GitWorklineChangedPaths), &report.CreatedAt,
		); err != nil {
			return history, fmt.Errorf("scan workline report history: %w", err)
		}
		if report.GitWorklineChangedPaths == nil {
			report.GitWorklineChangedPaths = []string{}
		}
		history.Reports = append(history.Reports, report)
	}
	if err := rows.Err(); err != nil {
		return history, fmt.Errorf("iterate workline report history: %w", err)
	}
	return history, nil
}

func loadSelectedReleaseGoal(ctx context.Context, database boardReader) (*BoardReleaseGoal, error) {
	var goal BoardReleaseGoal
	err := database.QueryRowContext(ctx, `
        SELECT id, identity_key, version, title, outcome, decision_state
        FROM dev_agent_release_goals
        WHERE is_selected = TRUE
        LIMIT 1`).Scan(
		&goal.ID, &goal.IdentityKey, &goal.Version, &goal.Title, &goal.Outcome, &goal.DecisionState,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("query selected release goal: %w", err)
	}

	goal.Contracts = []BoardReleaseContract{}
	rows, err := database.QueryContext(ctx, `
        SELECT id, workline_id, completion_rule, target_phase
        FROM dev_agent_release_goal_contracts
        WHERE release_goal_id = $1
        ORDER BY workline_id`, goal.ID)
	if err != nil {
		return nil, fmt.Errorf("query release contracts: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var contract BoardReleaseContract
		var targetPhase sql.NullInt64
		if err := rows.Scan(&contract.ID, &contract.WorklineID, &contract.CompletionRule, &targetPhase); err != nil {
			return nil, fmt.Errorf("scan release contract: %w", err)
		}
		if targetPhase.Valid {
			value := int(targetPhase.Int64)
			contract.TargetPhase = &value
		}
		goal.Contracts = append(goal.Contracts, contract)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate release contracts: %w", err)
	}
	return &goal, nil
}
