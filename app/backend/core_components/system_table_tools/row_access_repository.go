// row_access_repository.go
// Reads exact-row access actions, eligible principals, and aggregate direct-rule state.
// Bridges normalized database records with the administrator editor's stable readback model.
// Exists so endpoint and mutation code share one deterministic repository-level view.
package system_table_tools

import (
	"context"
	"database/sql"
	"errors"

	"github.com/lib/pq"
)

func listRowAccessActions(ctx context.Context, tx *sql.Tx) ([]rowAccessAction, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT actions.id,
		       actions.action_key,
		       actions.label_lang_key,
		       categories.category_key,
		       actions.sort_order
		FROM public.system_permission_actions AS actions
		JOIN public.system_permission_categories AS categories
		  ON categories.id = actions.category_id
		 AND categories.enabled IS TRUE
		WHERE actions.enabled IS TRUE
		  AND actions.scope_type = 'row'
		  AND actions.action_key IN ('read', 'update', 'delete')
		ORDER BY categories.sort_order, actions.sort_order, actions.action_key
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	actions := make([]rowAccessAction, 0, 3)
	for rows.Next() {
		var action rowAccessAction
		if err := rows.Scan(&action.ID, &action.Key, &action.LabelLangKey, &action.CategoryKey, &action.SortOrder); err != nil {
			return nil, err
		}
		actions = append(actions, action)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(actions) != 3 {
		return nil, errRowAccessAction
	}
	return actions, nil
}

func listRowAccessPrincipals(ctx context.Context, tx *sql.Tx) ([]rowAccessPrincipal, error) {
	principals := make([]rowAccessPrincipal, 0)
	groupRows, err := tx.QueryContext(ctx, `
		SELECT id, name FROM public.system_user_groups ORDER BY lower(name), id
	`)
	if err != nil {
		return nil, err
	}
	for groupRows.Next() {
		var principal rowAccessPrincipal
		principal.Type = "group"
		if err := groupRows.Scan(&principal.ID, &principal.Name); err != nil {
			groupRows.Close()
			return nil, err
		}
		principals = append(principals, principal)
	}
	if err := groupRows.Err(); err != nil {
		groupRows.Close()
		return nil, err
	}
	groupRows.Close()

	userRows, err := tx.QueryContext(ctx, `
		SELECT id, username, COALESCE(full_name, '')
		FROM public.system_users
		WHERE COALESCE(enabled, FALSE) IS TRUE
		ORDER BY lower(username), id
	`)
	if err != nil {
		return nil, err
	}
	defer userRows.Close()
	for userRows.Next() {
		var principal rowAccessPrincipal
		principal.Type = "user"
		if err := userRows.Scan(&principal.ID, &principal.Name, &principal.FullName); err != nil {
			return nil, err
		}
		principals = append(principals, principal)
	}
	return principals, userRows.Err()
}

func uniformRowAccessState(state string, count int) rowAccessActionState {
	result := rowAccessActionState{State: state}
	switch state {
	case "allow":
		result.AllowCount = count
	case "deny":
		result.DenyCount = count
	default:
		result.InheritedCount = count
	}
	return result
}

func readRowAccessStates(
	ctx context.Context,
	tx *sql.Tx,
	tableUID int64,
	rowIDs []int64,
	principals []rowAccessPrincipalRef,
	actions []rowAccessAction,
) (map[string]rowAccessActionState, error) {
	targetCount := len(rowIDs) * len(principals)
	if targetCount <= 0 {
		return nil, errRowAccessPrincipal
	}
	states := make(map[string]rowAccessActionState, len(actions))
	for _, action := range actions {
		states[action.Key] = uniformRowAccessState("inherited", targetCount)
	}
	principalTypes := make([]string, 0, len(principals))
	principalIDs := make([]int64, 0, len(principals))
	for _, principal := range principals {
		principalTypes = append(principalTypes, principal.Type)
		principalIDs = append(principalIDs, principal.ID)
	}
	rows, err := tx.QueryContext(ctx, `
		SELECT actions.action_key, rules.effect, count(*)
		FROM public.system_row_access_rules AS rules
		JOIN public.system_permission_actions AS actions ON actions.id = rules.action_id
		JOIN unnest($3::text[], $4::bigint[])
		     AS selected_principals(principal_type, principal_id)
		  ON (
		      selected_principals.principal_type = 'user'
		      AND rules.user_id = selected_principals.principal_id
		  ) OR (
		      selected_principals.principal_type = 'group'
		      AND rules.group_id = selected_principals.principal_id
		  )
		WHERE rules.table_uid = $1
		  AND rules.row_id = ANY($2)
		  AND actions.action_key IN ('read', 'update', 'delete')
		GROUP BY actions.action_key, rules.effect
	`, tableUID, pq.Array(rowIDs), pq.Array(principalTypes), pq.Array(principalIDs))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var action string
		var effect string
		var count int
		if err := rows.Scan(&action, &effect, &count); err != nil {
			return nil, err
		}
		state, exists := states[action]
		if !exists || count < 0 || count > state.InheritedCount {
			return nil, errors.New("invalid row access rule readback")
		}
		state.InheritedCount -= count
		if effect == "allow" {
			state.AllowCount += count
		} else if effect == "deny" {
			state.DenyCount += count
		} else {
			return nil, errors.New("invalid row access effect")
		}
		states[action] = state
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for action, state := range states {
		switch {
		case state.AllowCount == targetCount:
			state.State = "allow"
		case state.DenyCount == targetCount:
			state.State = "deny"
		case state.InheritedCount == targetCount:
			state.State = "inherited"
		default:
			state.State = "mixed"
		}
		states[action] = state
	}
	return states, nil
}
