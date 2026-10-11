// publication_reader.go
// Reads Publications newest-unpublished first from the existing release-goal tables.
// Connects the dedicated API and Observatory board to one ordering and focus rule.
// Keeps publication history bounded and workline contracts attached to the current plan.
package workline_observatory

import (
	"context"
	"database/sql"
	"fmt"
)

const publicationsQuery = `
SELECT id, identity_key, version, title, outcome, decision_state, is_selected,
       publication_version, to_char(target_date, 'YYYY-MM-DD'), reader_description, published,
       published_at, publication_revision
FROM dev_agent_release_goals
ORDER BY published ASC, created DESC, id DESC
LIMIT 100`

func loadPublications(ctx context.Context, database boardReader) ([]BoardReleaseGoal, error) {
	publications := []BoardReleaseGoal{}
	rows, err := database.QueryContext(ctx, publicationsQuery)
	if err != nil {
		return nil, fmt.Errorf("query publications: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var goal BoardReleaseGoal
		var targetDate sql.NullString
		var publishedAt sql.NullTime
		if err := rows.Scan(&goal.ID, &goal.IdentityKey, &goal.Version, &goal.Title,
			&goal.Outcome, &goal.DecisionState, &goal.IsSelected, &goal.PublicationVersion,
			&targetDate, &goal.ReaderDescription, &goal.Published, &publishedAt, &goal.PublicationRevision); err != nil {
			return nil, fmt.Errorf("scan publication: %w", err)
		}
		if targetDate.Valid {
			goal.TargetDate = &targetDate.String
		}
		if publishedAt.Valid {
			goal.PublishedAt = &publishedAt.Time
		}
		goal.Contracts = []BoardReleaseContract{}
		goal.IsCurrentPublication = len(publications) == 0 && !goal.Published
		publications = append(publications, goal)
	}
	return publications, rows.Err()
}

func loadReleaseGoalContracts(ctx context.Context, database boardReader, goal *BoardReleaseGoal) error {
	rows, err := database.QueryContext(ctx, `
        SELECT id, workline_id, completion_rule, target_phase
        FROM dev_agent_release_goal_contracts
        WHERE release_goal_id = $1
        ORDER BY workline_id`, goal.ID)
	if err != nil {
		return fmt.Errorf("query release contracts: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var contract BoardReleaseContract
		var targetPhase sql.NullInt64
		if err := rows.Scan(&contract.ID, &contract.WorklineID, &contract.CompletionRule, &targetPhase); err != nil {
			return fmt.Errorf("scan release contract: %w", err)
		}
		if targetPhase.Valid {
			value := int(targetPhase.Int64)
			contract.TargetPhase = &value
		}
		goal.Contracts = append(goal.Contracts, contract)
	}
	return rows.Err()
}
