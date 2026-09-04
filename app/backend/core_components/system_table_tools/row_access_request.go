// row_access_request.go
// Validates and normalizes exact-row access requests and their database targets.
// Bridges untrusted HTTP values with registered datasets, rows, users, and groups.
// Exists so readback and mutation paths share one bounded fail-closed input contract.
package system_table_tools

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"easelect/backend/core_components/security"

	"github.com/lib/pq"
)

func decodeRowAccessMutationRequest(reader io.Reader) (rowAccessMutationRequest, error) {
	var request rowAccessMutationRequest
	decoder := json.NewDecoder(io.LimitReader(reader, maxRowAccessRequestBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return rowAccessMutationRequest{}, errors.New("invalid request body")
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return rowAccessMutationRequest{}, errors.New("request body must contain one JSON object")
	}

	request.Dataset = strings.TrimSpace(request.Dataset)
	request.Reason = strings.TrimSpace(request.Reason)
	if request.Dataset == "" {
		return rowAccessMutationRequest{}, errRowAccessDataset
	}
	if utf8.RuneCountInString(request.Reason) > maxRowAccessReasonRunes {
		return rowAccessMutationRequest{}, fmt.Errorf("reason must contain at most %d characters", maxRowAccessReasonRunes)
	}

	rowIDs, err := normalizeRowAccessRowIDs(request.RowIDs)
	if err != nil {
		return rowAccessMutationRequest{}, err
	}
	request.RowIDs = rowIDs
	request.Principals, err = normalizeRowAccessPrincipals(request.Principals)
	if err != nil {
		return rowAccessMutationRequest{}, err
	}
	if err := validateRowAccessAssignmentSize(request.RowIDs, request.Principals); err != nil {
		return rowAccessMutationRequest{}, err
	}
	request.Changes, err = normalizeRowAccessChanges(request.Changes)
	if err != nil {
		return rowAccessMutationRequest{}, err
	}
	return request, nil
}

func normalizeRowAccessChanges(changes map[string]string) (map[string]string, error) {
	normalized := make(map[string]string, len(changes))
	for action, state := range changes {
		action = strings.TrimSpace(action)
		state = strings.TrimSpace(state)
		if action != "read" && action != "update" && action != "delete" {
			return nil, errRowAccessAction
		}
		switch state {
		case "no_change", "":
			continue
		case "allow", "deny", "remove":
			normalized[action] = state
		default:
			return nil, errRowAccessAction
		}
	}
	if len(normalized) == 0 {
		return nil, errors.New("at least one read, update, or delete change is required")
	}
	return normalized, nil
}

func parseRowAccessRowIDs(raw string) ([]int64, error) {
	parts := strings.Split(raw, ",")
	rowIDs := make([]int64, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		rowID, err := strconv.ParseInt(part, 10, 64)
		if err != nil {
			return nil, errors.New("row_ids must be comma-separated positive integers")
		}
		rowIDs = append(rowIDs, rowID)
	}
	return normalizeRowAccessRowIDs(rowIDs)
}

func normalizeRowAccessRowIDs(rowIDs []int64) ([]int64, error) {
	if len(rowIDs) == 0 || len(rowIDs) > maxRowAccessRows {
		return nil, fmt.Errorf("select between 1 and %d rows", maxRowAccessRows)
	}
	unique := make(map[int64]struct{}, len(rowIDs))
	normalized := make([]int64, 0, len(rowIDs))
	for _, rowID := range rowIDs {
		if rowID <= 0 {
			return nil, errors.New("row_ids must contain positive integers")
		}
		if _, exists := unique[rowID]; exists {
			continue
		}
		unique[rowID] = struct{}{}
		normalized = append(normalized, rowID)
	}
	if len(normalized) == 0 {
		return nil, errors.New("at least one row must be selected")
	}
	sort.Slice(normalized, func(i, j int) bool { return normalized[i] < normalized[j] })
	return normalized, nil
}

func parseRowAccessPrincipalRefs(raw string) ([]rowAccessPrincipalRef, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return make([]rowAccessPrincipalRef, 0), nil
	}
	parts := strings.Split(raw, ",")
	principals := make([]rowAccessPrincipalRef, 0, len(parts))
	for _, part := range parts {
		identityParts := strings.SplitN(strings.TrimSpace(part), ":", 2)
		if len(identityParts) != 2 {
			return nil, errRowAccessPrincipal
		}
		principalID, err := strconv.ParseInt(strings.TrimSpace(identityParts[1]), 10, 64)
		if err != nil {
			return nil, errRowAccessPrincipal
		}
		principals = append(principals, rowAccessPrincipalRef{
			Type: strings.TrimSpace(identityParts[0]),
			ID:   principalID,
		})
	}
	return normalizeRowAccessPrincipals(principals)
}

