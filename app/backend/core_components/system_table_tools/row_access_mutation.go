// row_access_mutation.go
// Applies transactional exact-row access mutations and records their audit events.
// Bridges validated row/principal targets with direct-rule writes and exact readback.
// Exists so bulk permission changes either verify completely or fail with no committed partial state.
package system_table_tools

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"

	"github.com/lib/pq"
)

func applyRowAccessMutation(
	ctx context.Context,
	tx *sql.Tx,
	actorUserID int,
	request rowAccessMutationRequest,
) (rowAccessResponse, error) {
	target, err := resolveRowAccessTarget(ctx, tx, request.Dataset)
	if err != nil {
		return rowAccessResponse{}, err
	}
	if err := validateRowAccessPrincipals(ctx, tx, request.Principals); err != nil {
		return rowAccessResponse{}, err
	}
	if err := validateRowAccessRows(ctx, tx, target, request.RowIDs, true); err != nil {
		return rowAccessResponse{}, err
	}
	actions, err := listRowAccessActions(ctx, tx)
	if err != nil {
		return rowAccessResponse{}, err
	}
	actionByKey := make(map[string]rowAccessAction, len(actions))
	for _, action := range actions {
		actionByKey[action.Key] = action
	}

	orderedKeys := make([]string, 0, len(request.Changes))
	for key := range request.Changes {
		orderedKeys = append(orderedKeys, key)
	}
	sort.Strings(orderedKeys)
	affectedByPrincipal := make([]int64, len(request.Principals))
	var affected int64
	for principalIndex, principal := range request.Principals {
		for _, actionKey := range orderedKeys {
			action, exists := actionByKey[actionKey]
			if !exists {
				return rowAccessResponse{}, errRowAccessAction
			}
			changed, err := writeRowAccessAction(
				ctx,
				tx,
				target.TableUID,
				request.RowIDs,
				principal.Type,
				principal.ID,
				action.ID,
				request.Changes[actionKey],
				request.Reason,
				actorUserID,
			)
			if err != nil {
				return rowAccessResponse{}, err
			}
			affectedByPrincipal[principalIndex] += changed
			affected += changed
		}
	}

	states, err := readRowAccessStates(
		ctx,
		tx,
		target.TableUID,
		request.RowIDs,
		request.Principals,
		actions,
	)
	if err != nil {
		return rowAccessResponse{}, err
	}
	if err := verifyRowAccessMutationReadback(states, request.Changes); err != nil {
		return rowAccessResponse{}, err
	}

	changeSetID, err := newRowAccessChangeSetID()
	if err != nil {
		return rowAccessResponse{}, err
	}
	changesJSON, err := json.Marshal(request.Changes)
	if err != nil {
		return rowAccessResponse{}, err
	}
	for principalIndex, principal := range request.Principals {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO public.system_row_access_rule_events (
				change_set_id, actor_user_id, table_uid,
				principal_type, principal_id, row_ids,
				changes, reason, affected_rule_count
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NULLIF($8, ''), $9)
		`, changeSetID, actorUserID, target.TableUID, principal.Type,
			principal.ID, pq.Array(request.RowIDs), string(changesJSON), request.Reason,
			affectedByPrincipal[principalIndex]); err != nil {
			return rowAccessResponse{}, err
		}
	}

	principals, err := listRowAccessPrincipals(ctx, tx)
	if err != nil {
		return rowAccessResponse{}, err
	}
	return rowAccessResponse{
		Dataset:            target.TableName,
		TableUID:           target.TableUID,
		RowIDs:             request.RowIDs,
		Actions:            actions,
		Principals:         principals,
		SelectedPrincipals: request.Principals,
		StateTargetCount:   len(request.RowIDs) * len(request.Principals),
		States:             states,
		ChangeSetID:        changeSetID,
		AffectedRuleCount:  affected,
	}, nil
}

func writeRowAccessAction(
	ctx context.Context,
	tx *sql.Tx,
	tableUID int64,
	rowIDs []int64,
	principalType string,
	principalID int64,
	actionID int64,
	state string,
	reason string,
	actorUserID int,
) (int64, error) {
	userID := sql.NullInt64{}
	groupID := sql.NullInt64{}
	if principalType == "user" {
		userID = sql.NullInt64{Int64: principalID, Valid: true}
	} else {
		groupID = sql.NullInt64{Int64: principalID, Valid: true}
	}

	if state == "remove" {
		result, err := tx.ExecContext(ctx, `
			DELETE FROM public.system_row_access_rules
			WHERE table_uid = $1
			  AND row_id = ANY($2)
			  AND user_id IS NOT DISTINCT FROM $3
			  AND group_id IS NOT DISTINCT FROM $4
			  AND action_id = $5
		`, tableUID, pq.Array(rowIDs), userID, groupID, actionID)
		if err != nil {
			return 0, err
		}
		return result.RowsAffected()
	}

	result, err := tx.ExecContext(ctx, `
		INSERT INTO public.system_row_access_rules (
			table_uid, row_id, user_id, group_id, action_id,
			effect, reason, valid_from, valid_until, created_by, updated_by
		)
		SELECT $1, selected_rows.row_id, $3, $4, $5,
		       $6, NULLIF($7, ''), now(), NULL, $8, $8
		FROM unnest($2::bigint[]) AS selected_rows(row_id)
		ON CONFLICT (table_uid, row_id, user_id, group_id, action_id)
		DO UPDATE SET
			effect = EXCLUDED.effect,
			reason = EXCLUDED.reason,
			valid_from = now(),
			valid_until = NULL,
			updated_by = EXCLUDED.updated_by,
			updated = now()
		WHERE system_row_access_rules.effect IS DISTINCT FROM EXCLUDED.effect
		   OR system_row_access_rules.reason IS DISTINCT FROM EXCLUDED.reason
		   OR system_row_access_rules.valid_until IS NOT NULL
	`, tableUID, pq.Array(rowIDs), userID, groupID, actionID, state, reason, actorUserID)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

func verifyRowAccessMutationReadback(states map[string]rowAccessActionState, changes map[string]string) error {
	for action, requested := range changes {
		state, exists := states[action]
		if !exists {
			return errors.New("row access readback omitted an action")
		}
		expected := requested
		if requested == "remove" {
			expected = "inherited"
		}
		if state.State != expected {
			return fmt.Errorf("row access readback mismatch for %s", action)
		}
	}
	return nil
}

func newRowAccessChangeSetID() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(bytes)
	return fmt.Sprintf(
		"%s-%s-%s-%s-%s",
		encoded[0:8],
		encoded[8:12],
		encoded[12:16],
		encoded[16:20],
		encoded[20:32],
	), nil
}
