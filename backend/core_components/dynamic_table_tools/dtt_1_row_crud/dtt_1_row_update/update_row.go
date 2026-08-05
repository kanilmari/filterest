// update_row.go
// HTTP handler for updating one or more editable values in a dynamic table row.
// Bridges the frontend inline-edit request, column validation, and the database UPDATE path.
// Exists to validate editability, convert types, handle renames, and refresh search vectors.

package dtt_1_row_update

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"easelect/backend/core_components/dataset_routes"
	dbutils "easelect/backend/core_components/dbutils"
	ai_features "easelect/backend/core_components/dynamic_table_tools/ai_features"
	dtt_1_row_read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	dtt_asset_linking "easelect/backend/core_components/dynamic_table_tools/dtt_asset_linking"
	dtt_search_vectors "easelect/backend/core_components/dynamic_table_tools/search_vectors"
	"easelect/backend/core_components/event_bus"
	"easelect/backend/core_components/httpresponse"
	lang "easelect/backend/core_components/lang"
	security "easelect/backend/core_components/security"
	e_sessions "easelect/backend/core_components/sessions"

	"github.com/lib/pq"
	pgvector "github.com/pgvector/pgvector-go"
)

// UpdateRowHandlerWrapper vain lukee ?dataset= -parametrin ja kutsuu varsinaista käsittelijää
func UpdateRowHandlerWrapper(response_writer http.ResponseWriter, request *http.Request) {
	tableName := request.URL.Query().Get("dataset")
	if tableName == "" {
		httpresponse.RespondWithError(response_writer, http.StatusBadRequest, "Missing ?dataset= parameter")
		return
	}
	UpdateRowHandler(response_writer, request, tableName)
}

type updateRowFieldUpdate struct {
	Column string      `json:"column"`
	Value  interface{} `json:"value"`
}

type updateRowRequest struct {
	ID      int64                  `json:"id"`
	Column  string                 `json:"column"`
	Value   interface{}            `json:"value"`
	Updates []updateRowFieldUpdate `json:"updates"`
}

func normalizeUpdateOperations(request updateRowRequest) ([]updateRowFieldUpdate, error) {
	if request.ID == 0 {
		return nil, errors.New("ID is required")
	}

	normalized := make([]updateRowFieldUpdate, 0, len(request.Updates)+1)
	if trimmedColumn := strings.TrimSpace(request.Column); trimmedColumn != "" {
		normalized = append(normalized, updateRowFieldUpdate{
			Column: trimmedColumn,
			Value:  request.Value,
		})
	}

	for _, update := range request.Updates {
		trimmedColumn := strings.TrimSpace(update.Column)
		if trimmedColumn == "" {
			return nil, errors.New("Column is required")
		}
		normalized = append(normalized, updateRowFieldUpdate{
			Column: trimmedColumn,
			Value:  update.Value,
		})
	}

	if len(normalized) == 0 {
		return nil, errors.New("at least one update is required")
	}
	return normalized, nil
}

