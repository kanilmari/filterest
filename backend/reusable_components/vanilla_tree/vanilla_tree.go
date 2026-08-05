// vanilla_tree.go
// HTTP handler that builds the navigation tree data for the Easelect UI.
// Aggregates folders, tables, database views, and column details into a
// unified tree node structure, filtered by user access rights.

package vanilla_tree

import (
	"database/sql"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/httpresponse"
	e_sessions "easelect/backend/core_components/sessions"
	"easelect/backend/pipeline/access_control"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
)

// TreeNode edustaa puun solmua. db_id on varsinainen numeroinen ID tietokannassa.
// TableUID edustaa yksilöivää tunnistetta (UUID tms.),
// DefaultViewID on oletusnäkymän numeroinen ID, jos sellainen on tallennettu.
type TreeNode struct {
	ID                        string  `json:"id"`
	Name                      string  `json:"name"`
	ParentID                  string  `json:"parent_id"`
	DbID                      int     `json:"db_id"`
	TableUID                  string  `json:"table_uid,omitempty"`
	DisplayName               *string `json:"display_name,omitempty"`
	SearchSlogan              *string `json:"search_slogan,omitempty"`
	SearchPlaceholder         *string `json:"search_placeholder,omitempty"`
	IconKey                   *string `json:"icon_key,omitempty"`
	DefaultViewID             *int64  `json:"default_view_id,omitempty"`
	DefaultViewName           *string `json:"default_view_name,omitempty"`
	FilterbarVisibleByDefault *bool   `json:"filterbar_visible_by_default,omitempty"`
	IsCurrentProject          bool    `json:"is_current_project,omitempty"`
	IsView                    bool    `json:"is_view,omitempty"`
}

type folderTreeRow struct {
	ID               int
	Name             string
	ParentID         sql.NullInt64
	IsCurrentProject bool
}

// buildLegacyOtherTablesFolderRemap identifies erroneous root-level
// other_tables folders and maps them to the canonical database -> other_tables
// folder so the tree can hide the duplicate root node and merge its contents.
func buildLegacyOtherTablesFolderRemap(folderRows []folderTreeRow) map[int]int {
	databaseRootID := 0
	canonicalOtherTablesID := 0

	for _, row := range folderRows {
		if row.ParentID.Valid || !strings.EqualFold(strings.TrimSpace(row.Name), "database") {
			continue
		}
		databaseRootID = row.ID
		break
	}
	if databaseRootID == 0 {
		return nil
	}

	for _, row := range folderRows {
		if !row.ParentID.Valid || int(row.ParentID.Int64) != databaseRootID {
			continue
		}
		if strings.EqualFold(strings.TrimSpace(row.Name), "other_tables") {
			canonicalOtherTablesID = row.ID
			break
		}
	}
	if canonicalOtherTablesID == 0 {
		return nil
	}

	remap := make(map[int]int)
	for _, row := range folderRows {
		if row.ParentID.Valid || !strings.EqualFold(strings.TrimSpace(row.Name), "other_tables") {
			continue
		}
		if row.ID == canonicalOtherTablesID {
			continue
		}
		remap[row.ID] = canonicalOtherTablesID
	}
	if len(remap) == 0 {
		return nil
	}

	return remap
}

func findCanonicalOtherTablesFolderID(folderRows []folderTreeRow) sql.NullInt64 {
	databaseRootID := 0
	for _, row := range folderRows {
		if row.ParentID.Valid || !strings.EqualFold(strings.TrimSpace(row.Name), "database") {
			continue
		}
		databaseRootID = row.ID
		break
	}
	if databaseRootID == 0 {
		return sql.NullInt64{}
	}

	for _, row := range folderRows {
		if !row.ParentID.Valid || int(row.ParentID.Int64) != databaseRootID {
			continue
		}
		if strings.EqualFold(strings.TrimSpace(row.Name), "other_tables") {
			return sql.NullInt64{Int64: int64(row.ID), Valid: true}
		}
	}

	return sql.NullInt64{}
}

// remapFolderReference rewrites a direct parent/folder reference when it points
// at a legacy duplicate root folder that should appear under database -> other_tables.
func remapFolderReference(folderID sql.NullInt64, remap map[int]int) sql.NullInt64 {
	if !folderID.Valid || len(remap) == 0 {
		return folderID
	}

	normalizedID, ok := remap[int(folderID.Int64)]
	if !ok {
		return folderID
	}

	return sql.NullInt64{
		Int64: int64(normalizedID),
		Valid: true,
	}
}

func normalizeTableFolderReference(folderID sql.NullInt64, remap map[int]int, canonicalOtherTablesID sql.NullInt64) sql.NullInt64 {
	normalizedFolderID := remapFolderReference(folderID, remap)
	if normalizedFolderID.Valid {
		return normalizedFolderID
	}
	if canonicalOtherTablesID.Valid {
		return canonicalOtherTablesID
	}
	return normalizedFolderID
}

