// related_dataset_authorization.go
// Authorizes related datasets, nested metadata and parent visibility.
// Connects related result assembly with its existing permission and row-policy boundaries.
// Keeps one implementation for each read responsibility and bounded source files.
package dtt_1_row_read

import (
	"easelect/backend/core_components/dbutils"
	dtt_utils "easelect/backend/core_components/dynamic_table_tools/dtt_utils"
	"easelect/backend/core_components/permissions"
	"fmt"
	"github.com/lib/pq"
	"sort"
	"strings"
)

// newRelatedDatasetPermissionChecker caches canonical route/table decisions for one request actor.
// It exists between discovered FK targets and the permissions model so unauthorized relation names never reach the response.
func newRelatedDatasetPermissionChecker(queryer dbutils.Querier, userID int) relatedDatasetPermissionChecker {
	permissionByTable := make(map[string]bool)
	return func(tableName string) (bool, error) {
		tableName = strings.TrimSpace(tableName)
		if tableName == "" || userID <= 0 {
			return false, nil
		}
		if allowed, found := permissionByTable[tableName]; found {
			return allowed, nil
		}

		allowed, err := permissions.CheckRouteTablePermission(
			queryer,
			dynamicRelatedItemsRoute,
			userID,
			permissions.RouteTableScope{TableName: tableName},
			permissions.AccessControlRouteTableOptions(false),
		)
		if err != nil {
			return false, err
		}
		permissionByTable[tableName] = allowed
		return allowed, nil
	}
}

// filterAuthorizedIncomingForeignKeys keeps only requested reverse-FK targets the actor may read through this route.
// It exists so relation kind metadata, counts, rows, and even dataset names remain hidden when dataset access is missing.
func filterAuthorizedIncomingForeignKeys(
	foreignKeys []FKInfo,
	childTableFilter string,
	canReadDataset relatedDatasetPermissionChecker,
) ([]FKInfo, error) {
	filtered := make([]FKInfo, 0, len(foreignKeys))
	for _, foreignKey := range foreignKeys {
		if childTableFilter != "" && foreignKey.Referencing_table != childTableFilter {
			continue
		}
		allowed, err := canReadDataset(foreignKey.Referencing_table)
		if err != nil {
			return nil, err
		}
		if allowed {
			filtered = append(filtered, foreignKey)
		}
	}
	return filtered, nil
}

// filterAuthorizedOutgoingForeignKeys applies the optional target filter and dataset authorization before parent values are read.
// It exists so a denied outgoing target cannot be used to probe a parent FK value or referenced row.
func filterAuthorizedOutgoingForeignKeys(
	foreignKeys map[string]dtt_utils.ForeignKey,
	childTableFilter string,
	canReadDataset relatedDatasetPermissionChecker,
) (map[string]dtt_utils.ForeignKey, error) {
	filtered := make(map[string]dtt_utils.ForeignKey, len(foreignKeys))
	childTableFilter = strings.TrimSpace(childTableFilter)
	for _, parentColumn := range sortedForeignKeyColumns(foreignKeys) {
		foreignKey := foreignKeys[parentColumn]
		if childTableFilter != "" && foreignKey.ReferencedTable != childTableFilter {
			continue
		}
		allowed, err := canReadDataset(foreignKey.ReferencedTable)
		if err != nil {
			return nil, err
		}
		if allowed {
			filtered[parentColumn] = foreignKey
		}
	}
	return filtered, nil
}