// UpdateRowHandler hoitaa tietokantarivin päivityksen
func UpdateRowHandler(response_writer http.ResponseWriter, request *http.Request, tableName string) {
	if request.Method != http.MethodPost {
		httpresponse.RespondWithError(response_writer, http.StatusMethodNotAllowed, "Only POST requests are allowed")
		return
	}

	// 1. Hae user_id sessiosta
	userID, err := e_sessions.GetUserIDFromSession(request)
	if err != nil || userID <= 0 {
		httpresponse.RespondWithError(response_writer, http.StatusUnauthorized, "Unauthorized: login required")
		return
	}
	userRole := getSessionUserRoleOrGuest(request)
	currentUsername := getSessionUsernameOrUnknown(request)

	// Puretaan update-pyynnön data
	var updateRequest updateRowRequest
	if err := json.NewDecoder(request.Body).Decode(&updateRequest); err != nil {
		log.Printf("\033[31merror: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusBadRequest, "Invalid request data")
		return
	}

	updates, err := normalizeUpdateOperations(updateRequest)
	if err != nil {
		httpresponse.RespondWithError(response_writer, http.StatusBadRequest, err.Error())
		return
	}

	tx, ok := dbutils.GetTx(request.Context())
	if !ok {
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "transaction not found")
		return
	}
	rowVisible, err := dtt_1_row_read.LockRowsVisibleForMutation(
		tx,
		tableName,
		userRole,
		userID,
		[]int64{updateRequest.ID},
	)
	if err != nil {
		log.Printf("\033[31merror: mutation row visibility check for %s id %d: %v\033[0m\n", tableName, updateRequest.ID, err)
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "Error checking row permissions")
		return
	}
	if !rowVisible {
		httpresponse.RespondWithError(response_writer, http.StatusForbidden, "Row is not editable by the current actor")
		return
	}

	// Hae table_uid
	tableUID, err := getTableUID(tableName, tx)
	if err != nil {
		log.Printf("\033[31merror: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "Error fetching table information")
		return
	}

	changedFields := make([]string, 0, len(updates))
	for _, update := range updates {
		// Tarkista, onko sarake sallittu muokattavaksi
		editable, err := isColumnEditable(tableUID, update.Column, tx)
		if err != nil {
			log.Printf("\033[31merror: %s\033[0m\n", err.Error())
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "Error checking column permissions")
			return
		}
		if !editable {
			httpresponse.RespondWithError(response_writer, http.StatusForbidden, "Column is not editable")
			return
		}
		if err := enforcePilotUpdateColumn(tableName, userRole, update.Column); err != nil {
			var fe *forbiddenError
			if errors.As(err, &fe) {
				httpresponse.RespondWithError(response_writer, http.StatusForbidden, fe.msg)
				return
			}
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "Error validating pilot update column")
			return
		}

		// Selvitetään sarakkeen tietotyyppi
		dataType, err := getColumnDataType(tableName, update.Column, tx)
		if err != nil {
			log.Printf("\033[31merror: %s\033[0m\n", err.Error())
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "Error fetching column datatype")
			return
		}

		// Muunnetaan arvo sen tietotyypin mukaisesti
		value, err := convertValue(update.Value, dataType)
		if err != nil {
			log.Printf("\033[31merror: %s\033[0m\n", err.Error())
			httpresponse.RespondWithError(response_writer, http.StatusBadRequest, "Invalid value type")
			return
		}

		// Erikoistapaus: jos system_db_tables.table_name muuttuu,
		// vaihdetaan myös varsinaisen taulun nimi tietokannassa
		if tableName == "system_db_tables" && update.Column == "table_name" {
			var oldName string
			if err := tx.QueryRow(
				"SELECT table_name FROM system_db_tables WHERE id = $1",
				updateRequest.ID,
			).Scan(&oldName); err == nil {
				if newName, ok := value.(string); ok && oldName != newName {
					sanitized, serr := security.SanitizeIdentifier(newName)
					if serr != nil {
						httpresponse.RespondWithError(response_writer, http.StatusBadRequest, serr.Error())
						return
					}
					if err := dataset_routes.ValidateDatasetRouteAvailability(tx, sanitized, int(updateRequest.ID)); err != nil {
						var conflictErr *dataset_routes.RouteConflictError
						if errors.As(err, &conflictErr) {
							httpresponse.RespondWithError(response_writer, http.StatusConflict, conflictErr.Error())
							return
						}
						log.Printf("\033[31merror: dataset route availability check: %v\033[0m", err)
						httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "Error checking dataset route availability")
						return
					}
					renameQuery := fmt.Sprintf(
						"ALTER TABLE %s RENAME TO %s",
						pq.QuoteIdentifier(oldName),
						pq.QuoteIdentifier(sanitized),
					)
					if _, err := tx.Exec(renameQuery); err != nil {
						log.Printf("\033[31merror: renaming table %s to %s: %v\033[0m", oldName, sanitized, err)
						httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "Error renaming table")
						return
					}

					// Update lang key sources and descriptions to reflect the new table name.
					if cleanErr := lang.UpdateLangKeySourcesForTableRename(tx, oldName, sanitized); cleanErr != nil {
						log.Printf("[UpdateRow] warning: lang key source update for table rename %s→%s: %v",
							oldName, sanitized, cleanErr)
					}
				}
			}
		}

		// Rakennetaan UPDATE-lause
		query := fmt.Sprintf("UPDATE %s SET %s = $1 WHERE id = $2",
			pq.QuoteIdentifier(tableName),
			pq.QuoteIdentifier(update.Column),
		)

		// Suoritetaan kysely oikeaa DB-yhteyttä vasten
		result, err := tx.Exec(query, value, updateRequest.ID)
		if err != nil {
			log.Printf("\033[31merror: %s\033[0m\n", err.Error())
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "Error updating row")
			return
		}
		if err := enforcePilotUpdatedRows(tableName, result); err != nil {
			var fe *forbiddenError
			if errors.As(err, &fe) {
				httpresponse.RespondWithError(response_writer, http.StatusForbidden, fe.msg)
				return
			}
			log.Printf("\033[31merror: %s\033[0m\n", err.Error())
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "Error verifying row update")
			return
		}
		if tableName == "system_db_tables" && (update.Column == "card_details_layout" || update.Column == "card_style_variant") {
			var targetTableName string
			if err := tx.QueryRow(
				"SELECT table_name FROM system_db_tables WHERE id = $1",
				updateRequest.ID,
			).Scan(&targetTableName); err != nil {
				log.Printf("[UpdateRow] warning: card_details_layout cache invalidation lookup failed for row id %d: %v", updateRequest.ID, err)
			} else if strings.TrimSpace(targetTableName) != "" {
				dtt_1_row_read.InvalidateSchemaCache(targetTableName)
			}
		}
		changedFields = append(changedFields, update.Column)
	}
	lang.EnsureLangKeySourceForCRUDMutationTx(tx, tableName, updateRequest.ID, currentUsername)

	if err := dtt_search_vectors.RefreshRowSearchVector(request.Context(), tx, tableName, updateRequest.ID); err != nil {
		log.Printf("\033[31merror: refresh search vector for %s id %d: %v\033[0m", tableName, updateRequest.ID, err)
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "Error updating search vector")
		return
	}

	cacheSyncPlan, err := dtt_asset_linking.CollectSharedAssetParentCacheSyncPlan(tx, tableName, []int64{updateRequest.ID})
	if err != nil {
		log.Printf("\033[31merror: collect shared asset cache sync plan for %s id %d: %v\033[0m", tableName, updateRequest.ID, err)
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "Error collecting shared asset cache sync plan")
		return
	}
	if err := dtt_asset_linking.ResyncSharedAssetParentCache(tx, cacheSyncPlan); err != nil {
		log.Printf("\033[31merror: resync shared asset cache for %s id %d: %v\033[0m", tableName, updateRequest.ID, err)
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "Error syncing shared asset cache")
		return
	}

	eventToPublish := event_bus.Event{
		Table:         tableName,
		RowID:         updateRequest.ID,
		Action:        "update",
		ChangedFields: append([]string(nil), changedFields...),
	}
	if !dbutils.RegisterAfterCommitHook(request.Context(), func() {
		event_bus.Bus.Publish(tableName, eventToPublish)
	}) {
		// Non-lazy test/tool contexts publish immediately as a fallback.
		event_bus.Bus.Publish(tableName, eventToPublish)
	}

	// Palautetaan vastaus
	response_writer.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(response_writer).Encode(map[string]string{
		"message": "Row updated successfully",
	})
}

