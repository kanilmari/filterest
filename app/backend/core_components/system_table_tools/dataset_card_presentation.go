// dataset_card_presentation.go
// Validates and saves dataset card appearance independently of column metadata.
// Connects the existing administrator card API with nullable dataset overrides.
// Preserves omitted values, atomic updates and cache invalidation after commit.
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

// DatasetCardPresentation contains stored overrides; null inherits site defaults.
type DatasetCardPresentation struct {
	TableName         string  `json:"table_name"`
	CardStyleVariant  *string `json:"card_style_variant"`
	CardDetailColumns *int    `json:"card_detail_columns"`
}

type datasetCardPresentationUpdate struct {
	DatasetCardPresentation
	styleProvided   bool
	columnsProvided bool
}

// UnmarshalJSON retains request-member presence for strict scoped saves.
func (request *updateCardVisibilityRequest) UnmarshalJSON(data []byte) error {
	type plainRequest updateCardVisibilityRequest
	var decoded plainRequest
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	*request = updateCardVisibilityRequest(decoded)
	request.fields = fields
	return nil
}

func decodeCardDetailColumnsOverride(raw json.RawMessage) (*int, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	var value *int
	if err := json.Unmarshal(raw, &value); err != nil || (value != nil && (*value < 1 || *value > 4)) {
		return nil, fmt.Errorf("card_detail_columns must be null or an integer from 1 to 4")
	}
	return value, nil
}

func decodeDatasetCardPresentation(req updateCardVisibilityRequest) (datasetCardPresentationUpdate, error) {
	result := datasetCardPresentationUpdate{}
	var scope string
	if err := json.Unmarshal(req.Scope, &scope); err != nil || scope != "dataset_presentation" {
		return result, fmt.Errorf("scope must be dataset_presentation")
	}
	for key := range req.fields {
		switch key {
		case "scope", "table_name", "card_style_variant", "card_detail_columns":
		default:
			return result, fmt.Errorf("field %q is not allowed for dataset_presentation", key)
		}
	}
	if strings.TrimSpace(req.TableName) == "" {
		return result, fmt.Errorf("table_name is required")
	}
	result.TableName = req.TableName
	result.styleProvided = len(req.CardStyleVariant) > 0
	result.columnsProvided = len(req.CardDetailColumns) > 0
	if !result.styleProvided && !result.columnsProvided {
		return result, fmt.Errorf("at least one dataset presentation setting is required")
	}
	var err error
	result.CardStyleVariant, err = decodeCardStyleVariantOverride(req.CardStyleVariant)
	if err != nil {
		return result, err
	}
	result.CardDetailColumns, err = decodeCardDetailColumnsOverride(req.CardDetailColumns)
	return result, err
}

func datasetCardPresentationColumnExists(queryer dbutils.Querier, column string) (bool, error) {
	var exists bool
	err := queryer.QueryRow(`
  SELECT EXISTS (
   SELECT 1 FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'system_db_tables' AND column_name = $1
  )
 `, column).Scan(&exists)
	return exists, err
}

// Both assignments use the locked current row, never a browser metadata snapshot.
const updateDatasetCardPresentationQuery = `
 UPDATE system_db_tables
 SET card_style_variant = CASE WHEN $2 THEN $3::varchar ELSE card_style_variant END,
     card_detail_columns = CASE WHEN $4 THEN $5::integer ELSE card_detail_columns END
 WHERE table_name = $1
 RETURNING table_name, card_style_variant, card_detail_columns
`

func persistDatasetCardPresentation(
	ctx context.Context, tx *sql.Tx, update datasetCardPresentationUpdate, invalidate func(string),
) (DatasetCardPresentation, error) {
	var result DatasetCardPresentation
	err := tx.QueryRowContext(ctx, updateDatasetCardPresentationQuery,
		update.TableName, update.styleProvided, update.CardStyleVariant,
		update.columnsProvided, update.CardDetailColumns,
	).Scan(&result.TableName, &result.CardStyleVariant, &result.CardDetailColumns)
	if err != nil {
		return result, err
	}
	scheduleCardVisibilitySchemaCacheInvalidation(ctx, update.TableName, invalidate)
	return result, nil
}

func updateDatasetCardPresentation(w http.ResponseWriter, r *http.Request, req updateCardVisibilityRequest) {
	update, err := decodeDatasetCardPresentation(req)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}
	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction start failed")
		return
	}
	for _, column := range []string{"card_style_variant", "card_detail_columns"} {
		exists, err := datasetCardPresentationColumnExists(tx, column)
		if err != nil {
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "error checking dataset presentation metadata")
			return
		}
		if !exists {
			httpresponse.RespondWithError(w, http.StatusConflict, "dataset card presentation migration required")
			return
		}
	}
	result, err := persistDatasetCardPresentation(r.Context(), tx, update, dtt_1_row_read.InvalidateSchemaCache)
	if errors.Is(err, sql.ErrNoRows) {
		httpresponse.RespondWithError(w, http.StatusNotFound, "dataset not found")
		return
	}
	if err != nil {
		log.Printf("\033[31merror: dataset card presentation update for %q: %v\033[0m", update.TableName, err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error saving dataset card presentation")
		return
	}
	httpresponse.RespondWithJSON(w, http.StatusOK, result)
}

// The older complete-column editor can also explicitly save this optional setting.
func writeLegacyCardDetailColumns(w http.ResponseWriter, tx *sql.Tx, tableName string, value *int) bool {
	exists, err := datasetCardPresentationColumnExists(tx, "card_detail_columns")
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error checking card detail columns metadata")
		return false
	}
	if !exists {
		httpresponse.RespondWithError(w, http.StatusConflict, "dataset card presentation migration required")
		return false
	}
	if _, err := tx.Exec(`UPDATE system_db_tables SET card_detail_columns = $1 WHERE table_name = $2`, value, tableName); err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error saving card detail columns")
		return false
	}
	return true
}

// Older schemas remain readable; saving the new scoped contract requires migration.
func loadCardVisibilityTableSettings(db *sql.DB, tableName string) (string, DatasetCardPresentation, error) {
	result := DatasetCardPresentation{TableName: tableName}
	layout := defaultCardDetailsLayout
	expressions := []string{"NULL::varchar AS card_style_variant", "NULL::integer AS card_detail_columns"}
	for index, column := range []string{"card_style_variant", "card_detail_columns"} {
		exists, err := datasetCardPresentationColumnExists(db, column)
		if err != nil {
			return layout, result, err
		}
		if exists {
			expressions[index] = column
		}
	}
	err := db.QueryRow(fmt.Sprintf(`
  SELECT COALESCE(card_details_layout, $2), %s, %s
  FROM system_db_tables WHERE table_name = $1 LIMIT 1
 `, expressions[0], expressions[1]), tableName, defaultCardDetailsLayout).Scan(
		&layout, &result.CardStyleVariant, &result.CardDetailColumns,
	)
	if errors.Is(err, sql.ErrNoRows) {
		err = nil
	}
	return layout, result, err
}
