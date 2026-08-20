// symbol_registry_handler.go
// Serves safe SVG symbols and the administrator-owned metadata assignment API.
// Bridges the filesystem registry, dataset/field metadata tables, and browser symbol pickers.
// Exists to keep raw SVG and arbitrary paths outside database writes and frontend HTML injection.
package symbol_registry

import (
	"database/sql"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	dtt_1_row_read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	"easelect/backend/core_components/httpresponse"
	"encoding/json"
	"log"
	"net/http"
	"strings"
)

type datasetAssignment struct {
	TableUID int    `json:"table_uid"`
	Dataset  string `json:"dataset_name"`
	Display  string `json:"display_name"`
	IconKey  string `json:"icon_key"`
}

type fieldAssignment struct {
	ColumnUID  int    `json:"column_uid"`
	TableUID   int    `json:"table_uid"`
	Dataset    string `json:"dataset_name"`
	ColumnName string `json:"column_name"`
	IconKey    string `json:"icon_key"`
}

type adminSnapshot struct {
	Symbols  []Symbol            `json:"symbols"`
	Datasets []datasetAssignment `json:"datasets"`
	Fields   []fieldAssignment   `json:"fields"`
}

type assignmentRequest struct {
	TargetType string `json:"target_type"`
	TargetUID  int    `json:"target_uid"`
	IconKey    string `json:"icon_key"`
}

// AssetHandler serves a validated SVG and uses the table icon for stale or unknown keys.
func AssetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	fileName := strings.TrimPrefix(r.URL.Path, "/symbol-assets/")
	if strings.Contains(fileName, "/") || strings.ToLower(filepathExtension(fileName)) != ".svg" {
		httpresponse.RespondWithError(w, http.StatusNotFound, "symbol not found")
		return
	}
	key := strings.TrimSuffix(fileName, filepathExtension(fileName))
	content, resolvedKey, err := Read(key)
	if err != nil {
		log.Printf("\033[31merror: [symbol_registry.AssetHandler] %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusNotFound, "symbol not found")
		return
	}
	w.Header().Set("Content-Type", "image/svg+xml; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'none'; sandbox")
	w.Header().Set("X-Resolved-Symbol-Key", resolvedKey)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(content)
}

// AdminHandler lists safe symbols and assigns one icon key to one dataset or field.
func AdminHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		serveAdminSnapshot(w)
	case http.MethodPost:
		assignSymbol(w, r)
	default:
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func serveAdminSnapshot(w http.ResponseWriter) {
	symbols, err := List()
	if err != nil {
		log.Printf("\033[31merror: [symbol_registry.AdminHandler] list symbols: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error reading symbol registry")
		return
	}
	datasets, fields, err := readAssignments(backend.Db)
	if err != nil {
		log.Printf("\033[31merror: [symbol_registry.AdminHandler] read assignments: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error reading symbol assignments")
		return
	}
	httpresponse.RespondWithJSON(w, http.StatusOK, adminSnapshot{Symbols: symbols, Datasets: datasets, Fields: fields})
}

func assignSymbol(w http.ResponseWriter, r *http.Request) {
	var request assignmentRequest
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	request.TargetType = strings.ToLower(strings.TrimSpace(request.TargetType))
	request.IconKey = strings.ToLower(strings.TrimSpace(request.IconKey))
	if request.TargetUID <= 0 || (request.TargetType != "dataset" && request.TargetType != "field") {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "target_type and target_uid are required")
		return
	}
	if request.IconKey != "" && !Contains(request.IconKey) {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "icon_key is not in the safe symbol registry")
		return
	}

	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction start failed")
		return
	}
	var result sql.Result
	var err error
	if request.TargetType == "dataset" {
		result, err = tx.Exec(`
			UPDATE public.system_db_tables
			SET icon_key = NULLIF($1, ''), updated = now()
			WHERE table_uid = $2
		`, request.IconKey, request.TargetUID)
	} else {
		result, err = tx.Exec(`
			UPDATE public.system_column_details
			SET card_detail_icon_key = NULLIF($1, ''), updated = now()
			WHERE column_uid = $2
		`, request.IconKey, request.TargetUID)
	}
	if err != nil {
		log.Printf("\033[31merror: [symbol_registry.AdminHandler] assign %s %d: %v\033[0m", request.TargetType, request.TargetUID, err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error saving symbol assignment")
		return
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil || rowsAffected != 1 {
		httpresponse.RespondWithError(w, http.StatusNotFound, "symbol assignment target not found")
		return
	}
	if request.TargetType == "field" {
		if datasetName := readFieldDatasetName(tx, request.TargetUID); datasetName != "" {
			dbutils.RegisterAfterCommitHook(r.Context(), func() {
				dtt_1_row_read.InvalidateSchemaCache(datasetName)
			})
		}
	}
	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]interface{}{
		"status": "ok", "target_type": request.TargetType,
		"target_uid": request.TargetUID, "icon_key": request.IconKey,
	})
}

func readAssignments(queryer dbutils.Querier) ([]datasetAssignment, []fieldAssignment, error) {
	datasetRows, err := queryer.Query(`
		SELECT table_uid, table_name, COALESCE(NULLIF(display_name, ''), table_name), COALESCE(icon_key, '')
		FROM public.system_db_tables
		ORDER BY COALESCE(NULLIF(display_name, ''), table_name), table_uid
	`)
	if err != nil {
		return nil, nil, err
	}
	defer datasetRows.Close()
	datasets := make([]datasetAssignment, 0)
	for datasetRows.Next() {
		var item datasetAssignment
		if err := datasetRows.Scan(&item.TableUID, &item.Dataset, &item.Display, &item.IconKey); err != nil {
			return nil, nil, err
		}
		datasets = append(datasets, item)
	}
	if err := datasetRows.Err(); err != nil {
		return nil, nil, err
	}

	fieldRows, err := queryer.Query(`
		SELECT columns.column_uid, columns.table_uid, tables.table_name,
		       columns.column_name, COALESCE(columns.card_detail_icon_key, '')
		FROM public.system_column_details AS columns
		JOIN public.system_db_tables AS tables ON tables.table_uid = columns.table_uid
		ORDER BY tables.table_name, columns.co_number, columns.column_uid
	`)
	if err != nil {
		return nil, nil, err
	}
	defer fieldRows.Close()
	fields := make([]fieldAssignment, 0)
	for fieldRows.Next() {
		var item fieldAssignment
		if err := fieldRows.Scan(&item.ColumnUID, &item.TableUID, &item.Dataset, &item.ColumnName, &item.IconKey); err != nil {
			return nil, nil, err
		}
		fields = append(fields, item)
	}
	if err := fieldRows.Err(); err != nil {
		return nil, nil, err
	}
	return datasets, fields, nil
}

func readFieldDatasetName(queryer dbutils.Querier, columnUID int) string {
	var datasetName string
	_ = queryer.QueryRow(`
		SELECT tables.table_name
		FROM public.system_column_details AS columns
		JOIN public.system_db_tables AS tables ON tables.table_uid = columns.table_uid
		WHERE columns.column_uid = $1
	`, columnUID).Scan(&datasetName)
	return datasetName
}

func filepathExtension(name string) string {
	dot := strings.LastIndexByte(name, '.')
	if dot < 0 {
		return ""
	}
	return name[dot:]
}
