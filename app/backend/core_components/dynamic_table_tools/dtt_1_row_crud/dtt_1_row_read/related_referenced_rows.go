// related_referenced_rows.go
// Reads the parent picture and outgoing referenced rows.
// Connects related result assembly with its existing permission and row-policy boundaries.
// Keeps one implementation for each read responsibility and bounded source files.
package dtt_1_row_read

import (
	"database/sql"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/row_mutation_policy"
	"easelect/backend/core_components/dynamic_table_tools/dtt_card_picture"
	dtt_utils "easelect/backend/core_components/dynamic_table_tools/dtt_utils"
	"errors"
	"fmt"
	"github.com/lib/pq"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"
)

// readRelatedCardPicture returns the picture the parent row shows: the card list's choice
// from the parent's picture fields (dtt_card_picture.ChooseShownPicture), with a media-
// library picture this viewer may not open removed, as in every other row response. A
// language map in an image field is reported as stored, because the browser reads it in
// the viewer's language; a value that could make the browser load a media-library
// picture this viewer may not open, written as a full or a relative address and alone or
// inside such a map, is reported as no picture, so no language can show it.
// hasFields is false when the parent has no field that can show a picture; otherwise an
// empty value means the row shows none.
func readRelatedCardPicture(querier dbutils.Querier, actor dbutils.RequestActorContext, parentTable string, parentID int) (string, bool, error) {
	fields, err := dtt_card_picture.ReadOwnPictureFields(querier, parentTable)
	if err != nil {
		return "", false, err
	}
	columns := fields.Columns()
	if len(columns) == 0 {
		return "", false, nil
	}
	selected := make([]string, len(columns))
	scanned := make([]sql.NullString, len(columns))
	targets := make([]interface{}, len(columns))
	for index, column := range columns {
		selected[index] = pq.QuoteIdentifier(column) + "::text"
		targets[index] = &scanned[index]
	}
	err = querier.QueryRow(
		fmt.Sprintf(`SELECT %s FROM %s WHERE id = $1`, strings.Join(selected, ", "), pq.QuoteIdentifier(parentTable)),
		parentID,
	).Scan(targets...)
	if errors.Is(err, sql.ErrNoRows) {
		return "", true, nil
	}
	if err != nil {
		return "", true, err
	}
	values := make(map[string]string, len(columns))
	for index, column := range columns {
		values[column] = scanned[index].String
	}
	shown := dtt_card_picture.ChooseShownPicture(fields, values)
	if shown == "" {
		return "", true, nil
	}
	guarded := []map[string]interface{}{{"cached_image": shown}}
	for _, reference := range mediaLibraryReferencesIn(shown) {
		guarded = append(guarded, map[string]interface{}{"cached_image": reference})
	}
	FilterIndependentMediaRows(querier, actor, guarded)
	for _, embedded := range guarded[1:] {
		if embedded["cached_image"] == nil {
			return "", true, nil
		}
	}
	value, _ := guarded[0]["cached_image"].(string)
	return value, true, nil
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

		actorColumns, err := row_mutation_policy.ReadRowActorColumns(readQuerier, fk.ReferencedTable)
		if err != nil {
			return nil, err
		}
		selectColumns, joinClauses := buildRelatedSelectColumnsWithFKLabels(
			fk.ReferencedTable,
			visibleCols,
			labelForeignKeys,
			actorColumns,
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
			"",
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

		FilterIndependentMediaRows(readQuerier, dbutils.NewRequestActorContext(userID, userRole), tableRows)
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
