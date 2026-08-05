// system_table_column_metadata.go
// HTTP handlers for system-level table and column metadata operations.
// Bridges system_db_tables, system_column_details, and the admin metadata UI.
// Exists to provide endpoints for table lists, OID updates, tab ordering, and column ID maps.

package system_table_tools

import (
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/dynamic_table_tools/dtt_2_column_crud/dtt_2_column_update"
	"easelect/backend/core_components/dynamic_table_tools/dtt_crud_workflows"
	"easelect/backend/core_components/dynamic_table_tools/dtt_models"
	"easelect/backend/core_components/httpresponse"
	e_sessions "easelect/backend/core_components/sessions"
	"easelect/backend/pipeline/access_control"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
)

func buildGroupedTablesQuery(iconKeyExpr string) string {
	return fmt.Sprintf(`
		WITH RECURSIVE current_project_roots AS (
			SELECT id, parent_id
			FROM system_table_folders
			WHERE is_current_project = true
		),
		current_project_folders AS (
			SELECT id, parent_id
			FROM current_project_roots
			UNION ALL
			SELECT child.id, child.parent_id
			FROM system_table_folders child
			INNER JOIN current_project_folders cpf ON child.parent_id = cpf.id
		)
		SELECT
			t.id,
			t.table_uid,
			t.table_name,
			t.is_default,
			t.filterbar_visible_by_default,
			t.is_main_table,
			t.is_about_table,
			t.folder_id,
			COALESCE(cpf.id IS NOT NULL, false) AS is_in_current_project,
			COALESCE(cpr.id IS NOT NULL, false) AS is_top_level_in_current_project,
			%s
		FROM system_db_tables t
		LEFT JOIN current_project_folders cpf ON t.folder_id = cpf.id
		LEFT JOIN current_project_roots cpr ON t.folder_id = cpr.id
		ORDER BY t.table_name`, iconKeyExpr)
}

func GetGroupedTables(response_writer http.ResponseWriter, http_request *http.Request) {
	userID, sessionError := e_sessions.GetUserIDFromSession(http_request)
	if sessionError != nil || userID <= 0 {
		httpresponse.RespondWithError(response_writer, http.StatusUnauthorized, "unauthorized")
		return
	}

	visibleTableUIDs, visibilityError := access_control.GetTablesVisibleToUser(backend.Db, userID)
	if visibilityError != nil {
		log.Printf("\033[31merror: fetching table permissions: %v\033[0m", visibilityError)
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "failed to fetch table permissions")
		return
	}

	// Check if the optional icon_key column exists (added by migration).
	// This makes the handler work regardless of whether the migration has run.
	var hasIconKey bool
	if scanErr := backend.Db.QueryRow(`
		SELECT EXISTS (
			SELECT 1 FROM information_schema.columns
			WHERE table_name = 'system_db_tables' AND column_name = 'icon_key'
		)`).Scan(&hasIconKey); scanErr != nil {
		log.Printf("[GetSystemTableColumnMetadata] warning: could not check icon_key column existence: %v", scanErr)
	}

	iconKeyExpr := "NULL::varchar AS icon_key"
	if hasIconKey {
		iconKeyExpr = "t.icon_key"
	}

	select_tables_query := buildGroupedTablesQuery(iconKeyExpr)
	query_rows, query_error := backend.Db.Query(select_tables_query)
	if query_error != nil {
		log.Printf("\033[31merror: fetching tables: %v\033[0m", query_error)
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "failed to fetch tables")
		return
	}
	defer query_rows.Close()

	var tables_list []dtt_models.Table
	for query_rows.Next() {
		var tableUID int
		var single_table dtt_models.Table

		scan_error := query_rows.Scan(
			&single_table.ID,
			&tableUID,
			&single_table.TableName,
			&single_table.IsDefault,
			&single_table.FilterbarVisibleByDefault,
			&single_table.IsMainTable,
			&single_table.IsAboutTable,
			&single_table.FolderID,
			&single_table.IsInCurrentProject,
			&single_table.IsTopLevelInCurrentProject,
			&single_table.IconKey,
		)
		if scan_error != nil {
			log.Printf("\033[31merror: processing table rows: %v\033[0m", scan_error)
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error processing table rows")
			return
		}
		if visibleTableUIDs != nil && !visibleTableUIDs[tableUID] {
			continue
		}
		if !backend.ShouldExposeCloudManagementDatasetName(single_table.TableName) {
			continue
		}
		single_table.CanReadRows = true

		tables_list = append(tables_list, single_table)
	}
	if err := query_rows.Err(); err != nil {
		log.Printf("\033[31merror: processing table rows: %v\033[0m", err)
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error processing table rows")
		return
	}

	response_map := map[string]interface{}{
		"datasets": tables_list,
	}

	// Fetch tab_order_json from the active project folder (if column exists).
	// Returns a JSON array that the frontend uses to sort navigation tabs.
	var hasTabOrderCol bool
	if scanErr := backend.Db.QueryRow(`
		SELECT EXISTS (
			SELECT 1 FROM information_schema.columns
			WHERE table_name = 'system_table_folders' AND column_name = 'tab_order_json'
		)`).Scan(&hasTabOrderCol); scanErr != nil {
		log.Printf("[GetSystemTableColumnMetadata] warning: could not check tab_order_json column existence: %v", scanErr)
	}

	if hasTabOrderCol {
		var tabOrderRaw *string
		if scanErr := backend.Db.QueryRow(`
			SELECT tab_order_json::text
			FROM system_table_folders
			WHERE is_current_project = true
			LIMIT 1`).Scan(&tabOrderRaw); scanErr != nil {
			log.Printf("[GetSystemTableColumnMetadata] warning: could not fetch tab_order_json: %v", scanErr)
		}
		if tabOrderRaw != nil {
			// Parse raw JSON string into interface{} so it serialises as JSON array, not escaped string
			var tabOrderParsed interface{}
			if json.Unmarshal([]byte(*tabOrderRaw), &tabOrderParsed) == nil {
				response_map["tab_order"] = tabOrderParsed
			}
		}
	}

	response_writer.Header().Set("Content-Type", "application/json")
	encode_error := json.NewEncoder(response_writer).Encode(response_map)
	if encode_error != nil {
		log.Printf("\033[31merror: encoding response: %v\033[0m", encode_error)
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "failed to encode response")
	}
}

