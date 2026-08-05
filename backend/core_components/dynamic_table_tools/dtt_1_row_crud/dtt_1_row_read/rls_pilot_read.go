// rls_pilot_read.go
// Selects the request-scoped querier for the first RLS substrate pilot.
// Bridges the standard role-based DB pool and the lazy transaction context without changing global read routing yet.
// Exists so app_service_catalog can prove tx-scoped actor wiring before wider RLS rollout.
package dtt_1_row_read

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"easelect/backend/core_components/dbutils"
	"github.com/lib/pq"
)

const rlsPilotTableName = "app_service_catalog"
const rowPolicyAllFlagsTrueUnlessOwner = "all_flags_true_unless_owner"

// ReadRowPolicy describes one metadata-driven read visibility rule between row fetchers and SQL predicates.
// It exists so legacy must_be_true_unless_own behavior can migrate toward named row policies without changing reads.
type ReadRowPolicy struct {
	Name                         string
	FlagColumns                  []string
	OwnerColumn                  string
	OwnerColumnSource            string
	ShadowLegacyOwnerColumn      string
	OwnerColumnMatchesLegacyPath bool
}

// hasFlagColumns reports whether a policy has flag columns that can constrain row visibility.
// It exists between metadata loading and predicate building so empty policies stay cheap no-ops.
func (policy ReadRowPolicy) hasFlagColumns() bool {
	return len(policy.FlagColumns) > 0
}

// legacyMustTrueReadPolicy wraps old must_be_true_unless_own metadata in the generic policy shape.
// It exists as the compatibility bridge while metadata still lives on system_column_details.
func legacyMustTrueReadPolicy(mustTrueCols []string, ownerColumn string) ReadRowPolicy {
	if len(mustTrueCols) == 0 {
		return ReadRowPolicy{}
	}
	return ReadRowPolicy{
		Name:        rowPolicyAllFlagsTrueUnlessOwner,
		FlagColumns: append([]string(nil), mustTrueCols...),
		OwnerColumn: ownerColumn,
	}
}

// getPilotReadQuerier routes the pilot dataset through the request transaction and keeps all others unchanged.
func getPilotReadQuerier(ctx context.Context, tableName string, fallback *sql.DB) (dbutils.Querier, error) {
	if tableName != rlsPilotTableName {
		return fallback, nil
	}

	tx, err := dbutils.RequireTxWithError(ctx)
	if err != nil {
		return nil, fmt.Errorf("pilot read transaction unavailable: %w", err)
	}
	return tx, nil
}

// shouldApplyLegacyReadMustTrueFilter returns whether the old Go-side row-visibility
// filter should still be layered on top of reads. The first RLS pilot intentionally
// disables the legacy SQL fragment for app_service_catalog so SELECT visibility comes
// from the database policy rather than duplicated WHERE clauses.
func shouldApplyLegacyReadMustTrueFilter(tableName, userRole string, mustTrueCols []string) bool {
	return shouldApplyReadRowPolicy(tableName, userRole, legacyMustTrueReadPolicy(mustTrueCols, ""))
}

// shouldApplyReadRowPolicy returns whether a named Go-side read policy should constrain a query.
// It exists between policy metadata and SQL builders; RLS-pilot tables intentionally rely on database policies.
func shouldApplyReadRowPolicy(tableName, userRole string, policy ReadRowPolicy) bool {
	if userRole == "admin" || !policy.hasFlagColumns() {
		return false
	}
	return tableName != rlsPilotTableName
}

// buildLegacyReadMustTrueCondition constructs the old must_be_true_unless_own SQL
// fragment for non-admin reads. argStart is the 1-based placeholder index to use
// if an owner fallback parameter needs to be appended.
func buildLegacyReadMustTrueCondition(tableName, userRole string, userID int, mustTrueCols []string, ownerColumn string, argStart int) (string, []interface{}) {
	return buildReadRowPolicyCondition(tableName, userRole, userID, legacyMustTrueReadPolicy(mustTrueCols, ownerColumn), argStart)
}

