// get_child_items.go
// Retrieves rows from tables that refer to a parent record via foreign key constraints.
// Bridges FK metadata, referring tables, and the reverse-FK tab display in the frontend.
// Exists to dynamically discover and fetch referring rows filtered by the parent primary key.

package dtt_1_row_read

import (
	"database/sql"
	backend "easelect/backend/core_components"
	auth "easelect/backend/core_components/auth"
	"easelect/backend/core_components/dbutils"
	dtt_utils "easelect/backend/core_components/dynamic_table_tools/dtt_utils"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/permissions"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/lib/pq"
)

const (
	dynamicRelatedItemsRoute = "/api/fetch-dynamic-children"

	relatedTableKindRows        = "related_rows"
	relatedTableKindImageAsset  = "image_asset"
	relatedTableKindSharedAsset = "shared_asset"

	relatedReferenceDirectionIncoming = "incoming"
	relatedReferenceDirectionOutgoing = "outgoing"
)

var relatedRecordSummaryAuditColumns = []string{"created", "updated"}

type FKInfo struct {
	Constraint_name    string
	Referencing_table  string
	Referencing_column string
	Referenced_table   string
	Referenced_column  string
}

type RelatedTableResult struct {
	Table_name         string                   `json:"dataset"`
	Column_name        string                   `json:"column"`
	RelationKind       string                   `json:"relation_kind,omitempty"`
	ReferenceDirection string                   `json:"reference_direction,omitempty"`
	FilterValue        int                      `json:"filter_value,omitempty"`
	RowCount           int                      `json:"row_count,omitempty"`
	Types              map[string]interface{}   `json:"types,omitempty"`
	Rows               []map[string]interface{} `json:"rows"`
}

type relatedDatasetPermissionChecker func(tableName string) (bool, error)
type relatedReadPolicyLoader func(tableName string) (ReadRowPolicy, error)

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