// GetTreeDataHandler hakee kansioiden ja taulujen tiedot puumaisesti
// sekä lisäksi kaikki rivit system_column_details-taulusta (SELECT c.*, t.table_name FROM ...).
// Koska 'SELECT *' on käytössä, käsitellään dataa dynaamisesti, jottei
// sarakeluetteloa tarvitse kovakoodata.
func GetTreeDataHandler(response_writer http.ResponseWriter, request *http.Request) {
	userID, sessionError := e_sessions.GetUserIDFromSession(request)
	if sessionError != nil || userID <= 0 {
		httpresponse.RespondWithError(response_writer, http.StatusUnauthorized, "unauthorized")
		return
	}

	visibleTableUIDs, visibilityError := access_control.GetTablesVisibleToUser(backend.Db, userID)
	if visibilityError != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", visibilityError.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "failed to fetch table-level permissions")
		return
	}

	folderRows, err := backend.Db.Query(
		`SELECT 
			id, 
			folder_name, 
			parent_id,
			is_current_project
		FROM system_table_folders
		ORDER BY id`)
	if err != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "failed to fetch folder data")
		return
	}
	defer folderRows.Close()

	var allNodes []TreeNode
	var folderNodes []folderTreeRow
	for folderRows.Next() {
		var folderID int
		var folderName string
		var folderParent sql.NullInt64
		var isCurrentProject bool

		if err := folderRows.Scan(&folderID, &folderName, &folderParent, &isCurrentProject); err != nil {
			fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error processing folder rows")
			return
		}

		folderNodes = append(folderNodes, folderTreeRow{
			ID:               folderID,
			Name:             folderName,
			ParentID:         folderParent,
			IsCurrentProject: isCurrentProject,
		})
	}
	if err := folderRows.Err(); err != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error processing folder rows")
		return
	}

	legacyFolderRemap := buildLegacyOtherTablesFolderRemap(folderNodes)
	canonicalOtherTablesFolderID := findCanonicalOtherTablesFolderID(folderNodes)
	for _, folderNode := range folderNodes {
		if _, skipDuplicateRoot := legacyFolderRemap[folderNode.ID]; skipDuplicateRoot {
			continue
		}

		parentFolderID := remapFolderReference(folderNode.ParentID, legacyFolderRemap)
		parentIDString := "null"
		if parentFolderID.Valid {
			parentIDString = fmt.Sprintf("f_%d", parentFolderID.Int64)
		}

		allNodes = append(allNodes, TreeNode{
			ID:               fmt.Sprintf("f_%d", folderNode.ID),
			Name:             folderNode.Name,
			ParentID:         parentIDString,
			DbID:             folderNode.ID,
			IsCurrentProject: folderNode.IsCurrentProject,
		})
	}

	tableRows, err := backend.Db.Query(
		`SELECT
                        t.id,
                        t.table_name,
                        t.table_uid,
                        t.folder_id,
						t.display_name,
						t.search_slogan,
						t.search_placeholder,
						t.icon_key,
                        t.default_view_id,
                        v.name,
                        t.filterbar_visible_by_default
               FROM system_db_tables t
               LEFT JOIN system_table_views v ON t.default_view_id = v.id
               ORDER BY t.table_name`)
	if err != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "failed to fetch table data")
		return
	}
	defer tableRows.Close()

	for tableRows.Next() {
		var tableID int
		var tableName string
		var tableUID int
		var folderID sql.NullInt64
		var displayName sql.NullString
		var searchSlogan sql.NullString
		var searchPlaceholder sql.NullString
		var iconKey sql.NullString
		var defaultViewID sql.NullInt64
		var defaultViewName sql.NullString
		var filterbarDefault sql.NullBool

		if err := tableRows.Scan(
			&tableID,
			&tableName,
			&tableUID,
			&folderID,
			&displayName,
			&searchSlogan,
			&searchPlaceholder,
			&iconKey,
			&defaultViewID,
			&defaultViewName,
			&filterbarDefault,
		); err != nil {
			fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error processing table rows")
			return
		}
		if !backend.ShouldExposeCloudManagementDatasetName(tableName) {
			continue
		}
		if visibleTableUIDs != nil && !visibleTableUIDs[tableUID] {
			continue
		}

		folderID = normalizeTableFolderReference(folderID, legacyFolderRemap, canonicalOtherTablesFolderID)
		parentIDString := "null"
		if folderID.Valid {
			parentIDString = fmt.Sprintf("f_%d", folderID.Int64)
		}

		node := TreeNode{
			ID:       "t_" + tableName,
			Name:     tableName,
			ParentID: parentIDString,
			DbID:     tableID,
			TableUID: fmt.Sprintf("%d", tableUID),
		}
		if displayName.Valid {
			node.DisplayName = &displayName.String
		}
		if searchSlogan.Valid {
			node.SearchSlogan = &searchSlogan.String
		}
		if searchPlaceholder.Valid {
			node.SearchPlaceholder = &searchPlaceholder.String
		}
		if iconKey.Valid {
			node.IconKey = &iconKey.String
		}
		if defaultViewID.Valid {
			node.DefaultViewID = &defaultViewID.Int64
		}
		if defaultViewName.Valid {
			node.DefaultViewName = &defaultViewName.String
		}
		if filterbarDefault.Valid {
			node.FilterbarVisibleByDefault = &filterbarDefault.Bool
		}

		allNodes = append(allNodes, node)
	}
	if err := tableRows.Err(); err != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error processing table rows")
		return
	}

	// Luodaan juuritason kansio tietokannan näkymille
	viewsRootID := "views_root"
	allNodes = append(allNodes, TreeNode{
		ID:       viewsRootID,
		Name:     "views",
		ParentID: "null",
		DbID:     -1,
	})

	// Haetaan kaikki public-skeeman näkymät
	viewRows, err := backend.Db.Query(`
                SELECT v.table_name, sdt.table_uid
                FROM information_schema.views v
                LEFT JOIN system_db_tables sdt ON sdt.table_name = v.table_name
                WHERE v.table_schema = 'public'
                ORDER BY v.table_name`)
	if err != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "failed to fetch view data")
		return
	}
	defer viewRows.Close()

	for viewRows.Next() {
		var viewName string
		var viewTableUID sql.NullInt64
		if err := viewRows.Scan(&viewName, &viewTableUID); err != nil {
			fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error processing view rows")
			return
		}
		if !backend.ShouldExposeCloudManagementDatasetName(viewName) {
			continue
		}
		if visibleTableUIDs != nil {
			if !viewTableUID.Valid || !visibleTableUIDs[int(viewTableUID.Int64)] {
				continue
			}
		}

		allNodes = append(allNodes, TreeNode{
			ID:       "v_" + viewName,
			Name:     viewName,
			ParentID: viewsRootID,
			DbID:     -1,
			IsView:   true,
		})
	}
	if err := viewRows.Err(); err != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error processing view rows")
		return
	}
	// Haetaan dynaamisesti kaikki sarakkeet system_column_details-taulusta ja
	// liitetään myös table_name-jäljelle:
	detailsRows, err := backend.Db.Query(
		`SELECT c.*, t.table_name
		FROM system_column_details c
		LEFT JOIN system_db_tables t ON c.table_uid = t.table_uid
		ORDER BY c.table_uid, c.co_number`)
	if err != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "failed to fetch column details")
		return
	}
	defer detailsRows.Close()

	// Kyselyn sarakenimet
	resultColumns, err := detailsRows.Columns()
	if err != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error fetching column names")
		return
	}
	tableUIDColumnIndex := -1
	tableNameColumnIndex := -1
	for index, columnName := range resultColumns {
		if columnName == "table_uid" {
			tableUIDColumnIndex = index
		}
		if columnName == "table_name" {
			tableNameColumnIndex = index
		}
	}

	var allColumnDetails []map[string]interface{}

	for detailsRows.Next() {
		// Varataan paikka jokaiselle sarakkeelle
		rowValues := make([]interface{}, len(resultColumns))
		rowPointers := make([]interface{}, len(resultColumns))
		for i := range rowValues {
			rowPointers[i] = &rowValues[i]
		}

		// Luetaan rivin arvot
		if err := detailsRows.Scan(rowPointers...); err != nil {
			fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error processing column detail rows")
			return
		}
		if visibleTableUIDs != nil && tableUIDColumnIndex >= 0 {
			tableUID, ok := toInt(rowValues[tableUIDColumnIndex])
			if !ok || !visibleTableUIDs[tableUID] {
				continue
			}
		}
		if tableNameColumnIndex >= 0 {
			tableName, ok := toString(rowValues[tableNameColumnIndex])
			if ok && !backend.ShouldExposeCloudManagementDatasetName(tableName) {
				continue
			}
		}

		// Luodaan map sarakkenimi -> arvo
		currentRow := make(map[string]interface{})
		for index, columnName := range resultColumns {
			val := rowValues[index]
			switch typedVal := val.(type) {
			case []byte:
				currentRow[columnName] = string(typedVal)
			default:
				currentRow[columnName] = typedVal
			}
		}
		allColumnDetails = append(allColumnDetails, currentRow)
	}
	if err := detailsRows.Err(); err != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error processing column detail rows")
		return
	}

	// Kootaan vastaus
	responseData := map[string]interface{}{
		"nodes":          allNodes,
		"column_details": allColumnDetails,
	}

	response_writer.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(response_writer).Encode(responseData); err != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error encoding JSON")
		return
	}
}

func toInt(value interface{}) (int, bool) {
	switch typedValue := value.(type) {
	case int:
		return typedValue, true
	case int32:
		return int(typedValue), true
	case int64:
		return int(typedValue), true
	case float64:
		return int(typedValue), true
	case []byte:
		parsedValue, parseError := strconv.Atoi(string(typedValue))
		if parseError != nil {
			return 0, false
		}
		return parsedValue, true
	case string:
		parsedValue, parseError := strconv.Atoi(typedValue)
		if parseError != nil {
			return 0, false
		}
		return parsedValue, true
	default:
		return 0, false
	}
}

func toString(value interface{}) (string, bool) {
	switch typedValue := value.(type) {
	case string:
		return typedValue, true
	case []byte:
		return string(typedValue), true
	default:
		return "", false
	}
}
