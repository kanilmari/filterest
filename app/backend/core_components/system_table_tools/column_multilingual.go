// column_multilingual.go
// Admin API for changing one dataset column's multilingual storage contract.
// Bridges canonical column_uid metadata with localized row editors and readers.
// Exists so metadata changes never depend on the legacy, nullable system_column_details.id field.
package system_table_tools

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"

	"easelect/backend/core_components/dbutils"
	dtt_1_row_read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	"easelect/backend/core_components/httpresponse"
)

var errColumnMultilingualMetadataNotFound = errors.New("dataset column metadata not found")

const updateColumnMultilingualQuery = `
	UPDATE system_column_details AS details
	SET is_multilingual = $1,
	    updated = now()
	WHERE details.column_uid = $2
	  AND details.table_uid = (
	      SELECT tables.table_uid
	      FROM system_db_tables AS tables
	      WHERE tables.schema_name = 'public'
	        AND tables.table_name = $3
	      LIMIT 1
	  )
`

type columnMultilingualRequest struct {
	Dataset        string `json:"dataset"`
	ColumnUID      int64  `json:"column_uid"`
	IsMultilingual bool   `json:"is_multilingual"`
}

type columnMultilingualUpdater interface {
	Exec(query string, args ...interface{}) (sql.Result, error)
}

func updateColumnMultilingual(
	updater columnMultilingualUpdater,
	dataset string,
	columnUID int64,
	isMultilingual bool,
) error {
	result, err := updater.Exec(
		updateColumnMultilingualQuery,
		isMultilingual,
		columnUID,
		dataset,
	)
	if err != nil {
		return fmt.Errorf("update multilingual metadata for %s column_uid %d: %w", dataset, columnUID, err)
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("read multilingual metadata update count: %w", err)
	}
	if rowsAffected == 0 {
		return errColumnMultilingualMetadataNotFound
	}
	if rowsAffected != 1 {
		return fmt.Errorf("multilingual metadata update matched %d rows", rowsAffected)
	}
	return nil
}

// UpdateColumnMultilingualHandler changes the explicit multilingual marker for
// one column that belongs to one public dataset. The canonical column_uid is
// used instead of the legacy system_column_details.id compatibility field.
// POST /api/admin/column-multilingual
func UpdateColumnMultilingualHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var req columnMultilingualRequest
	if err := decoder.Decode(&req); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Dataset = strings.TrimSpace(req.Dataset)
	if req.Dataset == "" || req.ColumnUID <= 0 {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "dataset and positive column_uid are required")
		return
	}

	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction start failed")
		return
	}
	if err := updateColumnMultilingual(tx, req.Dataset, req.ColumnUID, req.IsMultilingual); err != nil {
		if errors.Is(err, errColumnMultilingualMetadataNotFound) {
			httpresponse.RespondWithError(w, http.StatusNotFound, "dataset column metadata not found")
			return
		}
		log.Printf("[UpdateColumnMultilingualHandler] update failed: %v", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error updating multilingual column metadata")
		return
	}

	scheduleCardVisibilitySchemaCacheInvalidation(
		r.Context(),
		req.Dataset,
		dtt_1_row_read.InvalidateSchemaCache,
	)
	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]interface{}{
		"status":          "ok",
		"dataset":         req.Dataset,
		"column_uid":      req.ColumnUID,
		"is_multilingual": req.IsMultilingual,
	})
}
