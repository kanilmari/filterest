// add_row_db.go
// Database operations for adding new rows to dynamic tables.
// Bridges the add-row handler and the database with main-row, owned-child, and existing-link writes.
// Exists to encapsulate all row-insertion SQL in one file.
package dtt_1_row_create

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	dtt_triggers "easelect/backend/core_components/dynamic_table_tools/dtt_triggers"
	dtt_search_vectors "easelect/backend/core_components/dynamic_table_tools/search_vectors"
	"easelect/backend/core_components/httpresponse"
	lang "easelect/backend/core_components/lang"

	"github.com/lib/pq"
)

// insertDataAccordingToPayload lisää päätaulun rivin, omistetut lapsirivit ja olemassa olevien rivien liitokset.
// Palauttaa luodun päärivin id-arvon (mainRowID) sekä ChildInsertResult-listan lapsiriveistä.
// Between: AddRowMultipartHandler -> Database
// Why: Orchestrates the insertion of the main row, child rows, and many-to-many relationships.
func insertDataAccordingToPayload(
	w http.ResponseWriter,
	r *http.Request,
	tableName string,
	tableUID string,
	payload map[string]interface{},
	tx *sql.Tx,
) (int64, []ChildInsertResult, error) {

	currentUserID, err := getCurrentUserID(r)
	if err != nil {
		fmt.Printf("\033[31m[add_row_db.go] [insertDataAccordingToPayload] error: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "could not fetch user ID")
		return 0, nil, err
	}

	currentUsername, err := getCurrentUsername(r)
	if err != nil {
		fmt.Printf("\033[31m[add_row_db.go] [insertDataAccordingToPayload] error: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "failed to fetch username from session")
		return 0, nil, err
	}
	userRole := getSessionUserRoleOrGuest(r)

	// ------------------------------------------------------------ owned children & existing links
	var childRows []ChildRowPayload
	if raw := payload["_childRows"]; raw != nil {
		if unmarshalErr := json.Unmarshal(mustJSON(raw), &childRows); unmarshalErr != nil {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid _childRows payload")
			return 0, nil, unmarshalErr
		}
		delete(payload, "_childRows")
	}
	var existingLinks []ExistingRelationLinkPayload
	if raw := payload["_existingLinks"]; raw != nil {
		if unmarshalErr := json.Unmarshal(mustJSON(raw), &existingLinks); unmarshalErr != nil {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid _existingLinks payload")
			return 0, nil, unmarshalErr
		}
		delete(payload, "_existingLinks")
	}
	// The former nested M:M contract could create arbitrary related business
	// rows and accepted physical table/column names from the browser. Refuse it
	// explicitly instead of silently keeping a hidden compatibility bypass.
	if raw := payload["_manyToMany"]; raw != nil {
		err := errors.New("nested related-row creation is no longer supported")
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return 0, nil, err
	}
	payload, err = applyPilotCreatePayload(tableName, userRole, payload, currentUserID, currentUsername)
	if err != nil {
		var fe *forbiddenError
		if errors.As(err, &fe) {
			httpresponse.RespondWithError(w, http.StatusForbidden, fe.msg)
			return 0, nil, err
		}
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error validating pilot create payload")
		return 0, nil, err
	}

	schemaName := "public"
	columnsInfo, err := getAddRowColumnsWithTypes(tableUID, schemaName)
	if err != nil {
		fmt.Printf("\033[31m[add_row_db.go] [insertDataAccordingToPayload] error: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error fetching columns")
		return 0, nil, err
	}
	if err := normalizeMultilingualCreatePayload(payload, columnsInfo); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return 0, nil, err
	}

	columnTypeMap := make(map[string]string)
	colNullableMap := make(map[string]bool) // YES → true
	for _, col := range columnsInfo {
		columnTypeMap[col.ColumnName] = col.DataType
		colNullableMap[col.ColumnName] = strings.ToUpper(col.IsNullable) == "YES"
	}

	exclude := map[string]bool{"id": true, "created": true, "updated": true, "embedding_vector": true, "creation_spec": true}
	allowed := map[string]bool{}
	for _, c := range columnsInfo {
		if exclude[strings.ToLower(c.ColumnName)] || c.GenerationExpression != "" || strings.ToUpper(c.IsIdentity) == "YES" {
			continue
		}
		if isAddRowColumnUserInsertable(c) {
			allowed[c.ColumnName] = true
		}
	}

	//------------------------------------------------------------------
	// 1) FILTTERÖI & NORMALISOI PÄÄRIVIN SARAKKEET
	//------------------------------------------------------------------
	filteredRow := map[string]interface{}{}
	for colName, val := range payload {
		if !allowed[colName] {
			err := fmt.Errorf("column %s is not insertable", colName)
			httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
			return 0, nil, err
		}
		colType := strings.ToLower(columnTypeMap[colName])

		if strings.Contains(colType, "vector") {
			continue
		}

		// Missing geometry is missing data, never a real-world location. Nullable
		// columns persist NULL; required geometry is rejected before the INSERT.
		if strings.Contains(colType, "geometry") {
			val, err = normalizeGeometryInsertValue(val, colNullableMap[colName])
			if err != nil {
				httpresponse.RespondWithError(w, http.StatusBadRequest, "geometry value is required for "+colName)
				return 0, nil, err
			}
		}

		// --- Date/timestamp: "" → NULL -----------------------------
		if isDateLikeType(colType) {
			if s, ok := val.(string); ok && strings.TrimSpace(s) == "" {
				val = nil
				fmt.Printf("[INFO] date column '%s' is empty, setting NULL\n", colName)
			}
		}

		// --- Integer: "" → NULL jos sarake on nullable -------------
		if isIntegerType(colType) {
			if s, ok := val.(string); ok {
				trim := strings.TrimSpace(s)
				if trim == "" {
					if colNullableMap[colName] {
						val = nil
						fmt.Printf("[INFO] int column '%s' is empty, setting NULL\n", colName)
					} else {
						val = 0
						fmt.Printf("[INFO] int column '%s' is empty, setting dummy 0 (NOT NULL)\n", colName)
					}
				} else {
					if parsed, perr := strconv.Atoi(trim); perr == nil {
						val = parsed
					} else {
						fmt.Printf("\033[31m[add_row_db.go] [insertDataAccordingToPayload] error: %s\033[0m\n", perr.Error())
						httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid integer value for "+colName)
						return 0, nil, perr
					}
				}
			}
		}

		filteredRow[colName] = val
	}

	//------------------------------------------------------------------
	// 2) Täydennä source_insert_specs (user_id, cached_username, ...)
	//------------------------------------------------------------------
	for _, col := range columnsInfo {
		if col.SourceInsertSpecs == "" {
			continue
		}
		var specs map[string]string
		if err := json.Unmarshal([]byte(col.SourceInsertSpecs), &specs); err != nil {
			continue
		}
		if specs["user_id"] == "currentUser" && col.ColumnName == "user_id" {
			filteredRow["user_id"] = currentUserID
		}
		if specs["cached_username"] == "currentUserName" {
			filteredRow["cached_username"] = currentUsername
		}
	}
	applyCurrentActorOwnership(filteredRow, columnsInfo, currentUserID, currentUsername)
	if err := validateMainForeignKeyReads(
		tx,
		columnsInfo,
		filteredRow,
		currentUserID,
		userRole,
	); err != nil {
		var forbidden *forbiddenError
		if errors.As(err, &forbidden) {
			httpresponse.RespondWithError(w, http.StatusForbidden, forbidden.msg)
		} else {
			httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		}
		return 0, nil, err
	}
	childRows, err = resolveAndAuthorizeOwnedChildren(
		tx,
		tableUID,
		childRows,
		currentUserID,
	)
	if err != nil {
		var forbidden *forbiddenError
		if errors.As(err, &forbidden) {
			httpresponse.RespondWithError(w, http.StatusForbidden, forbidden.msg)
		} else {
			httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		}
		return 0, nil, err
	}
	resolvedExistingLinks, err := resolveAndAuthorizeExistingLinks(
		tx,
		tableUID,
		existingLinks,
		currentUserID,
		userRole,
	)
	if err != nil {
		var forbidden *forbiddenError
		if errors.As(err, &forbidden) {
			httpresponse.RespondWithError(w, http.StatusForbidden, forbidden.msg)
		} else {
			httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		}
		return 0, nil, err
	}
	for _, column := range columnsInfo {
		if requiredGeometryValueMissing(
			column.ColumnName,
			column.DataType,
			column.IsNullable,
			column.ColumnDefault,
			column.GenerationExpression,
			filteredRow,
		) {
			err := fmt.Errorf("geometry value is required for %s", column.ColumnName)
			httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
			return 0, nil, err
		}
	}

	//------------------------------------------------------------------
	// 3) PÄÄRIVI
	//------------------------------------------------------------------

	mainRowID, err := insertMainRow(r.Context(), tx, tableName, filteredRow, columnTypeMap)
	if err != nil {
		fmt.Printf("\033[31m[add_row_db.go] [insertDataAccordingToPayload] error: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error inserting main row")
		return 0, nil, err
	}
	lang.EnsureLangKeySourceForCRUDMutationTx(tx, tableName, mainRowID, currentUsername)

	childResults := []ChildInsertResult{}

	//------------------------------------------------------------------
	// 4) LAPSIRIVIT
	//------------------------------------------------------------------
	for i, child := range childRows {

		childUID, err := getTableUID(child.TableName, tx)
		if err != nil {
			fmt.Printf("\033[31m[add_row_db.go] [insertDataAccordingToPayload] error: %s\033[0m\n", err.Error())
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "error fetching child table uid")
			return 0, nil, err
		}

		childCols, err := getAddRowColumnsWithTypes(childUID, schemaName)
		if err != nil {
			fmt.Printf("\033[31m[add_row_db.go] [insertDataAccordingToPayload] error: %s\033[0m\n", err.Error())
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "error fetching child table columns")
			return 0, nil, err
		}
		if err := normalizeMultilingualCreatePayload(child.Data, childCols); err != nil {
			httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
			return 0, nil, err
		}
		childType := map[string]string{}
		childNull := map[string]bool{}
		childAllowed := map[string]bool{}
		for _, cc := range childCols {
			childType[cc.ColumnName] = cc.DataType
			childNull[cc.ColumnName] = strings.ToUpper(cc.IsNullable) == "YES"
			lowerName := strings.ToLower(cc.ColumnName)
			if lowerName != "id" && lowerName != "created" && lowerName != "updated" &&
				lowerName != "embedding_vector" && lowerName != "creation_spec" &&
				cc.ColumnName != child.ReferencingColumn && isAddRowColumnUserInsertable(cc) {
				childAllowed[cc.ColumnName] = true
			}
		}

		for colName, raw := range child.Data {
			if colName == "_file" {
				delete(child.Data, colName)
				continue
			}
			if !childAllowed[colName] {
				err := fmt.Errorf("owned child column %s is not insertable", colName)
				httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
				return 0, nil, err
			}
			colType := strings.ToLower(childType[colName])

			if strings.Contains(colType, "vector") {
				delete(child.Data, colName)
				continue
			}

			if strings.Contains(colType, "geometry") {
				normalizedValue, normalizeErr := normalizeGeometryInsertValue(raw, childNull[colName])
				if normalizeErr != nil {
					httpresponse.RespondWithError(w, http.StatusBadRequest, "geometry value is required for "+colName)
					return 0, nil, normalizeErr
				}
				child.Data[colName] = normalizedValue
				continue
			}

			// date/timestamp
			if isDateLikeType(colType) {
				if s, ok := raw.(string); ok && strings.TrimSpace(s) == "" {
					child.Data[colName] = nil
					continue
				}
			}

			// integer
			if isIntegerType(colType) {
				if s, ok := raw.(string); ok {
					trim := strings.TrimSpace(s)
					if trim == "" {
						if childNull[colName] {
							child.Data[colName] = nil
						} else {
							child.Data[colName] = 0
						}
					} else {
						parsed, perr := strconv.Atoi(trim)
						if perr != nil {
							fmt.Printf("\033[31m[add_row_db.go] [insertDataAccordingToPayload] error: %s\033[0m\n", perr.Error())
							httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid integer value for "+colName)
							return 0, nil, perr
						}
						child.Data[colName] = parsed
					}
				}
			}
		}

		cID, cErr := insertSingleChildRow(tx, mainRowID, child, childType)
		if cErr != nil {
			fmt.Printf("\033[31m[add_row_db.go] [insertDataAccordingToPayload] error: %s\033[0m\n", cErr.Error())
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "error inserting child row")
			return 0, nil, cErr
		}
		childResults = append(childResults, ChildInsertResult{
			FieldKey:          fmt.Sprintf("file_child_%d", i),
			TableName:         child.TableName,
			ReferencingColumn: child.ReferencingColumn,
			ChildRowID:        cID,
			MainRowID:         mainRowID,
		})
	}

	//------------------------------------------------------------------
	// 5) OLEMASSA OLEVIEN RIVIEN LIITOKSET
	//------------------------------------------------------------------
	if err := applyExistingLinks(tx, mainRowID, resolvedExistingLinks); err != nil {
		fmt.Printf("\033[31m[add_row_db.go] [applyExistingLinks] error: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error linking existing rows")
		return 0, nil, err
	}

	//------------------------------------------------------------------
	// 6) TRIGGERIT
	//------------------------------------------------------------------
	triggerSourceRow, err := fetchInsertedTriggerSourceRow(r.Context(), tx, tableName, mainRowID)
	if err != nil {
		wrappedErr := fmt.Errorf("fetch inserted trigger source row for %s: %w", tableName, err)
		fmt.Printf("\033[31m[add_row_db.go] [fetchInsertedTriggerSourceRow] error: %s\033[0m\n", wrappedErr.Error())
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error preparing triggers")
		return 0, nil, wrappedErr
	}
	if err := dtt_triggers.ExecuteTriggers(tx, tableName, triggerSourceRow); err != nil {
		return 0, nil, respondToTriggerExecutionError(w, tableName, err)
	}

	return mainRowID, childResults, nil
}

