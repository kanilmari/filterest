// priority_action_handler.go
// Applies one confirmed priority action to one or more selected worklines atomically.
// Bridges owner-operated Observatory controls with attributed scheduling priority without changing lifecycle state or reported phase.
// Exists so a bulk decision either changes every still-current row or changes none.
package workline_observatory

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strings"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	e_sessions "easelect/backend/core_components/sessions"

	"github.com/lib/pq"
)

const maxWorklinePriorityActionRows = 100

type worklinePriorityActionSelection struct {
	ID               int64 `json:"id"`
	ExpectedRevision int64 `json:"expected_revision"`
}

type worklinePriorityActionRequest struct {
	Worklines      []worklinePriorityActionSelection `json:"worklines"`
	TargetPriority string                            `json:"target_priority"`
}

type worklinePriorityActionResult struct {
	ID               int64  `json:"id"`
	Title            string `json:"title"`
	Priority         string `json:"priority"`
	PriorityRevision int64  `json:"priority_revision"`
}

type worklinePriorityActionResponse struct {
	TargetPriority string                         `json:"target_priority"`
	ChangedCount   int                            `json:"changed_count"`
	UnchangedCount int                            `json:"unchanged_count"`
	Worklines      []worklinePriorityActionResult `json:"worklines"`
}

// WorklinePriorityActionsHandler applies one priority to a bounded selection.
func WorklinePriorityActionsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	userID, err := e_sessions.GetUserIDFromSession(r)
	if err != nil || userID <= 1 {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, "not_authenticated")
		return
	}

	var input worklinePriorityActionRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	normalized, err := normalizeWorklinePriorityAction(input)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction_unavailable")
		return
	}
	results, err := lockWorklinePriorityActionRows(r, tx, normalized)
	if errors.Is(err, sql.ErrNoRows) {
		httpresponse.RespondWithError(w, http.StatusNotFound, "workline_not_found")
		return
	}
	if err != nil {
		respondReleaseGoalDatabaseError(w, err)
		return
	}

	expectedByID := make(map[int64]int64, len(normalized.Worklines))
	for _, selected := range normalized.Worklines {
		expectedByID[selected.ID] = selected.ExpectedRevision
	}
	for _, result := range results {
		if expectedByID[result.ID] != result.PriorityRevision {
			httpresponse.RespondWithError(w, http.StatusConflict, "workline_priority_changed_since_selection")
			return
		}
	}

	response := worklinePriorityActionResponse{
		TargetPriority: normalized.TargetPriority,
		Worklines:      make([]worklinePriorityActionResult, 0, len(results)),
	}
	for _, result := range results {
		if result.Priority == normalized.TargetPriority {
			response.UnchangedCount++
			response.Worklines = append(response.Worklines, result)
			continue
		}
		if err := tx.QueryRowContext(r.Context(), `
            UPDATE dev_agent_worklines
            SET priority = $1,
                priority_changed_by = $2,
                priority_changed_at = now(),
                priority_revision = priority_revision + 1
            WHERE id = $3 AND priority_revision = $4
            RETURNING priority, priority_revision`,
			normalized.TargetPriority, userID, result.ID, result.PriorityRevision,
		).Scan(&result.Priority, &result.PriorityRevision); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				httpresponse.RespondWithError(w, http.StatusConflict, "workline_priority_changed_since_selection")
				return
			}
			respondReleaseGoalDatabaseError(w, err)
			return
		}
		response.ChangedCount++
		response.Worklines = append(response.Worklines, result)
	}
	httpresponse.RespondWithJSON(w, http.StatusOK, response)
}

func normalizeWorklinePriorityAction(input worklinePriorityActionRequest) (worklinePriorityActionRequest, error) {
	input.TargetPriority = strings.ToLower(strings.TrimSpace(input.TargetPriority))
	if _, ok := worklinePriorityRank[input.TargetPriority]; !ok {
		return input, errors.New("invalid_target_priority")
	}
	if len(input.Worklines) == 0 || len(input.Worklines) > maxWorklinePriorityActionRows {
		return input, errors.New("workline_selection_must_contain_1_to_100_rows")
	}
	seen := make(map[int64]struct{}, len(input.Worklines))
	for _, selected := range input.Worklines {
		if selected.ID <= 0 || selected.ExpectedRevision < 0 {
			return input, errors.New("invalid_workline_selection")
		}
		if _, exists := seen[selected.ID]; exists {
			return input, errors.New("duplicate_workline_selection")
		}
		seen[selected.ID] = struct{}{}
	}
	sort.Slice(input.Worklines, func(i, j int) bool {
		return input.Worklines[i].ID < input.Worklines[j].ID
	})
	return input, nil
}

func lockWorklinePriorityActionRows(
	r *http.Request,
	tx *sql.Tx,
	input worklinePriorityActionRequest,
) ([]worklinePriorityActionResult, error) {
	ids := make([]int64, 0, len(input.Worklines))
	for _, selected := range input.Worklines {
		ids = append(ids, selected.ID)
	}
	rows, err := tx.QueryContext(r.Context(), `
        SELECT id, title, priority, priority_revision
        FROM dev_agent_worklines
        WHERE id = ANY($1)
        ORDER BY id
        FOR UPDATE`, pq.Array(ids))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	results := make([]worklinePriorityActionResult, 0, len(ids))
	for rows.Next() {
		var result worklinePriorityActionResult
		if err := rows.Scan(&result.ID, &result.Title, &result.Priority, &result.PriorityRevision); err != nil {
			return nil, err
		}
		results = append(results, result)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(results) != len(ids) {
		return nil, sql.ErrNoRows
	}
	return results, nil
}