// GetDynamicRelatedItemsHandler etsii ne referencing_table/column -parit,
// joilla referenced_table = parent_table, ja hakee viittaavat rivit,
// joissa referencing_column = parent_pk_value.
func GetDynamicRelatedItemsHandler(response_writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		httpresponse.RespondWithError(response_writer, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	// Luetaan body
	var body_data struct {
		Parent_table    string `json:"parent_dataset"`
		Parent_pk_value string `json:"parent_pk_value"`
		Child_table     string `json:"child_table,omitempty"`
		Metadata_only   bool   `json:"metadata_only,omitempty"`
	}
	if err := json.NewDecoder(request.Body).Decode(&body_data); err != nil {
		log.Printf("\033[31merror: dynamic related search, decoding failed: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusBadRequest, "error decoding data")
		return
	}

	routeDataset := strings.TrimSpace(request.URL.Query().Get("dataset"))
	body_data.Parent_table = strings.TrimSpace(body_data.Parent_table)
	body_data.Child_table = strings.TrimSpace(body_data.Child_table)
	if routeDataset == "" {
		httpresponse.RespondWithError(response_writer, http.StatusBadRequest, "dataset is missing")
		return
	}
	if body_data.Parent_table == "" {
		httpresponse.RespondWithError(response_writer, http.StatusBadRequest, "parent_table is missing")
		return
	}
	if routeDataset != body_data.Parent_table {
		httpresponse.RespondWithError(response_writer, http.StatusBadRequest, "parent_dataset must match dataset query parameter")
		return
	}

	actor := dbutils.RequestActorContextFromRequest(request)
	userRole := actor.UserRole
	userID := actor.UserID
	if body_data.Metadata_only && !actor.IsAdmin {
		httpresponse.RespondWithError(response_writer, http.StatusForbidden, "metadata_only requires admin access")
		return
	}

	parent_id := 0
	if !body_data.Metadata_only {
		if body_data.Parent_pk_value == "" {
			httpresponse.RespondWithError(response_writer, http.StatusBadRequest, "parent_pk_value is missing")
			return
		}
		var err error
		parent_id, err = strconv.Atoi(body_data.Parent_pk_value)
		if err != nil {
			log.Printf("\033[31merror: parent_pk_value is not an int: %s\033[0m\n", err.Error())
			httpresponse.RespondWithError(response_writer, http.StatusBadRequest, "parent_pk_value was not an int")
			return
		}
	}

	log.Printf("dynamic related search: table=%s, pk_value=%s metadata_only=%t", body_data.Parent_table, body_data.Parent_pk_value, body_data.Metadata_only)

	currentDb := auth.GetDBForRole(userRole)
	var parentReadPolicy ReadRowPolicy
	if !body_data.Metadata_only {
		var policyErr error
		parentReadPolicy, policyErr = getLegacyMustTrueReadPolicy(currentDb, body_data.Parent_table)
		if policyErr != nil {
			log.Printf("\033[31merror: fetching parent row policy metadata for %s: %s\033[0m\n", body_data.Parent_table, policyErr.Error())
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error checking parent row visibility")
			return
		}
		parentReadQuerier, setupErr := getPilotReadQuerier(request.Context(), body_data.Parent_table, currentDb)
		if setupErr != nil {
			log.Printf("\033[31merror: parent row read setup failed for %s: %s\033[0m\n", body_data.Parent_table, setupErr.Error())
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error initializing parent row visibility check")
			return
		}
		parentVisible, visibilityErr := isRelatedParentRowVisible(
			parentReadQuerier,
			body_data.Parent_table,
			parent_id,
			userRole,
			userID,
			parentReadPolicy,
		)
		if visibilityErr != nil {
			log.Printf("\033[31merror: parent row visibility check failed for %s: %s\033[0m\n", body_data.Parent_table, visibilityErr.Error())
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error checking parent row visibility")
			return
		}
		if !parentVisible {
			httpresponse.RespondWithError(response_writer, http.StatusNotFound, "parent row not found")
			return
		}
	}

	canReadRelatedDataset := newRelatedDatasetPermissionChecker(backend.Db, userID)

	// Kysely, jolla haetaan ne foreign key -rivit, joissa ccu.table_name = haluttu taulu
	query_fk := `
        SELECT
            tc.constraint_name,
            tc.table_name AS referencing_table,
            kcu.column_name AS referencing_column,
            ccu.table_name AS referenced_table,
            ccu.column_name AS referenced_column
        FROM
            information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
                ON tc.constraint_name = kcu.constraint_name
                AND tc.constraint_schema = kcu.constraint_schema
            JOIN information_schema.constraint_column_usage AS ccu
                ON ccu.constraint_name = tc.constraint_name
                AND ccu.constraint_schema = tc.constraint_schema
        WHERE
            tc.constraint_type = 'FOREIGN KEY'
            AND ccu.table_name = $1
    `

	rows_fk, err := backend.Db.Query(query_fk, body_data.Parent_table)
	if err != nil {
		log.Printf("\033[31merror: foreign key search failed: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error fetching foreign keys")
		return
	}
	defer rows_fk.Close()

	var fk_infos []FKInfo
	for rows_fk.Next() {
		var f FKInfo
		if err := rows_fk.Scan(&f.Constraint_name, &f.Referencing_table, &f.Referencing_column,
			&f.Referenced_table, &f.Referenced_column); err != nil {
			log.Printf("\033[31merror: foreign key scan: %s\033[0m\n", err.Error())
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error in foreign key data")
			return
		}
		fk_infos = append(fk_infos, f)
	}
	if err := rows_fk.Err(); err != nil {
		log.Printf("\033[31merror: foreign key rows iteration: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error fetching foreign keys")
		return
	}
	fk_infos, err = filterAuthorizedIncomingForeignKeys(fk_infos, body_data.Child_table, canReadRelatedDataset)
	if err != nil {
		log.Printf("\033[31merror: related dataset permission check failed: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error authorizing related datasets")
		return
	}

	relationKindByChildTable, err := buildRelatedTableKindMap(currentDb, body_data.Parent_table)
	if err != nil {
		log.Printf("\033[33mwarning: related table kind metadata lookup failed for %s: %s\033[0m\n", body_data.Parent_table, err.Error())
		relationKindByChildTable = map[string]string{}
	}
	if body_data.Metadata_only {
		response_writer.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(response_writer).Encode(map[string]interface{}{
			"child_tables": buildRelatedMetadataCandidates(fk_infos, relationKindByChildTable),
		}); err != nil {
			log.Printf("\033[31merror: encoding related metadata response: %s\033[0m\n", err.Error())
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error encoding child response")
		}
		return
	}
	regularRelatedTableCount := countRegularRelatedTableEntries(
		fk_infos,
		relationKindByChildTable,
		body_data.Child_table,
	)

	var relatedTablesList []RelatedTableResult

	for _, fk_row := range fk_infos {
		// Optional child_table filter for lazy-loading a single tab
		if body_data.Child_table != "" && fk_row.Referencing_table != body_data.Child_table {
			continue
		}

		relationKind := classifyRelatedTableKind(fk_row.Referencing_table, relationKindByChildTable)
		relatedTypes, err := getColumnDataTypesWithFK(fk_row.Referencing_table, currentDb)
		if err != nil {
			log.Printf("\033[33mwarning: related items type metadata lookup failed for %s: %s\033[0m\n", fk_row.Referencing_table, err.Error())
			relatedTypes = map[string]interface{}{}
		} else {
			relatedTypes = enrichServiceCatalogModerationDataTypes(fk_row.Referencing_table, relatedTypes)
		}
		foreignKeys, err := dtt_utils.GetForeignKeysForTable(fk_row.Referencing_table)
		if err != nil {
			log.Printf("\033[33mwarning: related label metadata unavailable for table %s: %s\033[0m\n", fk_row.Referencing_table, err.Error())
			foreignKeys = map[string]dtt_utils.ForeignKey{}
		}
		labelForeignKeys, relatedTypes, err := authorizeRelatedNestedMetadata(
			foreignKeys,
			relatedTypes,
			userRole,
			canReadRelatedDataset,
			func(tableName string) (ReadRowPolicy, error) {
				return getLegacyMustTrueReadPolicy(currentDb, tableName)
			},
		)
		if err != nil {
			log.Printf("\033[31merror: authorizing nested foreign keys from table %s: %s\033[0m\n", fk_row.Referencing_table, err.Error())
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error authorizing related datasets")
			return
		}

		readQuerier, err := getPilotReadQuerier(request.Context(), fk_row.Referencing_table, currentDb)
		if err != nil {
			log.Printf("\033[31merror: related items pilot read setup failed for %s: %s\033[0m\n", fk_row.Referencing_table, err.Error())
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error initializing related row visibility check")
			return
		}

		if !shouldEagerLoadRelatedRows(body_data.Child_table, relationKind, regularRelatedTableCount) {
			readPolicy, policyErr := getLegacyMustTrueReadPolicy(currentDb, fk_row.Referencing_table)
			if policyErr != nil {
				log.Printf("\033[31merror: fetching row policy metadata for table %s: %s\033[0m\n", fk_row.Referencing_table, policyErr.Error())
				continue
			}
			rowCount, countErr := countRelatedRows(
				readQuerier,
				fk_row.Referencing_table,
				fk_row.Referencing_column,
				parent_id,
				userRole,
				userID,
				readPolicy,
			)
			if countErr != nil {
				log.Printf("\033[31merror: counting related rows from table %s: %s\033[0m\n", fk_row.Referencing_table, countErr.Error())
				continue
			}

			relatedTablesList = append(relatedTablesList, RelatedTableResult{
				Table_name:         fk_row.Referencing_table,
				Column_name:        fk_row.Referencing_column,
				RelationKind:       relationKind,
				ReferenceDirection: relatedReferenceDirectionIncoming,
				FilterValue:        parent_id,
				RowCount:           rowCount,
				Types:              relatedTypes,
				Rows:               []map[string]interface{}{},
			})
			continue
		}

		visibleCols, err := getVisibleColumnNames(readQuerier, fk_row.Referencing_table)
		if err != nil {
			log.Printf("\033[31merror: fetching visible columns from table %s: %s\033[0m\n", fk_row.Referencing_table, err.Error())
			continue
		}
		visibleCols, err = appendExistingRelatedAuditColumns(currentDb, fk_row.Referencing_table, visibleCols)
		if err != nil {
			log.Printf("\033[33mwarning: related items audit column lookup failed for %s: %s\033[0m\n", fk_row.Referencing_table, err.Error())
		}

		selectColumns, joinClauses := buildRelatedSelectColumnsWithFKLabels(
			fk_row.Referencing_table,
			visibleCols,
			labelForeignKeys,
		)
		readPolicy, policyErr := getLegacyMustTrueReadPolicy(currentDb, fk_row.Referencing_table)
		if policyErr != nil {
			log.Printf("\033[31merror: fetching row policy metadata for table %s: %s\033[0m\n", fk_row.Referencing_table, policyErr.Error())
			continue
		}
		queryRelated, queryArgs := buildRelatedItemsQueryWithReadPolicy(
			selectColumns,
			fk_row.Referencing_table,
			joinClauses,
			fk_row.Referencing_column,
			parent_id,
			userRole,
			userID,
			readPolicy,
		)
		relatedRows, err := readQuerier.Query(queryRelated, queryArgs...)
		if err != nil {
			log.Printf("\033[31merror: fetching related rows from table %s: %s\033[0m\n", fk_row.Referencing_table, err.Error())
			continue
		}

		table_rows, scanErr := scanRowsToMaps(relatedRows)
		relatedRows.Close()
		if scanErr != nil {
			log.Printf("\033[31merror: reading related rows from table %s: %s\033[0m\n", fk_row.Referencing_table, scanErr.Error())
			continue
		}

		relatedTablesList = append(relatedTablesList, RelatedTableResult{
			Table_name:         fk_row.Referencing_table,
			Column_name:        fk_row.Referencing_column,
			RelationKind:       relationKind,
			ReferenceDirection: relatedReferenceDirectionIncoming,
			FilterValue:        parent_id,
			RowCount:           len(table_rows),
			Types:              relatedTypes,
			Rows:               table_rows,
		})
	}

	outgoingRelatedTables, err := fetchOutgoingReferencedTableResults(
		request,
		currentDb,
		body_data.Parent_table,
		parent_id,
		body_data.Child_table,
		userRole,
		userID,
		parentReadPolicy,
		canReadRelatedDataset,
	)
	if err != nil {
		log.Printf("\033[31merror: outgoing related items lookup failed for %s: %s\033[0m\n", body_data.Parent_table, err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error fetching outgoing related items")
		return
	}
	relatedTablesList = append(relatedTablesList, outgoingRelatedTables...)

	resp := map[string]interface{}{
		"child_tables": relatedTablesList,
	}
	totalRelatedRows := 0
	for _, relatedTable := range relatedTablesList {
		if relatedTable.RowCount > 0 {
			totalRelatedRows += relatedTable.RowCount
			continue
		}
		totalRelatedRows += len(relatedTable.Rows)
	}
	log.Printf(
		"dynamic related search summary: parent=%s pk_value=%s child_tables=%d total_rows=%d",
		body_data.Parent_table,
		body_data.Parent_pk_value,
		len(relatedTablesList),
		totalRelatedRows,
	)
	response_writer.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(response_writer).Encode(resp); err != nil {
		log.Printf("\033[31merror: encoding child response: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error encoding child response")
		return
	}
}

// GetDynamicChildItemsHandler is a legacy alias kept for existing route/profile names.
func GetDynamicChildItemsHandler(response_writer http.ResponseWriter, request *http.Request) {
	GetDynamicRelatedItemsHandler(response_writer, request)
}

func fetchOutgoingReferencedTableResults(
	request *http.Request,
	currentDb *sql.DB,
	parentTable string,
	parentID int,
	childTableFilter string,
	userRole string,
	userID int,
	parentReadPolicy ReadRowPolicy,
	canReadDataset relatedDatasetPermissionChecker,
) ([]RelatedTableResult, error) {
	parentForeignKeys, err := dtt_utils.GetForeignKeysForTable(parentTable)
	if err != nil {
		return nil, err
	}
	if len(parentForeignKeys) == 0 {
		return []RelatedTableResult{}, nil
	}

	parentForeignKeys, err = filterAuthorizedOutgoingForeignKeys(parentForeignKeys, childTableFilter, canReadDataset)
	if err != nil {
		return nil, err
	}
	if len(parentForeignKeys) == 0 {
		return []RelatedTableResult{}, nil
	}

	parentReadQuerier, err := getPilotReadQuerier(request.Context(), parentTable, currentDb)
	if err != nil {
		return nil, err
	}

	parentFKValues, err := readParentForeignKeyValues(
		parentReadQuerier,
		parentTable,
		parentID,
		parentForeignKeys,
		userRole,
		userID,
		parentReadPolicy,
	)
	if err != nil {
		return nil, err
	}

	var relatedTables []RelatedTableResult
	for _, parentColumn := range sortedForeignKeyColumns(parentForeignKeys) {
		fk := parentForeignKeys[parentColumn]
		if strings.TrimSpace(childTableFilter) != "" && fk.ReferencedTable != childTableFilter {
			continue
		}

		referencedID, ok := normalizeRelatedIntegerID(parentFKValues[parentColumn])
		if !ok || referencedID <= 0 {
			continue
		}

		relatedTypes, err := getColumnDataTypesWithFK(fk.ReferencedTable, currentDb)
		if err != nil {
			log.Printf("\033[33mwarning: outgoing related items type metadata lookup failed for %s: %s\033[0m\n", fk.ReferencedTable, err.Error())
			relatedTypes = map[string]interface{}{}
		} else {
			relatedTypes = enrichServiceCatalogModerationDataTypes(fk.ReferencedTable, relatedTypes)
		}

		readQuerier, err := getPilotReadQuerier(request.Context(), fk.ReferencedTable, currentDb)
		if err != nil {
			return nil, err
		}

		visibleCols, err := getVisibleColumnNames(readQuerier, fk.ReferencedTable)
		if err != nil {
			log.Printf("\033[31merror: fetching visible columns from referenced table %s: %s\033[0m\n", fk.ReferencedTable, err.Error())
			continue
		}
		visibleCols, err = appendExistingRelatedAuditColumns(currentDb, fk.ReferencedTable, visibleCols)
		if err != nil {
			log.Printf("\033[33mwarning: outgoing related items audit column lookup failed for %s: %s\033[0m\n", fk.ReferencedTable, err.Error())
		}

		targetForeignKeys, err := dtt_utils.GetForeignKeysForTable(fk.ReferencedTable)
		if err != nil {
			log.Printf("\033[33mwarning: outgoing label metadata unavailable for referenced table %s: %s\033[0m\n", fk.ReferencedTable, err.Error())
			targetForeignKeys = map[string]dtt_utils.ForeignKey{}
		}
		labelForeignKeys, relatedTypes, err := authorizeRelatedNestedMetadata(
			targetForeignKeys,
			relatedTypes,
			userRole,
			canReadDataset,
			func(tableName string) (ReadRowPolicy, error) {
				return getLegacyMustTrueReadPolicy(currentDb, tableName)
			},
		)
		if err != nil {
			return nil, err
		}

		selectColumns, joinClauses := buildRelatedSelectColumnsWithFKLabels(
			fk.ReferencedTable,
			visibleCols,
			labelForeignKeys,
		)
		readPolicy, policyErr := getLegacyMustTrueReadPolicy(currentDb, fk.ReferencedTable)
		if policyErr != nil {
			log.Printf("\033[31merror: fetching row policy metadata for referenced table %s: %s\033[0m\n", fk.ReferencedTable, policyErr.Error())
			continue
		}
		queryRelated, queryArgs := buildRelatedItemsQueryWithReadPolicy(
			selectColumns,
			fk.ReferencedTable,
			joinClauses,
			fk.ReferencedColumn,
			referencedID,
			userRole,
			userID,
			readPolicy,
		)
		relatedRows, err := readQuerier.Query(queryRelated, queryArgs...)
		if err != nil {
			log.Printf("\033[31merror: fetching outgoing related row from table %s: %s\033[0m\n", fk.ReferencedTable, err.Error())
			continue
		}

		tableRows, scanErr := scanRowsToMaps(relatedRows)
		relatedRows.Close()
		if scanErr != nil {
			log.Printf("\033[31merror: reading outgoing related row from table %s: %s\033[0m\n", fk.ReferencedTable, scanErr.Error())
			continue
		}

		relatedTables = append(relatedTables, RelatedTableResult{
			Table_name:         fk.ReferencedTable,
			Column_name:        fk.ReferencedColumn,
			RelationKind:       relatedTableKindRows,
			ReferenceDirection: relatedReferenceDirectionOutgoing,
			FilterValue:        referencedID,
			RowCount:           len(tableRows),
			Types:              relatedTypes,
			Rows:               tableRows,
		})
	}

	return relatedTables, nil
}

func readParentForeignKeyValues(
	querier dbutils.Querier,
	tableName string,
	parentID int,
	foreignKeys map[string]dtt_utils.ForeignKey,
	userRole string,
	userID int,
	readPolicy ReadRowPolicy,
) (map[string]interface{}, error) {
	columns := sortedForeignKeyColumns(foreignKeys)
	if len(columns) == 0 {
		return map[string]interface{}{}, nil
	}

	selectParts := make([]string, 0, len(columns))
	for _, columnName := range columns {
		selectParts = append(selectParts, pq.QuoteIdentifier(columnName))
	}

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
		"SELECT %s FROM %s%s LIMIT 1",
		strings.Join(selectParts, ", "),
		pq.QuoteIdentifier(tableName),
		whereClause,
	)
	rows, err := querier.Query(query, queryArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	if !rows.Next() {
		if err := rows.Err(); err != nil {
			return nil, err
		}
		return map[string]interface{}{}, nil
	}

	values := make([]interface{}, len(columns))
	valuePointers := make([]interface{}, len(columns))
	for index := range values {
		valuePointers[index] = &values[index]
	}
	if err := rows.Scan(valuePointers...); err != nil {
		return nil, err
	}

	result := make(map[string]interface{}, len(columns))
	for index, columnName := range columns {
		result[columnName] = normalizeSQLValue(values[index])
	}
	return result, nil
}

func sortedForeignKeyColumns(foreignKeys map[string]dtt_utils.ForeignKey) []string {
	columns := make([]string, 0, len(foreignKeys))
	for columnName := range foreignKeys {
		columns = append(columns, columnName)
	}
	sort.Strings(columns)
	return columns
}

func normalizeRelatedIntegerID(value interface{}) (int, bool) {
	switch typedValue := value.(type) {
	case int:
		return typedValue, true
	case int64:
		return int(typedValue), true
	case int32:
		return int(typedValue), true
	case float64:
		converted := int(typedValue)
		return converted, typedValue == float64(converted)
	case string:
		parsed, err := strconv.Atoi(strings.TrimSpace(typedValue))
		return parsed, err == nil
	default:
		return 0, false
	}
}

func scanRowsToMaps(rows *sql.Rows) ([]map[string]interface{}, error) {
	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}

	var tableRows []map[string]interface{}
	for rows.Next() {
		values := make([]interface{}, len(cols))
		valuePointers := make([]interface{}, len(cols))
		for index := range values {
			valuePointers[index] = &values[index]
		}

		if err := rows.Scan(valuePointers...); err != nil {
			return nil, err
		}

		rowMap := make(map[string]interface{}, len(cols))
		for index, columnName := range cols {
			rowMap[columnName] = normalizeSQLValue(values[index])
		}
		tableRows = append(tableRows, rowMap)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return tableRows, nil
}

func normalizeSQLValue(value interface{}) interface{} {
	switch typedValue := value.(type) {
	case []byte:
		return string(typedValue)
	default:
		return typedValue
	}
}

func buildRelatedTableKindMap(
	querier dbutils.Querier,
	parentTable string,
) (map[string]string, error) {
	statuses, err := listRelatedMediaRelationStatuses(querier, parentTable)
	if err != nil {
		return nil, err
	}

	kindByTable := make(map[string]string, len(statuses))
	for _, status := range statuses {
		trimmedChildTable := strings.TrimSpace(status.ChildTable)
		if trimmedChildTable == "" {
			continue
		}
		kindByTable[trimmedChildTable] = resolveRelatedTableKind(status)
	}
	return kindByTable, nil
}

func classifyRelatedTableKind(referencingTable string, relationKindByChildTable map[string]string) string {
	trimmedTable := strings.TrimSpace(referencingTable)
	if resolvedKind := strings.TrimSpace(relationKindByChildTable[trimmedTable]); resolvedKind != "" {
		return resolvedKind
	}
	// Generic related-tab resolution is metadata-driven now; suffix-only child
	// tables stay ordinary related rows unless FK media metadata says otherwise.
	return relatedTableKindRows
}

func countRegularRelatedTableEntries(
	fkInfos []FKInfo,
	relationKindByChildTable map[string]string,
	childTableFilter string,
) int {
	if strings.TrimSpace(childTableFilter) != "" {
		return 0
	}

	count := 0
	for _, fkInfo := range fkInfos {
		if classifyRelatedTableKind(fkInfo.Referencing_table, relationKindByChildTable) == relatedTableKindRows {
			count++
		}
	}
	return count
}

func shouldEagerLoadRelatedRows(childTableFilter string, relationKind string, regularRelatedTableCount int) bool {
	if strings.TrimSpace(childTableFilter) != "" {
		return true
	}
	if strings.TrimSpace(relationKind) != relatedTableKindRows {
		return true
	}
	return regularRelatedTableCount == 1
}

func appendExistingRelatedAuditColumns(
	db *sql.DB,
	tableName string,
	columns []string,
) ([]string, error) {
	existingColumns := make(map[string]bool, len(relatedRecordSummaryAuditColumns))
	for _, columnName := range relatedRecordSummaryAuditColumns {
		exists, err := columnExistsInTable(db, tableName, columnName)
		if err != nil {
			return columns, err
		}
		existingColumns[columnName] = exists
	}
	return appendRelatedAuditColumns(columns, existingColumns), nil
}

func appendRelatedAuditColumns(columns []string, existingColumns map[string]bool) []string {
	seenColumns := make(map[string]bool, len(columns)+len(relatedRecordSummaryAuditColumns))
	for _, columnName := range columns {
		seenColumns[columnName] = true
	}

	nextColumns := append([]string(nil), columns...)
	for _, columnName := range relatedRecordSummaryAuditColumns {
		if seenColumns[columnName] || !existingColumns[columnName] {
			continue
		}
		nextColumns = append(nextColumns, columnName)
		seenColumns[columnName] = true
	}
	return nextColumns
}

// countRelatedRows counts reverse-FK rows visible to the current principal.
// It exists between related-tab summaries and row-policy SQL so hidden child rows cannot leak through counts.
func countRelatedRows(
	querier dbutils.Querier,
	tableName string,
	referencingColumn string,
	parentID int,
	userRole string,
	userID int,
	readPolicy ReadRowPolicy,
) (int, error) {
	whereClause, queryArgs := buildRelatedItemsWhereClause(
		tableName,
		referencingColumn,
		parentID,
		userRole,
		userID,
		readPolicy,
	)
	query := fmt.Sprintf("SELECT COUNT(*) FROM %s%s", pq.QuoteIdentifier(tableName), whereClause)

	var rowCount int
	if err := querier.QueryRow(query, queryArgs...).Scan(&rowCount); err != nil {
		return 0, err
	}
	return rowCount, nil
}

func buildRelatedSelectColumnsWithFKLabels(
	tableName string,
	columns []string,
	foreignKeys map[string]dtt_utils.ForeignKey,
) (string, string) {
	if len(columns) == 0 {
		return fmt.Sprintf("%s.*", pq.QuoteIdentifier(tableName)), ""
	}

	selectParts := make([]string, 0, len(columns)*2)
	joinParts := make([]string, 0, len(columns))
	usedJoinAliases := make(map[string]int)
	usedDisplayAliases := make(map[string]struct{}, len(columns))
	existingColumns := make(map[string]struct{}, len(columns))

	for _, columnName := range columns {
		existingColumns[strings.ToLower(columnName)] = struct{}{}
	}

	for _, columnName := range columns {
		selectParts = append(
			selectParts,
			fmt.Sprintf(
				"%s.%s AS %s",
				pq.QuoteIdentifier(tableName),
				pq.QuoteIdentifier(columnName),
				pq.QuoteIdentifier(columnName),
			),
		)

		fk, ok := foreignKeys[columnName]
		if !ok || fk.NameColumn == "" {
			continue
		}

		usedJoinAliases[columnName]++
		joinAlias := fmt.Sprintf("%s_related_fk_alias%d", columnName, usedJoinAliases[columnName])
		displayAlias := buildRelatedFKDisplayAlias(columnName, existingColumns, usedDisplayAliases)

		selectParts = append(
			selectParts,
			fmt.Sprintf(
				"%s.%s AS %s",
				pq.QuoteIdentifier(joinAlias),
				pq.QuoteIdentifier(fk.NameColumn),
				pq.QuoteIdentifier(displayAlias),
			),
		)
		joinParts = append(
			joinParts,
			fmt.Sprintf(
				"LEFT JOIN %s AS %s ON %s.%s = %s.%s",
				pq.QuoteIdentifier(fk.ReferencedTable),
				pq.QuoteIdentifier(joinAlias),
				pq.QuoteIdentifier(tableName),
				pq.QuoteIdentifier(columnName),
				pq.QuoteIdentifier(joinAlias),
				pq.QuoteIdentifier(fk.ReferencedColumn),
			),
		)
	}

	joinClauses := ""
	if len(joinParts) > 0 {
		joinClauses = strings.Join(joinParts, " ") + " "
	}
	return strings.Join(selectParts, ", "), joinClauses
}

func buildChildSelectColumnsWithFKLabels(
	tableName string,
	columns []string,
	foreignKeys map[string]dtt_utils.ForeignKey,
) (string, string) {
	return buildRelatedSelectColumnsWithFKLabels(tableName, columns, foreignKeys)
}

// buildRelatedItemsQuery creates the related-row SELECT and always qualifies the
// FK filter column with the base table name so self-FK label joins stay unambiguous.
func buildRelatedItemsQuery(
	selectColumns string,
	tableName string,
	joinClauses string,
	referencingColumn string,
) string {
	query, _ := buildRelatedItemsQueryWithReadPolicy(
		selectColumns,
		tableName,
		joinClauses,
		referencingColumn,
		0,
		"admin",
		0,
		ReadRowPolicy{},
	)
	return query
}

// buildRelatedItemsQueryWithReadPolicy creates a related-row SELECT and returns its ordered SQL args.
// It exists so eager-loaded child rows apply the same row policy as count-only related tabs.
func buildRelatedItemsQueryWithReadPolicy(
	selectColumns string,
	tableName string,
	joinClauses string,
	referencingColumn string,
	parentID int,
	userRole string,
	userID int,
	readPolicy ReadRowPolicy,
) (string, []interface{}) {
	whereClause, queryArgs := buildRelatedItemsWhereClause(
		tableName,
		referencingColumn,
		parentID,
		userRole,
		userID,
		readPolicy,
	)
	query := fmt.Sprintf(
		"SELECT %s FROM %s %s%s LIMIT 50",
		selectColumns,
		pq.QuoteIdentifier(tableName),
		joinClauses,
		whereClause,
	)
	return query, queryArgs
}

// buildRelatedItemsWhereClause creates the parent-FK WHERE clause and appends row-policy predicates.
// It exists as the shared placeholder-ordering helper for related-row selects and counts.
func buildRelatedItemsWhereClause(
	tableName string,
	referencingColumn string,
	parentID int,
	userRole string,
	userID int,
	readPolicy ReadRowPolicy,
) (string, []interface{}) {
	whereClause := fmt.Sprintf(
		" WHERE %s.%s = $1",
		pq.QuoteIdentifier(tableName),
		pq.QuoteIdentifier(referencingColumn),
	)
	queryArgs := []interface{}{parentID}
	return appendReadPolicyToWhereClause(tableName, userRole, userID, readPolicy, whereClause, queryArgs)
}

func buildChildItemsQuery(
	selectColumns string,
	tableName string,
	joinClauses string,
	referencingColumn string,
) string {
	return buildRelatedItemsQuery(selectColumns, tableName, joinClauses, referencingColumn)
}

func buildRelatedFKDisplayAlias(
	columnName string,
	existingColumns map[string]struct{},
	usedDisplayAliases map[string]struct{},
) string {
	baseAlias := relatedFKDisplayAliasBase(columnName)
	candidate := baseAlias
	suffixIndex := 0

	for {
		normalizedCandidate := strings.ToLower(candidate)
		if _, exists := existingColumns[normalizedCandidate]; !exists {
			if _, used := usedDisplayAliases[normalizedCandidate]; !used {
				usedDisplayAliases[normalizedCandidate] = struct{}{}
				return candidate
			}
		}

		suffixIndex++
		if suffixIndex == 1 {
			candidate = baseAlias + " (ln)"
			continue
		}
		candidate = fmt.Sprintf("%s (ln %d)", baseAlias, suffixIndex)
	}
}

func buildChildFKDisplayAlias(
	columnName string,
	existingColumns map[string]struct{},
	usedDisplayAliases map[string]struct{},
) string {
	return buildRelatedFKDisplayAlias(columnName, existingColumns, usedDisplayAliases)
}

func relatedFKDisplayAliasBase(columnName string) string {
	switch {
	case strings.HasSuffix(columnName, "_id"):
		return strings.TrimSuffix(columnName, "_id") + "_name"
	case strings.HasSuffix(columnName, "_uid"):
		return strings.TrimSuffix(columnName, "_uid") + "_name"
	default:
		return columnName + "_name"
	}
}

func childFKDisplayAliasBase(columnName string) string {
	return relatedFKDisplayAliasBase(columnName)
}
