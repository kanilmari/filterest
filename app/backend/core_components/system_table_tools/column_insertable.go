// column_insertable.go
// Admin API for changing whether one dataset column appears in new-row forms.
// Bridges canonical column_uid metadata with the add-row column filter.
// Exists so insertability changes never depend on the legacy system_column_details.id field.
package system_table_tools

import (
	"context"
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

var errColumnInsertableMetadataNotFound = errors.New("dataset column metadata not found")

const updateColumnInsertableQuery = `
	UPDATE system_column_details AS details
	SET insertable = $1,
	    updated = now()
	WHERE details.column_uid = $2
	  AND EXISTS (
	      SELECT 1
	      FROM system_db_tables AS tables
	      WHERE tables.table_uid = details.table_uid
	        AND tables.schema_name = 'public'
	        AND tables.table_name = $3
	  )
	RETURNING
		details.column_name,
		details.insertable,
		COALESCE(details.is_multilingual, false),
		COALESCE(details.hide_everywhere, false)
`

type columnInsertableRequest struct {
	Dataset    string `json:"dataset"`
	ColumnUID  int64  `json:"column_uid"`
	Insertable *bool  `json:"insertable"`
}

type columnInsertableMetadata struct {
	ColumnName     string `json:"column_name"`
	Insertable     bool   `json:"insertable"`
	IsMultilingual bool   `json:"is_multilingual"`
	HideEverywhere bool   `json:"hide_everywhere"`
}

type columnInsertableRow interface {
	Scan(dest ...interface{}) error
}

type columnInsertableQueryer interface {
	QueryRowContext(ctx context.Context, query string, args ...interface{}) columnInsertableRow
}

type transactionColumnInsertableQueryer struct {
	tx *sql.Tx
}

func (queryer transactionColumnInsertableQueryer) QueryRowContext(
	ctx context.Context,
	query string,
	args ...interface{},
) columnInsertableRow {
	return queryer.tx.QueryRowContext(ctx, query, args...)
}

func updateColumnInsertable(
	ctx context.Context,
	queryer columnInsertableQueryer,
	dataset string,
	columnUID int64,
	insertable bool,
) (columnInsertableMetadata, error) {
	var metadata columnInsertableMetadata
	err := queryer.QueryRowContext(
		ctx,
		updateColumnInsertableQuery,
		insertable,
		columnUID,
		dataset,
	).Scan(
		&metadata.ColumnName,
		&metadata.Insertable,
		&metadata.IsMultilingual,
		&metadata.HideEverywhere,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return columnInsertableMetadata{}, errColumnInsertableMetadataNotFound
	}
	if err != nil {
		return columnInsertableMetadata{}, fmt.Errorf(
			"update insertable metadata for %s column_uid %d: %w",
			dataset,
			columnUID,
			err,
		)
	}
	if metadata.Insertable != insertable {
		return columnInsertableMetadata{}, errors.New("insertable metadata readback differs from requested value")
	}
	return metadata, nil
}

// UpdateColumnInsertableHandler changes whether one public dataset column may
// be entered when a row is created. The canonical column_uid and dataset are
// checked together, and the updated metadata is returned from the same write.
// POST /api/admin/column-insertable
func UpdateColumnInsertableHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var req columnInsertableRequest
	if err := decoder.Decode(&req); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Dataset = strings.TrimSpace(req.Dataset)
	if req.Dataset == "" || req.ColumnUID <= 0 || req.Insertable == nil {
		httpresponse.RespondWithError(
			w,
			http.StatusBadRequest,
			"dataset, positive column_uid, and insertable are required",
		)
		return
	}

	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction start failed")
		return
	}
	metadata, err := updateColumnInsertable(
		r.Context(),
		transactionColumnInsertableQueryer{tx: tx},
		req.Dataset,
		req.ColumnUID,
		*req.Insertable,
	)
	if err != nil {
		if errors.Is(err, errColumnInsertableMetadataNotFound) {
			httpresponse.RespondWithError(w, http.StatusNotFound, "dataset column metadata not found")
			return
		}
		log.Printf("[UpdateColumnInsertableHandler] update failed: %v", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error updating column insertability")
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
		"column_name":     metadata.ColumnName,
		"insertable":      metadata.Insertable,
		"is_multilingual": metadata.IsMultilingual,
		"hide_everywhere": metadata.HideEverywhere,
	})
}