// buildReadRowPolicyCondition constructs the SQL fragment for the active read-row policy.
// It exists so normal reads, counts, and intelligent-result hydration share one policy predicate builder.
func buildReadRowPolicyCondition(tableName, userRole string, userID int, policy ReadRowPolicy, argStart int) (string, []interface{}) {
	if policy.Name != rowPolicyAllFlagsTrueUnlessOwner || !shouldApplyReadRowPolicy(tableName, userRole, policy) {
		return "", nil
	}

	quotedTable := pq.QuoteIdentifier(tableName)
	args := make([]interface{}, 0, 1)
	ownerArgRef := ""

	// user_id=1 is the guest session user — no owner exception for anonymous visitors
	if policy.OwnerColumn != "" && userID > 1 {
		args = append(args, userID)
		ownerArgRef = fmt.Sprintf("$%d", argStart)
	}

	var cond []string
	for _, col := range policy.FlagColumns {
		extraCond := fmt.Sprintf("%s.%s = TRUE", quotedTable, pq.QuoteIdentifier(col))
		if ownerArgRef != "" {
			extraCond = fmt.Sprintf(
				"(%s.%s = TRUE OR %s.%s = %s)",
				quotedTable,
				pq.QuoteIdentifier(col),
				quotedTable,
				pq.QuoteIdentifier(policy.OwnerColumn),
				ownerArgRef,
			)
		}
		cond = append(cond, extraCond)
	}

	return strings.Join(cond, " AND "), args
}

// appendReadPolicyToWhereClause adds the active read policy to an existing WHERE clause and argument list.
// It exists so vector, filter-option, child-row, and normal read paths share placeholder handling.
func appendReadPolicyToWhereClause(tableName, userRole string, userID int, policy ReadRowPolicy, whereClause string, args []interface{}) (string, []interface{}) {
	readPolicyCond, readPolicyArgs := buildReadRowPolicyCondition(
		tableName,
		userRole,
		userID,
		policy,
		len(args)+1,
	)
	if readPolicyCond == "" {
		return whereClause, args
	}

	args = append(args, readPolicyArgs...)
	if strings.TrimSpace(whereClause) == "" {
		return " WHERE " + readPolicyCond, args
	}
	return whereClause + " AND " + readPolicyCond, args
}

// AppendMutationRowPolicyToWhereClause adds the row-eligibility predicate used
// by generic update/delete paths. Non-pilot datasets reuse the legacy read
// policy as their compatibility gate. The pilot uses its narrower
// admin-or-owner write rule instead of its public SELECT policy.
func AppendMutationRowPolicyToWhereClause(
	q dbutils.Querier,
	tableName string,
	userRole string,
	userID int,
	whereClause string,
	args []interface{},
) (string, []interface{}, error) {
	quotedTable := pq.QuoteIdentifier(tableName)
	switch {
	case tableName == rlsPilotTableName && userRole != "admin":
		if userID <= 1 {
			if strings.TrimSpace(whereClause) == "" {
				return " WHERE FALSE", args, nil
			}
			return whereClause + " AND FALSE", args, nil
		}
		args = append(args, userID)
		ownerCondition := fmt.Sprintf(
			"%s.%s = $%d",
			quotedTable,
			pq.QuoteIdentifier("user_id"),
			len(args),
		)
		if strings.TrimSpace(whereClause) == "" {
			return " WHERE " + ownerCondition, args, nil
		}
		return whereClause + " AND " + ownerCondition, args, nil
	case tableName != rlsPilotTableName && userRole != "admin":
		policy, err := getLegacyMustTrueReadPolicy(q, tableName)
		if err != nil {
			return whereClause, args, fmt.Errorf("load mutation row policy for %s: %w", tableName, err)
		}
		whereClause, args = appendReadPolicyToWhereClause(
			tableName,
			userRole,
			userID,
			policy,
			whereClause,
			args,
		)
	}
	return whereClause, args, nil
}

// LockRowsVisibleForMutation verifies that every requested row is writable by
// the current actor and locks those rows for the rest of the transaction. It is
// used by UPDATE, whose route already requires UPDATE privileges.
func LockRowsVisibleForMutation(q *sql.Tx, tableName, userRole string, userID int, rowIDs []int64) (bool, error) {
	return rowsVisibleForMutation(q, tableName, userRole, userID, rowIDs, true)
}

