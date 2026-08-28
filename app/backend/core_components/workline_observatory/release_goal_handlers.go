// release_goal_handlers.go
// Creates, selects, locks, and classifies release goals through bounded admin APIs.
// Bridges human release decisions with database-enforced draft and locked contracts.
// Exists so neither the UI nor an AI can silently rewrite an accepted release boundary.
package workline_observatory

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"regexp"
	"strings"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	e_sessions "easelect/backend/core_components/sessions"
)

var releaseGoalIdentityPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{1,79}$`)

var allowedCompletionRules = map[string]struct{}{
	"must_complete": {}, "must_remain_incomplete": {}, "must_be_in_phase": {},
	"must_not_start": {}, "outside_release": {},
}

type releaseGoalCreateRequest struct {
	IdentityKey string `json:"identity_key"`
	Version     int    `json:"version"`
	Title       string `json:"title"`
	Outcome     string `json:"outcome"`
	Selected    bool   `json:"selected"`
}

type releaseGoalActionRequest struct {
	ID     int64  `json:"id"`
	Action string `json:"action"`
}

type releaseContractRequest struct {
	ReleaseGoalID  int64  `json:"release_goal_id"`
	WorklineID     int64  `json:"workline_id"`
	CompletionRule string `json:"completion_rule"`
	TargetPhase    *int   `json:"target_phase"`
}

// ReleaseGoalsHandler creates drafts and performs explicit select or lock actions.
func ReleaseGoalsHandler(w http.ResponseWriter, r *http.Request) {
	userID, err := e_sessions.GetUserIDFromSession(r)
	if err != nil || userID <= 1 {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, "not_authenticated")
		return
	}
	switch r.Method {
	case http.MethodPost:
		createReleaseGoal(w, r, userID)
	case http.MethodPatch:
		applyReleaseGoalAction(w, r, userID)
	default:
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func createReleaseGoal(w http.ResponseWriter, r *http.Request, userID int) {
	var input releaseGoalCreateRequest
	if json.NewDecoder(r.Body).Decode(&input) != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	input.IdentityKey = strings.ToLower(strings.TrimSpace(input.IdentityKey))
	input.Title = strings.TrimSpace(input.Title)
	input.Outcome = strings.TrimSpace(input.Outcome)
	if !releaseGoalIdentityPattern.MatchString(input.IdentityKey) || input.Version < 1 ||
		len(input.Title) == 0 || len(input.Title) > 300 || len(input.Outcome) == 0 || len(input.Outcome) > 2000 {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid_release_goal")
		return
	}

	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction_unavailable")
		return
	}
	if input.Selected {
		if _, err := tx.ExecContext(r.Context(), "UPDATE dev_agent_release_goals SET is_selected = FALSE WHERE is_selected = TRUE"); err != nil {
			respondReleaseGoalDatabaseError(w, err)
			return
		}
	}
	var id int64
	err := tx.QueryRowContext(r.Context(), `
        INSERT INTO dev_agent_release_goals (
            identity_key, version, title, outcome, is_selected, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id`,
		input.IdentityKey, input.Version, input.Title, input.Outcome, input.Selected, userID,
	).Scan(&id)
	if err != nil {
		respondReleaseGoalDatabaseError(w, err)
		return
	}
	httpresponse.RespondWithJSON(w, http.StatusCreated, map[string]any{"id": id, "decision_state": "draft"})
}

func applyReleaseGoalAction(w http.ResponseWriter, r *http.Request, userID int) {
	var input releaseGoalActionRequest
	if json.NewDecoder(r.Body).Decode(&input) != nil || input.ID <= 0 {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid_release_goal_action")
		return
	}
	input.Action = strings.ToLower(strings.TrimSpace(input.Action))
	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction_unavailable")
		return
	}

	switch input.Action {
	case "select":
		if _, err := tx.ExecContext(r.Context(), "UPDATE dev_agent_release_goals SET is_selected = FALSE WHERE is_selected = TRUE AND id <> $1", input.ID); err != nil {
			respondReleaseGoalDatabaseError(w, err)
			return
		}
		if result, err := tx.ExecContext(r.Context(), "UPDATE dev_agent_release_goals SET is_selected = TRUE, updated = now() WHERE id = $1", input.ID); err != nil {
			respondReleaseGoalDatabaseError(w, err)
			return
		} else if count, _ := result.RowsAffected(); count != 1 {
			httpresponse.RespondWithError(w, http.StatusNotFound, "release_goal_not_found")
			return
		}
	case "lock":
		var state string
		if err := tx.QueryRowContext(r.Context(), "SELECT decision_state FROM dev_agent_release_goals WHERE id = $1 FOR UPDATE", input.ID).Scan(&state); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				httpresponse.RespondWithError(w, http.StatusNotFound, "release_goal_not_found")
				return
			}
			respondReleaseGoalDatabaseError(w, err)
			return
		}
		if err := validateReleaseGoalCanLock(state, 0); err != nil {
			httpresponse.RespondWithError(w, http.StatusConflict, err.Error())
			return
		}
		var missing int
		if err := tx.QueryRowContext(r.Context(), `
            SELECT count(*)
            FROM dev_agent_worklines AS worklines
            WHERE worklines.status = 'active'
              AND NOT EXISTS (
                  SELECT 1 FROM dev_agent_release_goal_contracts AS contracts
                  WHERE contracts.release_goal_id = $1 AND contracts.workline_id = worklines.id
              )`, input.ID).Scan(&missing); err != nil {
			respondReleaseGoalDatabaseError(w, err)
			return
		}
		if err := validateReleaseGoalCanLock(state, missing); err != nil {
			httpresponse.RespondWithError(w, http.StatusConflict, err.Error())
			return
		}
		result, err := tx.ExecContext(r.Context(), `
            UPDATE dev_agent_release_goals
            SET decision_state = 'locked', locked_by = $2, locked_at = now(), updated = now()
            WHERE id = $1 AND decision_state = 'draft'`, input.ID, userID)
		if err != nil {
			respondReleaseGoalDatabaseError(w, err)
			return
		}
		if count, _ := result.RowsAffected(); count != 1 {
			httpresponse.RespondWithError(w, http.StatusConflict, "release_goal_not_lockable")
			return
		}
	default:
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid_release_goal_action")
		return
	}
	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]any{"id": input.ID, "action": input.Action})
}

// ReleaseContractsHandler upserts one classification while its goal remains a draft.
func ReleaseContractsHandler(w http.ResponseWriter, r *http.Request) {
	userID, err := e_sessions.GetUserIDFromSession(r)
	if err != nil || userID <= 1 {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, "not_authenticated")
		return
	}
	if r.Method != http.MethodPut {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var input releaseContractRequest
	if json.NewDecoder(r.Body).Decode(&input) != nil || input.ReleaseGoalID <= 0 || input.WorklineID <= 0 {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid_release_contract")
		return
	}
	input.CompletionRule = strings.ToLower(strings.TrimSpace(input.CompletionRule))
	if _, ok := allowedCompletionRules[input.CompletionRule]; !ok ||
		(input.TargetPhase != nil && (*input.TargetPhase < 0 || *input.TargetPhase > 6)) ||
		(input.CompletionRule == "must_be_in_phase" && input.TargetPhase == nil) {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid_release_contract")
		return
	}

	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction_unavailable")
		return
	}
	var state string
	if err := tx.QueryRowContext(r.Context(), "SELECT decision_state FROM dev_agent_release_goals WHERE id = $1 FOR UPDATE", input.ReleaseGoalID).Scan(&state); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpresponse.RespondWithError(w, http.StatusNotFound, "release_goal_not_found")
			return
		}
		respondReleaseGoalDatabaseError(w, err)
		return
	}
	if err := validateReleaseContractGoalState(state); err != nil {
		httpresponse.RespondWithError(w, http.StatusConflict, err.Error())
		return
	}
	result, err := tx.ExecContext(r.Context(), `
        UPDATE dev_agent_release_goal_contracts
        SET completion_rule = $3, target_phase = $4, updated = now()
        WHERE release_goal_id = $1 AND workline_id = $2`,
		input.ReleaseGoalID, input.WorklineID, input.CompletionRule, input.TargetPhase,
	)
	if err != nil {
		respondReleaseGoalDatabaseError(w, err)
		return
	}
	if count, _ := result.RowsAffected(); count == 0 {
		if _, err := tx.ExecContext(r.Context(), `
            INSERT INTO dev_agent_release_goal_contracts (
                release_goal_id, workline_id, completion_rule, target_phase, created_by
            ) VALUES ($1, $2, $3, $4, $5)`,
			input.ReleaseGoalID, input.WorklineID, input.CompletionRule, input.TargetPhase, userID,
		); err != nil {
			respondReleaseGoalDatabaseError(w, err)
			return
		}
	}
	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]any{"workline_id": input.WorklineID})
}

func respondReleaseGoalDatabaseError(w http.ResponseWriter, err error) {
	log.Printf("workline observatory release goal failed: %v", err)
	httpresponse.RespondWithError(w, http.StatusInternalServerError, "workline_observatory_database_error")
}

func validateReleaseGoalCanLock(state string, missingActiveContracts int) error {
	if state != "draft" {
		return errors.New("release_goal_not_lockable")
	}
	if missingActiveContracts > 0 {
		return errors.New("active_worklines_require_release_contracts")
	}
	return nil
}

func validateReleaseContractGoalState(state string) error {
	if state != "draft" {
		return errors.New("locked_release_goal_contracts_are_immutable")
	}
	return nil
}