func getSessionUserRoleOrGuest(request *http.Request) string {
	session, err := e_sessions.GetOrCreateSession(nil, request)
	if err != nil || session == nil {
		return "guest"
	}
	userRole, _ := session.Values["user_role"].(string)
	if strings.TrimSpace(userRole) == "" {
		return "guest"
	}
	return userRole
}

// getTableUID hakee system_db_tables-taulusta table_uid:in
type queryer interface {
	QueryRow(query string, args ...interface{}) *sql.Row
}

type queryExecer interface {
	Exec(query string, args ...interface{}) (sql.Result, error)
	QueryRow(query string, args ...interface{}) *sql.Row
	Query(query string, args ...interface{}) (*sql.Rows, error)
}

func getTableUID(tableName string, q queryer) (int, error) {
	var tableUID int
	query := `
		SELECT table_uid
		FROM system_db_tables
		WHERE table_name = $1
	`
	err := q.QueryRow(query, tableName).Scan(&tableUID)
	if err != nil {
		return 0, err
	}
	return tableUID, nil
}

// isColumnEditable katsoo, onko ko. sarakkeen editable_in_ui = true
func isColumnEditable(tableUID int, columnName string, q queryer) (bool, error) {
	var editable bool
	query := `
		SELECT editable_in_ui
		FROM system_column_details
		WHERE table_uid = $1 AND column_name = $2
	`
	err := q.QueryRow(query, tableUID, columnName).Scan(&editable)
	if err != nil {
		return false, err
	}
	return editable, nil
}

