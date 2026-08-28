// status_action_handler.go
// Applies one confirmed lifecycle action to one or more selected worklines atomically.
// Bridges owner-operated Observatory controls with attributed canonical workline state.
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

const maxWorklineStatusActionRows = 100

var observatoryWorklineStatuses = map[string]struct{}{
	"active": {}, "paused": {}, "closed": {}, "archived": {},
}

type worklineStatusActionSelection struct {
	ID               int64 `json:"id"`
	ExpectedRevision int64 `json:"expected_revision"`
}

type worklineStatusActionRequest struct {
	Worklines    []worklineStatusActionSelection `json:"worklines"`
	TargetStatus string                          `json:"target_status"`
}

type worklineStatusActionResult struct {
	ID             int64  `json:"id"`
	Title          string `json:"title"`
	Status         string `json:"status"`
	StatusRevision int64  `json:"status_revision"`
}

type worklineStatusActionResponse struct {
	TargetStatus   string                       `json:"target_status"`
	ChangedCount   int                          `json:"changed_count"`
	UnchangedCount int                          `json:"unchanged_count"`
	Worklines      []worklineStatusActionResult `json:"worklines"`
}

// WorklineStatusActionsHandler applies one owner-confirmed status to a bounded selection.
func WorklineStatusActionsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	userID, err := e_sessions.GetUserIDFromSession(r)
	if err != nil || userID <= 1 {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, "not_authenticated")
		return
	}

	var input worklineStatusActionRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	normalized, err := normalizeWorklineStatusAction(input)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction_unavailable")
		return
	}
	results, err := lockWorklineStatusActionRows(r, tx, normalized)
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
		if expectedByID[result.ID] != result.StatusRevision {
			httpresponse.RespondWithError(w, http.StatusConflict, "workline_status_changed_since_selection")
			return
		}
	}

	response := worklineStatusActionResponse{
		TargetStatus: normalized.TargetStatus,
		Worklines:    make([]worklineStatusActionResult, 0, len(results)),
	}
	for _, result := range results {
		if result.Status == normalized.TargetStatus {
			response.UnchangedCount++
			response.Worklines = append(response.Worklines, result)
			continue
		}
		if err := tx.QueryRowContext(r.Context(), `
            UPDATE dev_agent_worklines
            SET status = $1,
                status_changed_by = $2,
                status_changed_at = now(),
                status_change_source = 'observatory_ui',
                status_revision = status_revision + 1
            WHERE id = $3 AND status_revision = $4
            RETURNING status, status_revision`,
			normalized.TargetStatus, userID, result.ID, result.StatusRevision,
		).Scan(&result.Status, &result.StatusRevision); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				httpresponse.RespondWithError(w, http.StatusConflict, "workline_status_changed_since_selection")
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

func normalizeWorklineStatusAction(input worklineStatusActionRequest) (worklineStatusActionRequest, error) {
	input.TargetStatus = strings.ToLower(strings.TrimSpace(input.TargetStatus))
	if _, ok := observatoryWorklineStatuses[input.TargetStatus]; !ok {
		return input, errors.New("invalid_target_status")
	}
	if len(input.Worklines) == 0 || len(input.Worklines) > maxWorklineStatusActionRows {
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

func lockWorklineStatusActionRows(
	r *http.Request,
	tx *sql.Tx,
	input worklineStatusActionRequest,
) ([]worklineStatusActionResult, error) {
	ids := make([]int64, 0, len(input.Worklines))
	for _, selected := range input.Worklines {
		ids = append(ids, selected.ID)
	}
	rows, err := tx.QueryContext(r.Context(), `
        SELECT id, title, status, status_revision
        FROM dev_agent_worklines
        WHERE id = ANY($1)
        ORDER BY id
        FOR UPDATE`, pq.Array(ids))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	results := make([]worklineStatusActionResult, 0, len(ids))
	for rows.Next() {
		var result worklineStatusActionResult
		if err := rows.Scan(&result.ID, &result.Title, &result.Status, &result.StatusRevision); err != nil {
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
