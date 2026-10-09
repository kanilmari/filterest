// dataset_card_metadata_writer.go
// Adapts legacy generic card metadata edits to revision-protected appearance saves.
// Connects the ordinary authorized row editor with canonical sparse overrides.
// Takes the shared lock before generic registry-row locks and skips retired columns.
package dtt_1_row_update

import (
	"database/sql"
	store "easelect/backend/core_components/dataset_appearance_store"
	"os"
)

func isDatasetCardMetadataField(table, column string) bool {
	return table == "system_db_tables" && (column == "card_style_variant" || column == "card_detail_columns")
}

func saveDatasetCardMetadata(tx *sql.Tx, table string, input updateRowRequest, updates []updateRowFieldUpdate) (*store.AppearanceResponse, error) {
	values := map[string]any{}
	for _, update := range updates {
		if isDatasetCardMetadataField(table, update.Column) {
			values[update.Column] = update.Value
		}
	}
	if len(values) == 0 {
		return nil, nil
	}
	if input.Version == "" || input.SharedVersion == "" {
		return nil, store.ErrDatasetAppearanceConflict
	}
	var uid int
	err := tx.QueryRow(`SELECT table_uid FROM public.system_db_tables WHERE id=$1`, input.ID).Scan(&uid)
	if err == sql.ErrNoRows {
		return nil, store.ErrDatasetAppearanceNotFound
	}
	if err != nil {
		return nil, err
	}
	result, err := store.SaveAppearance(tx, uid, store.CardPatch(values), input.SharedVersion, input.Version, os.Getenv("ENVIRONMENT_TYPE") == "dev")
	return &result, err
}
