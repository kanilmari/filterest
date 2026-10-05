// row_actor_updates.go
// Checks ordinary edits against the persistent creator and owner marks.
// Connects UpdateRowHandler to actor metadata and the registry compatibility setting.
// Checks the complete edit before writing any of its fields.
package dtt_1_row_update

import (
	"database/sql"
	"errors"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/row_mutation_policy"
	"easelect/backend/core_components/httpresponse"
)

func validateRowActorUpdates(q dbutils.Querier, tableName string, rowID int64, updates []updateRowFieldUpdate) error {
	marks, err := row_mutation_policy.ReadRowActorColumns(q, tableName)
	if err != nil {
		return err
	}
	for _, update := range updates {
		if err := marks.RefuseValue(update.Column); err != nil {
			return err
		}
		if tableName != "system_db_tables" || update.Column != "row_policy_owner_column" {
			continue
		}
		var owner sql.NullString
		err := q.QueryRow(`SELECT public.app_row_actor_column(
			to_regclass(format('%I.%I', COALESCE(registry.schema_name, 'public'), registry.table_name)), 'owner')
			FROM public.system_db_tables AS registry WHERE registry.id = $1`, rowID).Scan(&owner)
		if errors.Is(err, sql.ErrNoRows) {
			continue // Unmarked datasets retain the stage-one owner setting.
		}
		if err != nil {
			return err
		}
		if !owner.Valid {
			continue // The marks reader returns NULL for an unmarked dataset.
		}
		if value, ok := update.Value.(string); !ok || value != owner.String {
			return &httpresponse.Refusal{Status: 400, LangKey: "error_row_owner_setting_fixed",
				Message: "the dataset owner setting is fixed to its marked owner column"}
		}
	}
	return nil
}