func normalizeRowAccessPrincipals(
	principals []rowAccessPrincipalRef,
) ([]rowAccessPrincipalRef, error) {
	if len(principals) == 0 || len(principals) > maxRowAccessPrincipals {
		return nil, fmt.Errorf(
			"%w: select between 1 and %d users or groups",
			errRowAccessBatch,
			maxRowAccessPrincipals,
		)
	}
	unique := make(map[string]struct{}, len(principals))
	normalized := make([]rowAccessPrincipalRef, 0, len(principals))
	for _, principal := range principals {
		principal.Type = strings.TrimSpace(principal.Type)
		if principal.ID <= 0 || (principal.Type != "user" && principal.Type != "group") {
			return nil, errRowAccessPrincipal
		}
		key := fmt.Sprintf("%s:%d", principal.Type, principal.ID)
		if _, exists := unique[key]; exists {
			continue
		}
		unique[key] = struct{}{}
		normalized = append(normalized, principal)
	}
	if len(normalized) == 0 {
		return nil, errRowAccessPrincipal
	}
	sort.Slice(normalized, func(i, j int) bool {
		if normalized[i].Type == normalized[j].Type {
			return normalized[i].ID < normalized[j].ID
		}
		return normalized[i].Type < normalized[j].Type
	})
	return normalized, nil
}

func validateRowAccessAssignmentSize(
	rowIDs []int64,
	principals []rowAccessPrincipalRef,
) error {
	if len(principals) == 0 {
		return nil
	}
	if len(rowIDs)*len(principals) > maxRowAccessAssignments {
		return fmt.Errorf(
			"%w: selected rows and users or groups may create at most %d permission targets",
			errRowAccessBatch,
			maxRowAccessAssignments,
		)
	}
	return nil
}

func resolveRowAccessTarget(ctx context.Context, tx *sql.Tx, dataset string) (rowAccessTarget, error) {
	tableName, err := security.SanitizeIdentifier(dataset)
	if err != nil || tableName == "" {
		return rowAccessTarget{}, errRowAccessDataset
	}
	target := rowAccessTarget{TableName: tableName}
	err = tx.QueryRowContext(ctx, `
		SELECT table_uid, COALESCE(NULLIF(schema_name, ''), 'public')
		FROM public.system_db_tables
		WHERE table_name = $1
		  AND COALESCE(NULLIF(schema_name, ''), 'public') = 'public'
		  AND table_uid IS NOT NULL
		ORDER BY table_uid
		LIMIT 1
	`, tableName).Scan(&target.TableUID, &target.SchemaName)
	if errors.Is(err, sql.ErrNoRows) {
		return rowAccessTarget{}, errRowAccessDataset
	}
	if err != nil {
		return rowAccessTarget{}, err
	}
	if _, err := security.SanitizeIdentifier(target.SchemaName); err != nil {
		return rowAccessTarget{}, errRowAccessDataset
	}
	return target, nil
}

func validateRowAccessRows(ctx context.Context, tx *sql.Tx, target rowAccessTarget, rowIDs []int64, lockRows bool) error {
	quotedTarget := pq.QuoteIdentifier(target.SchemaName) + "." + pq.QuoteIdentifier(target.TableName)
	query := fmt.Sprintf(
		"SELECT id FROM %s WHERE id = ANY($1) ORDER BY id",
		quotedTarget,
	)
	if lockRows {
		query += " FOR KEY SHARE"
	}
	rows, err := tx.QueryContext(ctx, query, pq.Array(rowIDs))
	if err != nil {
		return errRowAccessDataset
	}
	defer rows.Close()
	found := 0
	for rows.Next() {
		var rowID int64
		if err := rows.Scan(&rowID); err != nil {
			return err
		}
		found++
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if found != len(rowIDs) {
		return errRowAccessRows
	}
	return nil
}

func validateRowAccessPrincipal(ctx context.Context, tx *sql.Tx, principalType string, principalID int64) error {
	var exists bool
	var err error
	switch principalType {
	case "user":
		err = tx.QueryRowContext(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM public.system_users
				WHERE id = $1 AND COALESCE(enabled, FALSE) IS TRUE
			)
		`, principalID).Scan(&exists)
	case "group":
		err = tx.QueryRowContext(ctx, `
			SELECT EXISTS (SELECT 1 FROM public.system_user_groups WHERE id = $1)
		`, principalID).Scan(&exists)
	default:
		return errRowAccessPrincipal
	}
	if err != nil {
		return err
	}
	if !exists {
		return errRowAccessPrincipal
	}
	return nil
}

func validateRowAccessPrincipals(
	ctx context.Context,
	tx *sql.Tx,
	principals []rowAccessPrincipalRef,
) error {
	for _, principal := range principals {
		if err := validateRowAccessPrincipal(
			ctx,
			tx,
			principal.Type,
			principal.ID,
		); err != nil {
			return err
		}
	}
	return nil
}