// authorizeRelatedNestedMetadata removes unauthorized nested FK targets from both label joins and type metadata.
// Authorized metadata remains useful to the frontend, but non-admin label joins are omitted when the referenced
// table has row-level visibility rules because a plain LEFT JOIN cannot safely reproduce those rules.
func authorizeRelatedNestedMetadata(
	foreignKeys map[string]dtt_utils.ForeignKey,
	dataTypes map[string]interface{},
	userRole string,
	canReadDataset relatedDatasetPermissionChecker,
	loadReadPolicy relatedReadPolicyLoader,
) (map[string]dtt_utils.ForeignKey, map[string]interface{}, error) {
	sanitizedTypes := cloneRelatedDataTypes(dataTypes)
	allowedByTable := make(map[string]bool)
	checkDataset := func(tableName string) (bool, error) {
		tableName = strings.TrimSpace(tableName)
		if allowed, found := allowedByTable[tableName]; found {
			return allowed, nil
		}
		allowed, err := canReadDataset(tableName)
		if err != nil {
			return false, err
		}
		allowedByTable[tableName] = allowed
		return allowed, nil
	}

	// Type metadata is sourced independently from dtt_utils.ForeignKey. Authorize it independently too so
	// a partially resolved FK cannot retain foreign_table/foreign_column details by accident.
	typeColumns := make([]string, 0, len(sanitizedTypes))
	for columnName := range sanitizedTypes {
		typeColumns = append(typeColumns, columnName)
	}
	sort.Strings(typeColumns)
	for _, columnName := range typeColumns {
		columnInfo, ok := sanitizedTypes[columnName].(map[string]interface{})
		if !ok {
			continue
		}
		referencedTable, _ := columnInfo["foreign_table"].(string)
		if strings.TrimSpace(referencedTable) == "" {
			continue
		}
		allowed, err := checkDataset(referencedTable)
		if err != nil {
			return nil, nil, err
		}
		if !allowed {
			delete(columnInfo, "foreign_table")
			delete(columnInfo, "foreign_column")
		}
	}

	labelForeignKeys := make(map[string]dtt_utils.ForeignKey, len(foreignKeys))
	policyByTable := make(map[string]ReadRowPolicy)
	policyLoadFailed := make(map[string]bool)
	for _, columnName := range sortedForeignKeyColumns(foreignKeys) {
		foreignKey := foreignKeys[columnName]
		allowed, err := checkDataset(foreignKey.ReferencedTable)
		if err != nil {
			return nil, nil, err
		}
		if !allowed {
			if columnInfo, ok := sanitizedTypes[columnName].(map[string]interface{}); ok {
				delete(columnInfo, "foreign_table")
				delete(columnInfo, "foreign_column")
			}
			continue
		}

		if userRole == "admin" {
			labelForeignKeys[columnName] = foreignKey
			continue
		}
		if foreignKey.ReferencedTable == rlsPilotTableName {
			continue
		}

		policy, found := policyByTable[foreignKey.ReferencedTable]
		if !found && !policyLoadFailed[foreignKey.ReferencedTable] {
			policy, err = loadReadPolicy(foreignKey.ReferencedTable)
			if err != nil {
				// Policy lookup uncertainty must not turn into an unguarded label join.
				policyLoadFailed[foreignKey.ReferencedTable] = true
				continue
			}
			policyByTable[foreignKey.ReferencedTable] = policy
		}
		if policyLoadFailed[foreignKey.ReferencedTable] || shouldApplyReadRowPolicy(foreignKey.ReferencedTable, userRole, policy) {
			continue
		}
		labelForeignKeys[columnName] = foreignKey
	}

	return labelForeignKeys, sanitizedTypes, nil
}

func cloneRelatedDataTypes(dataTypes map[string]interface{}) map[string]interface{} {
	cloned := make(map[string]interface{}, len(dataTypes))
	for columnName, rawColumnInfo := range dataTypes {
		columnInfo, ok := rawColumnInfo.(map[string]interface{})
		if !ok {
			cloned[columnName] = rawColumnInfo
			continue
		}
		clonedColumnInfo := make(map[string]interface{}, len(columnInfo))
		for key, value := range columnInfo {
			clonedColumnInfo[key] = value
		}
		cloned[columnName] = clonedColumnInfo
	}
	return cloned
}

func buildRelatedMetadataCandidates(
	foreignKeys []FKInfo,
	relationKindByChildTable map[string]string,
) []RelatedTableResult {
	results := make([]RelatedTableResult, 0, len(foreignKeys))
	for _, foreignKey := range foreignKeys {
		results = append(results, RelatedTableResult{
			Table_name:         foreignKey.Referencing_table,
			Column_name:        foreignKey.Referencing_column,
			RelationKind:       classifyRelatedTableKind(foreignKey.Referencing_table, relationKindByChildTable),
			ReferenceDirection: relatedReferenceDirectionIncoming,
			Rows:               []map[string]interface{}{},
		})
	}
	return results
}

// isRelatedParentRowVisible checks parent existence through the same Go read policy or pilot RLS path as normal reads.
// It exists so hidden or missing parents cannot be used to enumerate relationship metadata or child rows.
func isRelatedParentRowVisible(
	querier dbutils.Querier,
	tableName string,
	parentID int,
	userRole string,
	userID int,
	readPolicy ReadRowPolicy,
) (bool, error) {
	whereClause := fmt.Sprintf(
		" WHERE %s.%s = $1",
		pq.QuoteIdentifier(tableName),
		pq.QuoteIdentifier("id"),
	)
	queryArgs := []interface{}{parentID}
	whereClause, queryArgs = appendReadPolicyToWhereClause(
		tableName,
		userRole,
		userID,
		readPolicy,
		whereClause,
		queryArgs,
	)
	query := fmt.Sprintf(
		"SELECT EXISTS (SELECT 1 FROM %s%s)",
		pq.QuoteIdentifier(tableName),
		whereClause,
	)

	var visible bool
	if err := querier.QueryRow(query, queryArgs...).Scan(&visible); err != nil {
		return false, err
	}
	return visible, nil
}