func respondToTriggerExecutionError(w http.ResponseWriter, tableName string, triggerErr error) error {
	if triggerErr == nil {
		return nil
	}
	wrappedErr := fmt.Errorf("execute triggers for %s: %w", tableName, triggerErr)
	fmt.Printf("\033[31m[add_row_db.go] [executeTriggers] error: %s\033[0m\n", wrappedErr.Error())
	httpresponse.RespondWithError(w, http.StatusInternalServerError, "error executing triggers")
	return wrappedErr
}

// fetchInsertedTriggerSourceRow reads the committed shape inside the current
// transaction so create triggers also receive database defaults and generated
// values, not only fields present in the request payload.
func fetchInsertedTriggerSourceRow(ctx context.Context, tx *sql.Tx, tableName string, mainRowID int64) (map[string]interface{}, error) {
	query := fmt.Sprintf(
		"SELECT * FROM %s WHERE id = $1",
		pq.QuoteIdentifier(tableName),
	)
	rows, err := tx.QueryContext(ctx, query, mainRowID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	columnNames, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	if !rows.Next() {
		if err := rows.Err(); err != nil {
			return nil, err
		}
		return nil, sql.ErrNoRows
	}

	columnValues := make([]interface{}, len(columnNames))
	scanTargets := make([]interface{}, len(columnNames))
	for index := range columnValues {
		scanTargets[index] = &columnValues[index]
	}
	if err := rows.Scan(scanTargets...); err != nil {
		return nil, err
	}
	return mapInsertedRowValues(columnNames, columnValues)
}

func mapInsertedRowValues(columnNames []string, columnValues []interface{}) (map[string]interface{}, error) {
	if len(columnNames) != len(columnValues) {
		return nil, errors.New("inserted row column/value count mismatch")
	}
	triggerSourceRow := make(map[string]interface{}, len(columnNames))
	for index, columnName := range columnNames {
		triggerSourceRow[columnName] = columnValues[index]
	}
	return triggerSourceRow, nil
}

// normalizeGeometryInsertValue preserves missing spatial data as NULL and
// rejects it when the database contract requires an actual geometry.
func normalizeGeometryInsertValue(value interface{}, nullable bool) (interface{}, error) {
	missing := value == nil
	if textValue, ok := value.(string); ok {
		missing = strings.TrimSpace(textValue) == ""
	}
	if !missing {
		return value, nil
	}
	if !nullable {
		return nil, errors.New("geometry value is required")
	}
	return nil, nil
}

func requiredGeometryValueMissing(
	columnName string,
	dataType string,
	isNullable string,
	columnDefault string,
	generationExpression string,
	rowData map[string]interface{},
) bool {
	if !strings.Contains(strings.ToLower(dataType), "geometry") ||
		strings.EqualFold(strings.TrimSpace(isNullable), "YES") ||
		strings.TrimSpace(columnDefault) != "" ||
		strings.TrimSpace(generationExpression) != "" {
		return false
	}
	value, exists := rowData[columnName]
	if !exists {
		return true
	}
	_, err := normalizeGeometryInsertValue(value, false)
	return err != nil
}

// insertMainRow lisää päärivin tauluun ja palauttaa luodun rivin id-arvon
// Between: insertDataAccordingToPayload -> Database
// Why: Executes the SQL INSERT for the main row.
func insertMainRow(ctx context.Context, tx *sql.Tx, tableName string, rowData map[string]interface{}, columnTypeMap map[string]string) (int64, error) {
	insertColumns := []string{}
	placeholders := []string{}
	values := []interface{}{}
	i := 1

	for col, val := range rowData {
		insertColumns = append(insertColumns, pq.QuoteIdentifier(col))
		colType := strings.ToLower(columnTypeMap[col])

		// Special handling for geometry columns — PostGIS requires valid WKT.
		// Empty nullable geometry stays NULL so missing data cannot become a
		// plausible but false map location.
		if strings.Contains(colType, "geometry") {
			if normalizedValue, normalizeErr := normalizeGeometryInsertValue(val, true); normalizeErr == nil && normalizedValue == nil {
				placeholders = append(placeholders, "NULL")
				continue
			}
			placeholders = append(placeholders, fmt.Sprintf("ST_GeomFromText($%d, 4326)", i))
			values = append(values, val)
			i++
			continue
		}

		placeholders = append(placeholders, fmt.Sprintf("$%d", i))
		values = append(values, val)
		i++
	}

	if len(insertColumns) == 0 {
		return 0, fmt.Errorf("no valid columns to insert in table %s", tableName)
	}

	insertQuery := fmt.Sprintf(
		`INSERT INTO %s (%s) VALUES (%s) RETURNING id`,
		pq.QuoteIdentifier(tableName),
		strings.Join(insertColumns, ", "),
		strings.Join(placeholders, ", "),
	)

	var mainRowID int64
	err := tx.QueryRow(insertQuery, values...).Scan(&mainRowID)
	if err != nil {
		fmt.Printf("\033[31m[add_row_db.go] [insertMainRow] error: %s\033[0m\n", err.Error())
		return 0, err
	}
	if err := dtt_search_vectors.RefreshRowSearchVector(ctx, tx, tableName, mainRowID); err != nil {
		return 0, err
	}
	return mainRowID, nil
}

// insertSingleChildRow lisää yksittäisen lapsirivin child.TableName-tauluun
// ja asettaa referencingColumnin arvoksi mainRowID.
// Palauttaa lisätyn rivin id-arvon (childRowID).
// Between: insertDataAccordingToPayload -> Database
// Why: Executes the SQL INSERT for a child row.
func insertSingleChildRow(tx *sql.Tx, mainRowID int64, child ChildRowPayload, columnTypeMap map[string]string) (int64, error) {
	if child.TableName == "" || child.ReferencingColumn == "" {
		return 0, fmt.Errorf("missing child data field: tableName or referencingColumn")
	}
	if child.Data == nil {
		return 0, nil
	}

	// Poistetaan _file -kenttä, ettei yritetä SQL:ään
	delete(child.Data, "_file")

	// Lisätään viite päärivin ID:hen
	child.Data[child.ReferencingColumn] = mainRowID

	insertColumns := []string{}
	placeholders := []string{}
	values := []interface{}{}
	i := 1

	for col, val := range child.Data {
		insertColumns = append(insertColumns, pq.QuoteIdentifier(col))
		if strings.Contains(strings.ToLower(columnTypeMap[col]), "geometry") {
			if val == nil || strings.TrimSpace(fmt.Sprint(val)) == "" {
				placeholders = append(placeholders, "NULL")
				continue
			}
			placeholders = append(placeholders, fmt.Sprintf("ST_GeomFromText($%d, 4326)", i))
			values = append(values, val)
			i++
			continue
		}
		placeholders = append(placeholders, fmt.Sprintf("$%d", i))
		values = append(values, val)
		i++
	}

	if len(insertColumns) == 0 {
		return 0, nil
	}

	insertQuery := fmt.Sprintf(
		`INSERT INTO %s (%s) VALUES (%s) RETURNING id`,
		pq.QuoteIdentifier(child.TableName),
		strings.Join(insertColumns, ", "),
		strings.Join(placeholders, ", "),
	)

	var childRowID int64
	err := tx.QueryRow(insertQuery, values...).Scan(&childRowID)
	if err != nil {
		fmt.Printf("\033[31m[add_row_db.go] [insertSingleChildRow] error: %s\033[0m\n", err.Error())
		return 0, err
	}

	// Tämän jälkeen (transaktion sisällä) päivitetään mahdolliset cacheTargets
	if cacheErr := updateCacheTargets(tx, child.TableName, child.ReferencingColumn, child.Data); cacheErr != nil {
		fmt.Printf("\033[31m[add_row_db.go] [insertSingleChildRow -> updateCacheTargets] error: %s\033[0m\n", cacheErr.Error())
		return 0, cacheErr
	}

	return childRowID, nil
}
