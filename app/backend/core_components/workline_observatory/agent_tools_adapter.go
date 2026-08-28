// agent_tools_adapter.go
// Reads observatory state from the canonical private Agent Tools tables.
// Bridges the workline observatory API with worklines, reports, task links, and release goals.
// Exists to keep all feature-specific SQL inside the observatory module boundary.
package workline_observatory

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/lib/pq"
)

const boardWorklinesQuery = `
SELECT w.id, w.title, w.status, w.tags, w.updated,
       w.status_revision, w.status_changed_by,
       COALESCE(status_user.username, ''), w.status_changed_at, w.status_change_source,
       COALESCE(latest.id, 0), COALESCE(latest.title, ''),
       COALESCE(latest.phase_gate, ''), COALESCE(latest.current_phase, 0),
       COALESCE(latest.workline_status_snapshot, ''),
       COALESCE(latest.context_text, ''), COALESCE(latest.plain_language_text, ''),
       COALESCE(latest.technical_text, ''), COALESCE(latest.next_step_text, ''),
       COALESCE(latest.git_head_commit, ''), COALESCE(latest.git_worktree_state, ''),
       COALESCE(latest.git_has_other_changes, FALSE),
       COALESCE(latest.git_workline_changed_paths, '{}'::TEXT[]), latest.created,
       COALESCE(tasks.task_ids, '{}'::BIGINT[])
FROM dev_agent_worklines AS w
LEFT JOIN system_users AS status_user ON status_user.id = w.status_changed_by
LEFT JOIN LATERAL (
    SELECT r.id, r.title, r.phase_gate, r.current_phase, r.workline_status_snapshot, r.context_text,
           r.plain_language_text, r.technical_text, r.next_step_text,
           r.git_head_commit, r.git_worktree_state, r.git_has_other_changes,
           r.git_workline_changed_paths, r.created
    FROM dev_agent_workline_reports AS r
    WHERE r.workline_id = w.id AND r.state = 'final'
    ORDER BY r.created DESC, r.id DESC
    LIMIT 1
) AS latest ON TRUE
LEFT JOIN LATERAL (
    SELECT array_agg(link.task_id ORDER BY link.task_id) AS task_ids
    FROM dev_agent_workline_tasks AS link
    WHERE link.workline_id = w.id
) AS tasks ON TRUE
ORDER BY w.updated DESC, w.id DESC`

func loadBoardSnapshot(ctx context.Context, database *sql.DB) (BoardSnapshot, error) {
	snapshot := BoardSnapshot{GeneratedAt: time.Now().UTC(), Worklines: []BoardWorkline{}}
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
		&workline.ID, &workline.Title, &workline.Status, pq.Array(&workline.Tags), &workline.UpdatedAt,
		&workline.StatusRevision, &statusChangedBy,
		&workline.LatestStatusChange.ChangedByUsername, &workline.LatestStatusChange.ChangedAt,
		&workline.LatestStatusChange.Source,
		&report.ID, &report.Title, &report.PhaseGate, &report.CurrentPhase,
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

func loadSelectedReleaseGoal(ctx context.Context, database *sql.DB) (*BoardReleaseGoal, error) {
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
