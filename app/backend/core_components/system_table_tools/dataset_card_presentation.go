// dataset_card_presentation.go
// Validates and saves dataset card appearance independently of column metadata.
// Connects the existing administrator card API with nullable dataset overrides.
// Preserves omitted values, atomic updates and cache invalidation after commit.
package system_table_tools

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	store "easelect/backend/core_components/dataset_appearance_store"
	"easelect/backend/core_components/dbutils"
	dtt_1_row_read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	"easelect/backend/core_components/httpresponse"
	"os"
)

// DatasetCardPresentation contains stored overrides; null inherits site defaults.
type DatasetCardPresentation struct {
	TableName         string                   `json:"table_name"`
	CardStyleVariant  *string                  `json:"card_style_variant"`
	CardDetailColumns *int                     `json:"card_detail_columns"`
	DatasetAppearance store.AppearanceResponse `json:"dataset_appearance"`
}

type datasetCardPresentationUpdate struct {
	DatasetCardPresentation
	styleProvided   bool
	columnsProvided bool
	SharedVersion   string
	Version         string
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
		case "scope", "table_name", "card_style_variant", "card_detail_columns", "shared_version", "version":
		default:
			return result, fmt.Errorf("field %q is not allowed for dataset_presentation", key)
		}
	}
	if strings.TrimSpace(req.TableName) == "" {
		return result, fmt.Errorf("table_name is required")
	}
	result.TableName = req.TableName
	result.SharedVersion, result.Version = req.SharedVersion, req.Version
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

// persistDatasetCardPresentation adapts nullable compatibility fields to one canonical patch.
func persistDatasetCardPresentation(ctx context.Context, tx *sql.Tx, update datasetCardPresentationUpdate, invalidate func(string)) (DatasetCardPresentation, error) {
	if update.Version == "" || update.SharedVersion == "" {
		return DatasetCardPresentation{}, store.ErrDatasetAppearanceConflict
	}
	uid, err := store.UIDForName(tx, update.TableName)
	if err != nil {
		return DatasetCardPresentation{}, err
	}
	values := map[string]any{}
	if update.styleProvided {
		if update.CardStyleVariant == nil {
			values["card_style_variant"] = nil
		} else {
			values["card_style_variant"] = *update.CardStyleVariant
		}
	}
	if update.columnsProvided {
		if update.CardDetailColumns == nil {
			values["card_detail_columns"] = nil
		} else {
			values["card_detail_columns"] = *update.CardDetailColumns
		}
	}
	snapshot, err := store.SaveAppearance(tx, uid, store.CardPatch(values), update.SharedVersion, update.Version, os.Getenv("ENVIRONMENT_TYPE") == "dev")
	if err != nil {
		return DatasetCardPresentation{}, err
	}
	result := projectDatasetCardPresentation(update.TableName, snapshot)
	scheduleCardVisibilitySchemaCacheInvalidation(ctx, update.TableName, invalidate)
	return result, nil
}

func projectDatasetCardPresentation(name string, snapshot store.AppearanceResponse) DatasetCardPresentation {
	style, columns := store.CardProjections(snapshot.Overrides)
	return DatasetCardPresentation{TableName: name, CardStyleVariant: style, CardDetailColumns: columns, DatasetAppearance: snapshot}
}

func updateDatasetCardPresentation(w http.ResponseWriter, r *http.Request, req updateCardVisibilityRequest) {
	update, err := decodeDatasetCardPresentation(req)
	if err != nil {
		respondDatasetAppearanceError(w, &httpresponse.Refusal{Status: 400, LangKey: "dataset_appearance_invalid", Message: err.Error()})
		return
	}
	if update.Version == "" || update.SharedVersion == "" {
		respondDatasetAppearanceError(w, store.ErrDatasetAppearanceConflict)
		return
	}
	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, 500, "transaction unavailable")
		return
	}
	result, err := persistDatasetCardPresentation(r.Context(), tx, update, dtt_1_row_read.InvalidateSchemaCache)
	if err != nil {
		respondDatasetAppearanceError(w, err)
		return
	}
	httpresponse.RespondWithJSON(w, 200, result)
}

// loadCardVisibilityTableSettings projects nullable fields from the new authority.
func loadCardVisibilityTableSettings(db *sql.DB, tableName string) (string, DatasetCardPresentation, error) {
	uid, err := store.UIDForName(db, tableName)
	if err != nil {
		return "", DatasetCardPresentation{}, err
	}
	snapshot, err := store.ReadAppearance(db, uid, os.Getenv("ENVIRONMENT_TYPE") == "dev")
	if err != nil {
		return "", DatasetCardPresentation{}, err
	}
	var layout string
	err = db.QueryRow(`SELECT COALESCE(card_details_layout,$2) FROM public.system_db_tables WHERE table_uid=$1`, uid, defaultCardDetailsLayout).Scan(&layout)
	return layout, projectDatasetCardPresentation(tableName, snapshot), err
}