// getColumnDataType hakee sarakkeen data_type:n information_schemasta
func getColumnDataType(tableName, columnName string, q queryer) (string, error) {
	var dataType string
	query := `
		SELECT data_type
		FROM information_schema.columns
		WHERE table_name = $1
		  AND column_name = $2
		  AND table_schema = 'public'
	`
	err := q.QueryRow(query, tableName, columnName).Scan(&dataType)
	if err != nil {
		return "", err
	}
	return dataType, nil
}

func getSessionUsernameOrUnknown(request *http.Request) string {
	session, err := e_sessions.GetOrCreateSession(nil, request)
	if err != nil || session == nil {
		return "unknown"
	}

	rawUsername, ok := session.Values["username"]
	if !ok {
		return "unknown"
	}

	username, ok := rawUsername.(string)
	if !ok {
		return "unknown"
	}

	trimmedUsername := strings.TrimSpace(username)
	if trimmedUsername == "" {
		return "unknown"
	}

	return trimmedUsername
}

// convertValue muuntaa pyynnön arvon sarakkeen data_type:n perusteella
func convertValue(value interface{}, dataType string) (interface{}, error) {
	normalizedDataType := strings.ToLower(strings.TrimSpace(dataType))
	switch {
	case strings.Contains(normalizedDataType, "integer"), strings.Contains(normalizedDataType, "bigint"), strings.Contains(normalizedDataType, "smallint"):
		// Sallitaan float64 ja string
		var intValue int64
		switch v := value.(type) {
		case float64:
			intValue = int64(v)
		case string:
			trimmed := strings.TrimSpace(v)
			if trimmed == "" {
				intValue = 0
			} else {
				parsedInt, err := strconv.ParseInt(trimmed, 10, 64)
				if err != nil {
					return nil, fmt.Errorf("invalid integer value")
				}
				intValue = parsedInt
			}
		default:
			return nil, fmt.Errorf("invalid integer value")
		}
		return intValue, nil

	case strings.Contains(normalizedDataType, "boolean"):
		boolValue, ok := value.(bool)
		if !ok {
			return nil, fmt.Errorf("invalid boolean value")
		}
		return boolValue, nil

	case strings.Contains(normalizedDataType, "character varying"), strings.Contains(normalizedDataType, "text"):
		strValue, ok := value.(string)
		if !ok {
			return nil, fmt.Errorf("invalid string value")
		}
		return strValue, nil

	case normalizedDataType == "date":
		strValue, ok := value.(string)
		if !ok {
			return nil, fmt.Errorf("invalid date value")
		}
		strValue = strings.ReplaceAll(strings.TrimSpace(strValue), "/", "-")
		parsedDate, err := time.Parse("2006-01-02", strValue)
		if err != nil {
			return nil, fmt.Errorf("invalid date format")
		}
		return parsedDate.Format("2006-01-02"), nil

	case strings.Contains(normalizedDataType, "timestamp with time zone"), strings.Contains(normalizedDataType, "timestamptz"):
		strValue, ok := value.(string)
		if !ok {
			return nil, fmt.Errorf("invalid timestamp with time zone value")
		}
		normalizedValue := strings.TrimSpace(strValue)
		if len(normalizedValue) > 10 && normalizedValue[10] == ' ' {
			normalizedValue = normalizedValue[:10] + "T" + normalizedValue[11:]
		}
		parsedInstant, err := time.Parse(time.RFC3339Nano, normalizedValue)
		if err != nil {
			return nil, fmt.Errorf("timestamp with time zone requires an explicit RFC3339 offset")
		}
		return parsedInstant.UTC(), nil

	case strings.Contains(normalizedDataType, "timestamp"):
		strValue, ok := value.(string)
		if !ok {
			return nil, fmt.Errorf("invalid timestamp value")
		}
		normalizedValue := strings.ReplaceAll(strings.TrimSpace(strValue), "/", "-")
		layouts := []string{
			"2006-01-02",
			"2006-01-02 15:04",
			"2006-01-02 15:04:05.999999999",
			"2006-01-02T15:04",
			"2006-01-02T15:04:05.999999999",
		}
		for _, layout := range layouts {
			if parsedTimestamp, err := time.Parse(layout, normalizedValue); err == nil {
				return parsedTimestamp.Format("2006-01-02 15:04:05.999999999"), nil
			}
		}
		return nil, fmt.Errorf("invalid timestamp format")

	case strings.Contains(normalizedDataType, "numeric"), strings.Contains(normalizedDataType, "decimal"):
		var floatValue float64
		switch v := value.(type) {
		case float64:
			floatValue = v
		case string:
			parsedFloat, err := strconv.ParseFloat(v, 64)
			if err != nil {
				return nil, fmt.Errorf("invalid numeric value")
			}
			floatValue = parsedFloat
		default:
			return nil, fmt.Errorf("invalid numeric value")
		}
		return floatValue, nil

	default:
		// Jos ei osuta mihinkään, palautetaan sellaisenaan
		return value, nil
	}
}

