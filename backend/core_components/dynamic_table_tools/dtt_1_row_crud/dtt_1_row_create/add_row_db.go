// add_row_db.go
// Database operations for adding new rows to dynamic tables.
// Bridges the add-row handler and the database with INSERT logic for main, child, and M2M rows.
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

// insertDataAccordingToPayload lisää päätaulun rivin, lapsirivit ja M2M-liitokset.
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

	// ------------------------------------------------------------ childRows & m2m
	var childRows []ChildRowPayload
	if raw := payload["_childRows"]; raw != nil {
		if unmarshalErr := json.Unmarshal(mustJSON(raw), &childRows); unmarshalErr != nil {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid _childRows payload")
			return 0, nil, unmarshalErr
		}
		delete(payload, "_childRows")
	}
	var manyToManyRows []ManyToManyPayload
	if raw := payload["_manyToMany"]; raw != nil {
		if unmarshalErr := json.Unmarshal(mustJSON(raw), &manyToManyRows); unmarshalErr != nil {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid _manyToMany payload")
			return 0, nil, unmarshalErr
		}
		delete(payload, "_manyToMany")
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
		allowed[c.ColumnName] = true
	}

	//------------------------------------------------------------------
	// 1) FILTTERÖI & NORMALISOI PÄÄRIVIN SARAKKEET
	//------------------------------------------------------------------
	filteredRow := map[string]interface{}{}
	for colName, val := range payload {
		colType := strings.ToLower(columnTypeMap[colName])

		if strings.Contains(colType, "vector") {
			continue
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

		if allowed[colName] {
			filteredRow[colName] = val
		}
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
		childType := map[string]string{}
		childNull := map[string]bool{}
		for _, cc := range childCols {
			childType[cc.ColumnName] = cc.DataType
			childNull[cc.ColumnName] = strings.ToUpper(cc.IsNullable) == "YES"
		}

		for colName, raw := range child.Data {
			colType := strings.ToLower(childType[colName])

			if strings.Contains(colType, "vector") {
				delete(child.Data, colName)
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

		cID, cErr := insertSingleChildRow(tx, mainRowID, child)
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
	// 5) M2M-liitokset
	//------------------------------------------------------------------
	for _, m2m := range manyToManyRows {
		linkVal := m2m.SelectedValue
		if m2m.IsNewRow && m2m.NewRowData != nil {
			newID, err := insertNewThirdTableRow(tx, m2m.ThirdTableName, m2m.NewRowData)
			if err != nil {
				fmt.Printf("\033[31m[add_row_db.go] [insertDataAccordingToPayload] error: %s\033[0m\n", err.Error())
				httpresponse.RespondWithError(w, http.StatusInternalServerError, "error inserting third table row")
				return 0, nil, err
			}
			linkVal = newID
		}
		if linkVal == nil {
			continue
		}
		if err := insertOneManyToManyRelation(tx, mainRowID, ManyToManyPayload{
			LinkTableName:      m2m.LinkTableName,
			MainTableFkColumn:  m2m.MainTableFkColumn,
			ThirdTableFkColumn: m2m.ThirdTableFkColumn,
			SelectedValue:      linkVal,
		}); err != nil {
			fmt.Printf("\033[31m[add_row_db.go] [insertDataAccordingToPayload] error: %s\033[0m\n", err.Error())
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "error inserting M2M relation")
			return 0, nil, err
		}
	}

	//------------------------------------------------------------------
	// 6) TRIGGERIT
	//------------------------------------------------------------------
	if err := dtt_triggers.ExecuteTriggers(tx, tableName, map[string]interface{}{"id": mainRowID}); err != nil {
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
		// Default to Helsinki city center (EPSG:4326) when no value provided,
		// so the row is insertable and the point is visible on a map.
		if strings.Contains(colType, "geometry") {
			if val == nil || val == "" {
				val = "POINT(24.9384 60.1699)" // Helsinki, Finland — default for empty geometry
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
func insertSingleChildRow(tx *sql.Tx, mainRowID int64, child ChildRowPayload) (int64, error) {
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

// insertNewThirdTableRow lisää uuden rivin kolmanteen tauluun (m2m), jos
// sellaista ei vielä ole. Palauttaa luodun rivin ID:n.
// Between: insertDataAccordingToPayload -> Database
// Why: Creates a new row in the target table of a many-to-many relationship if needed.
func insertNewThirdTableRow(tx *sql.Tx, tableName string, rowData map[string]interface{}) (int64, error) {
	if len(rowData) == 0 {
		return 0, nil
	}

	insertCols := []string{}
	placeholders := []string{}
	values := []interface{}{}
	i := 1

	for col, val := range rowData {
		insertCols = append(insertCols, pq.QuoteIdentifier(col))
		placeholders = append(placeholders, fmt.Sprintf("$%d", i))
		values = append(values, val)
		i++
	}

	query := fmt.Sprintf(
		`INSERT INTO %s (%s) VALUES (%s) RETURNING id`,
		pq.QuoteIdentifier(tableName),
		strings.Join(insertCols, ", "),
		strings.Join(placeholders, ", "),
	)

	var newID int64
	err := tx.QueryRow(query, values...).Scan(&newID)
	if err != nil {
		fmt.Printf("\033[31m[add_row_db.go] [insertNewThirdTableRow] error: %s\033[0m\n", err.Error())
		return 0, err
	}
	return newID, nil
}

// insertOneManyToManyRelation lisää m2m-suhteen linkkitauluun.
// Between: insertDataAccordingToPayload -> Database
// Why: Inserts a row into the link table of a many-to-many relationship.
func insertOneManyToManyRelation(tx *sql.Tx, mainRowID int64, m2m ManyToManyPayload) error {
	insertQuery := fmt.Sprintf(
		`INSERT INTO %s (%s, %s) VALUES ($1, $2)`,
		pq.QuoteIdentifier(m2m.LinkTableName),
		pq.QuoteIdentifier(m2m.MainTableFkColumn),
		pq.QuoteIdentifier(m2m.ThirdTableFkColumn),
	)
	_, err := tx.Exec(insertQuery, mainRowID, m2m.SelectedValue)
	if err != nil {
		fmt.Printf("\033[31m[add_row_db.go] [insertOneManyToManyRelation] error: %s\033[0m\n", err.Error())
	}
	return err
}
