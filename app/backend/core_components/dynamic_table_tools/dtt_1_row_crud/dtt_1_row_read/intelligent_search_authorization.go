// intelligent_search_authorization.go
// Defines the authorization scope shared by blocking and streamed intelligent search.
// Bridges legacy row policy, RLS-backed reads, registered dataset identity, and row-group membership.
// Exists so candidate ranking and final hydration enforce the same row universe before and after LIMIT.
package dtt_1_row_read

import (
	"fmt"
	"strconv"
	"strings"

	"easelect/backend/core_components/dbutils"
	"github.com/lib/pq"
)

type intelligentSearchAuthorization struct {
	userRole     string
	userID       int
	readPolicy   ReadRowPolicy
	tableUID     int64
	rowGroupSlug string
}

func resolveIntelligentSearchAuthorization(
	metadataDB dbutils.Querier,
	tableName string,
	userRole string,
	userID int,
	rawRowGroupSlug string,
) (intelligentSearchAuthorization, error) {
	slug, err := normalizeRowGroupFilterSlug(rawRowGroupSlug)
	if err != nil {
		return intelligentSearchAuthorization{}, err
	}

	readPolicy, err := getLegacyMustTrueReadPolicy(metadataDB, tableName)
	if err != nil {
		return intelligentSearchAuthorization{}, fmt.Errorf("row policy metadata fetch: %w", err)
	}

	authorization := intelligentSearchAuthorization{
		userRole:     userRole,
		userID:       userID,
		readPolicy:   readPolicy,
		rowGroupSlug: slug,
	}
	if slug == "" {
		return authorization, nil
	}

	tableUIDText, err := getTableUID(tableName, metadataDB)
	if err != nil {
		return intelligentSearchAuthorization{}, fmt.Errorf("resolve registered dataset identity: %w", err)
	}
	tableUID, err := strconv.ParseInt(tableUIDText, 10, 64)
	if err != nil || tableUID <= 0 {
		return intelligentSearchAuthorization{}, fmt.Errorf("invalid registered dataset identity %q", tableUIDText)
	}
	authorization.tableUID = tableUID
	return authorization, nil
}

// appendIntelligentSearchAuthorizationCondition appends row authorization to
// an existing argument list and returns a condition without a WHERE/AND prefix.
// Callers place it inside their candidate query before ORDER BY and LIMIT, and
// final hydration repeats it to close membership-change races.
func appendIntelligentSearchAuthorizationCondition(
	tableName string,
	tableReference string,
	authorization intelligentSearchAuthorization,
	queryArgs []interface{},
) (string, []interface{}, error) {
	conditions := make([]string, 0, 2)
	readPolicyCondition, readPolicyArgs := buildReadRowPolicyConditionForReference(
		tableName,
		tableReference,
		authorization.userRole,
		authorization.userID,
		authorization.readPolicy,
		len(queryArgs)+1,
	)
	if readPolicyCondition != "" {
		conditions = append(conditions, readPolicyCondition)
		queryArgs = append(queryArgs, readPolicyArgs...)
	}

	if authorization.rowGroupSlug != "" {
		if authorization.tableUID <= 0 {
			return "", nil, fmt.Errorf("row_group search filter requires a registered dataset")
		}
		tableUIDPlaceholder := len(queryArgs) + 1
		slugPlaceholder := tableUIDPlaceholder + 1
		conditions = append(conditions, fmt.Sprintf(`EXISTS (
			SELECT 1
			FROM public.system_row_group_memberships AS search_row_group_membership
			JOIN public.system_row_groups AS search_row_group
			  ON search_row_group.id = search_row_group_membership.group_id
			 AND search_row_group.enabled = TRUE
			WHERE search_row_group_membership.table_uid = $%d
			  AND search_row_group_membership.row_id = %s.%s
			  AND search_row_group.slug = $%d
		)`,
			tableUIDPlaceholder,
			pq.QuoteIdentifier(tableReference),
			pq.QuoteIdentifier("id"),
			slugPlaceholder,
		))
		queryArgs = append(queryArgs, authorization.tableUID, authorization.rowGroupSlug)
	}

	return strings.Join(conditions, " AND "), queryArgs, nil
}
