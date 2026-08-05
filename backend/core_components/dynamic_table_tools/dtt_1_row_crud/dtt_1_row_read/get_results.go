// get_results.go
// Main HTTP handler for fetching dynamic table data.
// Bridges authentication, the dynamic query builder, and the formatted JSON response.
// Exists to orchestrate the full get-results pipeline from request to formatted rows.
package dtt_1_row_read

import (
	"easelect/backend/core_components/httpresponse"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	auth "easelect/backend/core_components/auth"
	"easelect/backend/core_components/dynamic_table_tools/dtt_2_column_crud/dtt_2_column_read"
	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
	e_sessions "easelect/backend/core_components/sessions"
)

// GetResultsHandlerWrapper ...
func GetResultsHandlerWrapper(w http.ResponseWriter, r *http.Request) {
	table_name := r.URL.Query().Get("dataset")
	if table_name == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "missing 'dataset' query parameter")
		return
	}
	GetResults(w, r)
}

func GetResults(response_writer http.ResponseWriter, request *http.Request) {
	table_name := request.URL.Query().Get("dataset")
	if table_name == "" {
		httpresponse.RespondWithError(response_writer, http.StatusBadRequest, "table name is missing")
		return
	}

	// 1. Hae user_id sessiosta
	userID, err := e_sessions.GetUserIDFromSession(request)
	if err != nil || userID <= 0 {
		httpresponse.RespondWithError(response_writer, http.StatusUnauthorized, "Unauthorized: login required")
		return
	}

	// 1b. Hae myös user_role sessiosta, valitse oikea DB.
	session, sessErr := e_sessions.GetOrCreateSession(nil, request)
	if sessErr != nil {
		log.Printf("\033[31merror: %s\033[0m\n", sessErr.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error fetching session")
		return
	}

	userRole, _ := session.Values["user_role"].(string)
	if userRole == "" {
		userRole = "guest"
	}

	// Valitaan oikea tietokantayhteys käyttäjän roolin perusteella
	currentDb := auth.GetDBForRole(userRole)
	readQuerier, err := getPilotReadQuerier(request.Context(), table_name, currentDb)
	if err != nil {
		log.Printf("\033[31merror: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error initializing pilot read transaction")
		return
	}

	// Varmistetaan, että dataset on olemassa (cached, 5 min TTL).
	var datasetExists bool
	if cached := getCachedDatasetExists(table_name); cached != nil {
		datasetExists = cached.exists
	} else {
		err = currentDb.QueryRow(
			"SELECT EXISTS (SELECT 1 FROM system_db_tables WHERE table_name = $1)",
			table_name,
		).Scan(&datasetExists)
		if err != nil {
			log.Printf("\033[31merror: %s\033[0m\n", err.Error())
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error checking table existence")
			return
		}
		setCachedDatasetExists(table_name, &existsCacheEntry{exists: datasetExists, cachedAt: time.Now()})
	}
	if !datasetExists {
		httpresponse.RespondWithError(response_writer, http.StatusNotFound, fmt.Sprintf("dataset %q not found", table_name))
		return
	}

	// 2. Haetaan results_per_load (cached, 5 min TTL).
	var results_per_load int
	if cached := getCachedConfig("results_load_amount"); cached != nil {
		results_per_load = cached.resultsPerLoad
	} else {
		var results_per_load_str string
		err = currentDb.QueryRow(
			"SELECT int_value FROM system_config WHERE key = 'results_load_amount'",
		).Scan(&results_per_load_str)
		if err != nil {
			log.Printf("\033[31merror: %s\033[0m\n", err.Error())
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error fetching configuration")
			return
		}
		results_per_load, err = strconv.Atoi(results_per_load_str)
		if err != nil {
			log.Printf("\033[31merror: %s\033[0m\n", err.Error())
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "invalid configuration value")
			return
		}
		setCachedConfig("results_load_amount", &configCacheEntry{resultsPerLoad: results_per_load, cachedAt: time.Now()})
	}

	offset_str := request.URL.Query().Get("offset")
	offset_value := 0
	if offset_str != "" {
		offset_value, err = strconv.Atoi(offset_str)
		if err != nil {
			log.Printf("\033[31merror: %s\033[0m\n", err.Error())
			httpresponse.RespondWithError(response_writer, http.StatusBadRequest, "invalid offset parameter")
			return
		}
	}

	// Parse optional row_count from client (skip COUNT(*) on scroll batches).
	clientRowCount := -1
	if rowCountParam := request.URL.Query().Get("row_count"); rowCountParam != "" {
		if parsed, parseErr := strconv.Atoi(rowCountParam); parseErr == nil && parsed >= 0 {
			clientRowCount = parsed
		}
	}

	// 3. Haetaan käyttäjän sarakeasetukset (cached, 2 min TTL).
	var userColumnSettings []UserColumnSetting
	if cached := getCachedUserColumnSettings(userID, table_name); cached != nil {
		userColumnSettings = cached.settings
	} else {
		userColumnSettings, err = fetchUserColumnSettingsOrDefaults(userID, table_name, currentDb)
		if err != nil {
			log.Printf("\033[31merror: %s\033[0m\n", err.Error())
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error fetching column settings")
			return
		}
		setCachedUserColumnSettings(userID, table_name, &ucsCacheEntry{settings: userColumnSettings, cachedAt: time.Now()})
	}

	// 3b. Haetaan sarakkeet, joihin roolilla on SELECT-oikeus (cached, 30 s TTL).
	var allowedColumns []string
	if cached := getCachedPermissions(userRole, table_name); cached != nil {
		allowedColumns = cached.columns
	} else {
		allowedColumns, err = fetchUserSelectableColumns(currentDb, table_name)
		if err != nil {
			log.Printf("\033[31merror: %s\033[0m\n", err.Error())
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error fetching column permissions")
			return
		}
		setCachedPermissions(userRole, table_name, &permCacheEntry{columns: allowedColumns, cachedAt: time.Now()})
	}

	allowedColumnsMap := make(map[string]bool, len(allowedColumns))
	for _, ac := range allowedColumns {
		allowedColumnsMap[ac] = true
	}

	// 4. Haetaan skeemametadata (cached, 5 min TTL, invalidated on DDL).
	var column_data_types map[string]interface{}
	var columnsMap map[int]dtt_models.ColumnInfo
	var tableMeta dtt_models.TableReadMeta
	var readPolicy ReadRowPolicy
	var geomCols []string
	var geomSrcs []string

	if cached := getCachedSchemaMetadata(table_name); cached != nil {
		column_data_types = cached.columnDataTypes
		columnsMap = cached.columnsMap
		tableMeta = cached.tableMeta
		readPolicy = cached.readPolicy
		geomCols = cached.geomCols
		geomSrcs = cached.geomSrcs
	} else {
		column_data_types, err = getColumnDataTypesWithFK(table_name, currentDb)
		if err != nil {
			log.Printf("\033[31merror: %s\033[0m\n", err.Error())
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error fetching column data types")
			return
		}

		columnsMap, err = dtt_2_column_read.GetColumnsMapForTable(table_name)
		if err != nil {
			log.Printf("\033[31merror: %s\033[0m\n", err.Error())
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error fetching column data")
			return
		}

		tableMeta, err = fetchTableReadMeta(currentDb, table_name)
		if err != nil {
			log.Printf("\033[31merror: %s\033[0m\n", err.Error())
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error fetching table metadata")
			return
		}

		readPolicy, err = getLegacyMustTrueReadPolicy(currentDb, table_name)
		if err != nil {
			log.Printf("\033[31merror: %s\033[0m\n", err.Error())
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error fetching row policy metadata")
			return
		}

		geomCols, err = getGeometryColumns(currentDb, table_name)
		if err != nil {
			log.Printf("\033[31merror: %s\033[0m\n", err.Error())
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error fetching geo columns")
			return
		}
		geomSrcs, err = getGeometrySourceTables(currentDb, table_name)
		if err != nil {
			log.Printf("\033[31merror: %s\033[0m\n", err.Error())
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error fetching geo sources")
			return
		}

		setCachedSchemaMetadata(table_name, &schemaCacheEntry{
			columnDataTypes: column_data_types,
			columnsMap:      columnsMap,
			tableMeta:       tableMeta,
			readPolicy:      readPolicy,
			geomCols:        geomCols,
			geomSrcs:        geomSrcs,
			cachedAt:        time.Now(),
		})
	}

	hasGeo := len(geomCols) > 0 || len(geomSrcs) > 0

	visibleColUids := make([]int, 0)
	visibleColumnNames := make([]string, 0, len(userColumnSettings))
	for _, cs := range userColumnSettings {
		if cs.IsHidden {
			continue
		}
		if !allowedColumnsMap[cs.ColumnName] {
			continue
		}
		visibleColumnNames = append(visibleColumnNames, cs.ColumnName)
		for uid, colInfo := range columnsMap {
			if colInfo.ColumnName == cs.ColumnName {
				visibleColUids = append(visibleColUids, uid)
				break
			}
		}
	}

	cardSupportColumnsLoadedWithMainQuery := []string(nil)
	if request.URL.Query().Get("include_card_support") == "1" {
		visibleColUids, cardSupportColumnsLoadedWithMainQuery = appendHiddenCardSupportColumnUIDs(
			columnsMap,
			visibleColumnNames,
			visibleColUids,
		)
	}

	// 6. Build and Execute Query
	ctx := QueryBuilderContext{
		DB:              readQuerier,
		TableName:       table_name,
		ColumnsMap:      columnsMap,
		VisibleColUIDs:  visibleColUids,
		QueryParams:     request.URL.Query(),
		ColumnDataTypes: column_data_types,
		ResultsPerLoad:  results_per_load,
		Offset:          offset_value,
		UserID:          userID,
		UserRole:        userRole,
		ReadPolicy:      readPolicy,
		ClientRowCount:  clientRowCount,
	}

	query, query_args, rowCount, err := BuildSelectQuery(ctx)
	if err != nil {
		log.Printf("\033[31merror: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error building query")
		return
	}

	rows_result, err := readQuerier.Query(query, query_args...)
	if err != nil {
		log.Printf("\033[31merror: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error fetching data")
		return
	}
	defer rows_result.Close()

	// 7. Process Results
	result_columns, query_results, err := FormatRowsToMaps(rows_result)
	if err != nil {
		log.Printf("\033[31merror: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error processing results")
		return
	}

	if err := enrichServiceCatalogModerationRows(readQuerier, table_name, query_results, userRole, userID); err != nil {
		log.Printf("\033[31merror: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error enriching service moderation data")
		return
	}
	result_columns = appendServiceCatalogModerationColumns(table_name, result_columns, query_results, userRole)

	if request.URL.Query().Get("include_card_support") == "1" {
		logCardSupportEnrichmentWarning(
			table_name,
			enrichRowsWithCardSupportColumns(
				readQuerier,
				table_name,
				query_results,
				columnsMap,
				result_columns,
			),
		)
	}
	if request.URL.Query().Get("include_map_support") == "1" {
		mapSupportColumns := filterAllowedGeometryColumns(geomCols, allowedColumnsMap)
		logMapSupportEnrichmentWarning(
			table_name,
			enrichRowsWithMapSupportColumns(readQuerier, table_name, query_results, mapSupportColumns),
		)
	}
	result_columns = filterCardSupportColumnsFromResultColumns(result_columns, cardSupportColumnsLoadedWithMainQuery)

	column_data_types = enrichServiceCatalogModerationDataTypes(table_name, column_data_types)

	// Kootaan vastaus
	response_data := map[string]interface{}{
		"columns":            result_columns,
		"data":               query_results,
		"types":              column_data_types,
		"table_meta":         tableMeta,
		"resultsPerLoad":     results_per_load,
		"userColumnSettings": userColumnSettings,
		"row_count":          rowCount,
		"has_geo":            hasGeo,
		"geom_columns":       geomCols,
		"geom_sources":       geomSrcs,
	}

	response_writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	if err := json.NewEncoder(response_writer).Encode(response_data); err != nil {
		log.Printf("\033[31merror: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error encoding response")
		return
	}
}