// RowsVisibleForDelete verifies the complete delete target set without taking
// an UPDATE-strength row lock. The DELETE statement must repeat the same
// predicate and use exact-count rollback so delete-only principals remain
// supported without reopening a TOCTOU bypass.
func RowsVisibleForDelete(q *sql.Tx, tableName, userRole string, userID int, rowIDs []int64) (bool, error) {
	return rowsVisibleForMutation(q, tableName, userRole, userID, rowIDs, false)
}

func rowsVisibleForMutation(q *sql.Tx, tableName, userRole string, userID int, rowIDs []int64, lockRows bool) (bool, error) {
	uniqueRowIDs := make([]int64, 0, len(rowIDs))
	requested := make(map[int64]struct{}, len(rowIDs))
	for _, rowID := range rowIDs {
		if _, found := requested[rowID]; found {
			continue
		}
		requested[rowID] = struct{}{}
		uniqueRowIDs = append(uniqueRowIDs, rowID)
	}
	if len(uniqueRowIDs) == 0 {
		return false, nil
	}

	quotedTable := pq.QuoteIdentifier(tableName)
	whereClause := fmt.Sprintf(
		" WHERE %s.%s = ANY($1)",
		quotedTable,
		pq.QuoteIdentifier("id"),
	)
	args := []interface{}{pq.Array(uniqueRowIDs)}
	if tableName == rlsPilotTableName && userRole != "admin" && userID <= 1 {
		return false, nil
	}
	var err error
	whereClause, args, err = AppendMutationRowPolicyToWhereClause(
		q,
		tableName,
		userRole,
		userID,
		whereClause,
		args,
	)
	if err != nil {
		return false, err
	}

	query := fmt.Sprintf(
		"SELECT %s.%s FROM %s%s ORDER BY %s.%s",
		quotedTable,
		pq.QuoteIdentifier("id"),
		quotedTable,
		whereClause,
		quotedTable,
		pq.QuoteIdentifier("id"),
	)
	if lockRows {
		query += " FOR UPDATE"
	}
	rows, err := q.Query(query, args...)
	if err != nil {
		return false, fmt.Errorf("check mutation rows for %s: %w", tableName, err)
	}
	defer rows.Close()

	visible := make(map[int64]struct{}, len(uniqueRowIDs))
	for rows.Next() {
		var rowID int64
		if err := rows.Scan(&rowID); err != nil {
			return false, fmt.Errorf("scan mutation row for %s: %w", tableName, err)
		}
		if _, requestedRow := requested[rowID]; requestedRow {
			visible[rowID] = struct{}{}
		}
	}
	if err := rows.Err(); err != nil {
		return false, fmt.Errorf("iterate mutation rows for %s: %w", tableName, err)
	}

	return len(visible) == len(uniqueRowIDs), nil
}

// getLegacyMustTrueReadFilter returns legacy must_be_true_unless_own metadata only where it still applies.
func getLegacyMustTrueReadFilter(db *sql.DB, tableName string) ([]string, string, error) {
	policy, err := getLegacyMustTrueReadPolicy(db, tableName)
	if err != nil {
		return nil, "", err
	}
	return append([]string(nil), policy.FlagColumns...), policy.OwnerColumn, nil
}

// getLegacyMustTrueReadPolicy returns the legacy row-visibility metadata as a named read policy.
// It exists so callers can stop passing raw mustTrue column slices while the database metadata migrates later.
func getLegacyMustTrueReadPolicy(db dbutils.Querier, tableName string) (ReadRowPolicy, error) {
	if tableName == rlsPilotTableName {
		return ReadRowPolicy{}, nil
	}
	cols, ownerResolution, err := getMustBeTrueColumnsWithOwnerResolution(db, tableName)
	if err != nil {
		return ReadRowPolicy{}, err
	}
	policy := legacyMustTrueReadPolicy(cols, ownerResolution.Column)
	policy.OwnerColumnSource = ownerResolution.Source
	policy.ShadowLegacyOwnerColumn = ownerResolution.LegacyFallbackColumn
	policy.OwnerColumnMatchesLegacyPath = ownerResolution.MatchesLegacyFallback
	return policy, nil
}