// tableHasLangEmbeddings checks multi_lang_embeddings flag for the table.
func tableHasLangEmbeddings(tableName string, q queryer) bool {
	var flag bool
	err := q.QueryRow(`SELECT multi_lang_embeddings FROM system_db_tables WHERE table_name = $1`, tableName).Scan(&flag)
	if err != nil {
		return false
	}
	return flag
}

// generateLangEmbeddingsForRow creates embeddings for the row and stores them in <table>_lang_embeddings.
func generateLangEmbeddingsForRow(q queryExecer, tableName string, rowID int64, langs []string) error {
	var hostUpdated time.Time
	err := q.QueryRow(fmt.Sprintf(`SELECT updated FROM %s WHERE id=$1`, pq.QuoteIdentifier(tableName)), rowID).Scan(&hostUpdated)
	if err != nil {
		return err
	}

	embTable := pq.QuoteIdentifier(tableName + "_lang_embeddings")
	rows, err := q.Query(fmt.Sprintf(`SELECT language_code, updated FROM %s WHERE host_row_id=$1`, embTable), rowID)
	if err == nil {
		existing := make(map[string]time.Time)
		for rows.Next() {
			var code string
			var upd time.Time
			if err := rows.Scan(&code, &upd); err == nil {
				existing[code] = upd
			}
		}
		_ = rows.Err() // non-critical: best-effort prefetch of existing embeddings
		var need []string
		for _, l := range langs {
			if u, ok := existing[l]; !ok || u.Before(hostUpdated) {
				need = append(need, l)
			}
		}
		langs = need
	}

	if len(langs) == 0 {
		return nil
	}
	textCols, err := dbutils.GetQueryableColumns(tableName, q, true)
	if err != nil {
		return err
	}
	if len(textCols) == 0 {
		return nil
	}

	selectCols := strings.Join(textCols, ", ")
	row := q.QueryRow(fmt.Sprintf(`SELECT %s FROM %s WHERE id=$1`, selectCols, pq.QuoteIdentifier(tableName)), rowID)
	data := make([]interface{}, len(textCols))
	ptrs := make([]interface{}, len(textCols))
	for i := range data {
		ptrs[i] = &data[i]
	}
	if err := row.Scan(ptrs...); err != nil {
		return err
	}

	var parts []string
	for i := range textCols {
		if data[i] != nil {
			s := strings.TrimSpace(fmt.Sprintf("%v", data[i]))
			if s != "" {
				parts = append(parts, s)
			}
		}
	}
	joined := strings.Join(parts, " / ")
	if strings.TrimSpace(joined) == "" {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	embedding, err := ai_features.GenerateEmbedding(ctx, joined)
	if err != nil || len(embedding) == 0 {
		return err
	}
	vec := pgvector.NewVector(embedding)

	for _, lang := range langs {
		del := fmt.Sprintf(`DELETE FROM %s WHERE host_row_id=$1 AND language_code=$2`, embTable)
		if _, delErr := q.Exec(del, rowID, lang); delErr != nil {
			log.Printf("[upsertRowEmbedding] warning: failed to delete old embedding for row %v lang %s: %v", rowID, lang, delErr)
		}
		ins := fmt.Sprintf(`INSERT INTO %s (host_row_id, language_code, embedding, updated) VALUES ($1,$2,$3,NOW())`, embTable)
		if _, insErr := q.Exec(ins, rowID, lang, vec); insErr != nil {
			log.Printf("[upsertRowEmbedding] warning: failed to insert embedding for row %v lang %s: %v", rowID, lang, insErr)
		}
	}
	return nil
}