func HandleUpdateOidsAndTableNames(w http.ResponseWriter, r *http.Request) {
	// Get the lazy request transaction opened by the pipeline transaction stage.
	tx, ok := dbutils.GetTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction missing")
		return
	}

	err := dtt_crud_workflows.UpdateOidsAndTableNamesWithBridge(tx)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("Error updating OID values and table names: %v", err))
		return
	}

	err = dtt_2_column_update.UpdateColumnMetadata(tx)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("Error updating column metadata: %v", err))
		return
	}

	fmt.Fprintf(w, "OID values, table names, and column metadata updated successfully.")
}

// UpdateTabOrderHandler saves a new tab display order for the active project folder.
// Accepts POST JSON body with either legacy entries {"dataset_name":"...","sort_order":1}
// or unified entries {"tab_id":"...","sort_order":1}.
// Only updates the folder where is_current_project = true.
func UpdateTabOrderHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var requestBody struct {
		TabOrder json.RawMessage `json:"tab_order"`
	}

	if err := json.NewDecoder(r.Body).Decode(&requestBody); err != nil {
		log.Printf("\033[31merror: invalid request body for update-tab-order: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Validate and normalize tab_order into unified format [{tab_id, sort_order}, ...].
	var parsedEntries []map[string]interface{}
	if err := json.Unmarshal(requestBody.TabOrder, &parsedEntries); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "tab_order must be valid JSON")
		return
	}

	normalizedEntries := make([]map[string]interface{}, 0, len(parsedEntries))
	for _, entry := range parsedEntries {
		var tabID string
		if tabIDValue, ok := entry["tab_id"].(string); ok && tabIDValue != "" {
			tabID = tabIDValue
		}
		if tabID == "" {
			if datasetNameValue, ok := entry["dataset_name"].(string); ok && datasetNameValue != "" {
				tabID = datasetNameValue
			}
		}
		if tabID == "" {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "each tab_order entry must include tab_id or dataset_name")
			return
		}

		sortOrderValue, sortOrderFound := entry["sort_order"]
		if !sortOrderFound {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "each tab_order entry must include sort_order")
			return
		}

		sortOrderFloat, ok := sortOrderValue.(float64)
		if !ok {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "sort_order must be a number")
			return
		}

		sortOrderInt := int(sortOrderFloat)
		if float64(sortOrderInt) != sortOrderFloat {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "sort_order must be an integer")
			return
		}

		normalizedEntries = append(normalizedEntries, map[string]interface{}{
			"tab_id":     tabID,
			"sort_order": sortOrderInt,
		})
	}

	normalizedJSON, marshalErr := json.Marshal(normalizedEntries)
	if marshalErr != nil {
		log.Printf("\033[31merror: failed to marshal normalized tab_order_json: %v\033[0m", marshalErr)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "failed to save tab order")
		return
	}

	result, err := backend.Db.Exec(`
		UPDATE system_table_folders
		SET tab_order_json = $1::jsonb
		WHERE is_current_project = true`,
		string(normalizedJSON))
	if err != nil {
		log.Printf("\033[31merror: failed to update tab_order_json: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "failed to save tab order")
		return
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		httpresponse.RespondWithError(w, http.StatusNotFound, "no active project folder found")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func GetColumnNameToIDMap(tableName string) (map[string]int, error) {
	query := `
        SELECT column_name, column_uid
        FROM system_column_details
        WHERE table_name = $1
    `
	rows, err := backend.Db.Query(query, tableName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	columnMap := make(map[string]int)
	for rows.Next() {
		var columnName string
		var columnID int
		if err := rows.Scan(&columnName, &columnID); err != nil {
			return nil, err
		}
		columnMap[columnName] = columnID
	}
	return columnMap, nil
}

// ( co_number = column order number )
func GetColumnIDsForTable(tableName string) ([]int, error) {
	query := `
        SELECT column_uid
        FROM system_column_details
        WHERE table_name = $1
        ORDER BY co_number
    `
	rows, err := backend.Db.Query(query, tableName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var columnIDs []int
	for rows.Next() {
		var columnID int
		if err := rows.Scan(&columnID); err != nil {
			return nil, err
		}
		columnIDs = append(columnIDs, columnID)
	}
	return columnIDs, nil
}
