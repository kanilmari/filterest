// intelligent_search_authorization.go
// Defines the authorization scope shared by blocking and streamed intelligent search.
// Bridges legacy row policy, RLS-backed reads, registered dataset identity, and row-group membership.
// Exists so candidate ranking and final hydration enforce the same row universe before and after LIMIT.
package dtt_1_row_read

import (
	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"easelect/backend/core_components/dbutils"
)

type intelligentSearchAuthorization struct {
	userRole          string
	userID            int
	readPolicy        ReadRowPolicy
	tableUID          int64
	rowGroupSelection RowGroupSelection
	userFilters       url.Values
	filterColumns     map[string]dtt_models.ColumnInfo
	filterTypes       map[string]interface{}
}

func resolveIntelligentSearchAuthorization(
	metadataDB dbutils.Querier,
	readDB dbutils.Querier,
	tableName string,
	userRole string,
	userID int,
	categoryParams url.Values,
) (intelligentSearchAuthorization, error) {
	selection, err := parseRowGroupFilters(categoryParams)
	if err != nil {
		return intelligentSearchAuthorization{}, err
	}

	readPolicy, err := getLegacyMustTrueReadPolicy(metadataDB, tableName)
	if err != nil {
		return intelligentSearchAuthorization{}, fmt.Errorf("row policy metadata fetch: %w", err)
	}

	authorization := intelligentSearchAuthorization{
		userRole:   userRole,
		userID:     userID,
		readPolicy: readPolicy,
	}
	if len(selection.Slugs) == 0 && len(selection.Modes) == 0 {
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
	authorization.rowGroupSelection, err = resolveRowGroupSelection(readDB, tableName, tableUID, selection, userRole, userID, readPolicy)
	if err != nil {
		return intelligentSearchAuthorization{}, err
	}
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

	selectionCondition, args, err := rowGroupSelectionCondition(tableReference, authorization.tableUID, authorization.rowGroupSelection, queryArgs)
	if err != nil {
		return "", nil, err
	}
	if selectionCondition != "" {
		conditions = append(conditions, selectionCondition)
		queryArgs = args
	}

	if len(authorization.userFilters) > 0 {
		// These keys already passed column/SELECT validation. Qualify fields
		// before the mixed URL-query builder so view_key cannot become a
		// renderer control; lang remains the prepared localization parameter.
		qualifiedFilters := url.Values{}
		for key, values := range authorization.userFilters {
			qualifiedKey := key
			if key != "lang" {
				qualifiedKey = tableReference + "_" + key
			}
			qualifiedFilters[qualifiedKey] = append([]string(nil), values...)
		}
		clause, filterArgs, err := buildWhereClause(qualifiedFilters, tableReference, authorization.filterColumns, nil, authorization.filterTypes, len(queryArgs))
		if err != nil {
			return "", nil, err
		}
		clause = strings.TrimSpace(strings.TrimPrefix(clause, " WHERE "))
		if clause != "" {
			conditions = append(conditions, "("+clause+")")
			queryArgs = append(queryArgs, filterArgs...)
		}
	}

	return strings.Join(conditions, " AND "), queryArgs, nil
}
