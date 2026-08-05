// one_to_many_relations.go
// Queries one-to-many relationship metadata for the add-row workflow.
// Bridges system_foreign_key_relations_1_m and the frontend child-row form.
// Exists to expose 1:M FK relation data so the add-row UI can render child-row sections.

package dtt_1_row_create

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"easelect/backend/core_components/httpresponse"

	backend "easelect/backend/core_components"
)

// OneToManyRelation edustaa riviä system_foreign_key_relations_1_m -taulussa
type OneToManyRelation struct {
	SourceTableUID            string       `json:"source_table_uid"`
	SourceTableName           string       `json:"source_dataset_name"`
	SourceColumnName          string       `json:"source_column_name"`
	TargetTableUID            string       `json:"target_table_uid"`
	TargetTableName           string       `json:"target_dataset_name"`
	TargetColumnName          string       `json:"target_column_name"`
	InsertNewTargetWithSource sql.NullBool `json:"insert_new_target_with_source"`
	InsertNewSourceWithTarget sql.NullBool `json:"insert_new_source_with_target"`
	SourceInsertSpecs         string       `json:"source_insert_specs"`
	TargetInsertSpecs         string       `json:"target_insert_specs"`
	ReferenceDirection        string       `json:"reference_direction"`
}

// GetOneToManyRelationsHandlerWrapper hakee system_foreign_key_relations_1_m -taulusta
// kaikki 1->m-suhteet, joissa target_table_uid = annettu taulu.
func GetOneToManyRelationsHandlerWrapper(w http.ResponseWriter, r *http.Request) {
	tableUID := r.URL.Query().Get("table_uid")
	if tableUID == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "missing 'table_uid' query parameter")
		return
	}

	if err := GetOneToManyRelationsHandler(w, tableUID); err != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error fetching 1->m relations")
	}
}

func GetOneToManyRelationsHandler(w http.ResponseWriter, mainTableUID string) error {
	query := `
               SELECT
                       fr.source_table_uid,
                       s_src.table_name AS source_table_name,
                       fr.source_column_name,
                       fr.target_table_uid,
                       s_tgt.table_name AS target_table_name,
                       fr.target_column_name,
                       fr.insert_new_target_with_source,
                       fr.insert_new_source_with_target,
                       fr.source_insert_specs,
                       fr.target_insert_specs,
                       fr.reference_direction
               FROM system_foreign_key_relations_1_m fr
               JOIN system_db_tables s_src ON s_src.table_uid = fr.source_table_uid
               JOIN system_db_tables s_tgt ON s_tgt.table_uid = fr.target_table_uid
               WHERE fr.target_table_uid = $1
       `

	rows, err := backend.Db.Query(query, mainTableUID)
	if err != nil {
		return err
	}
	defer rows.Close()

	var results []OneToManyRelation
	for rows.Next() {
		var rel OneToManyRelation
		var sourceInsert sql.NullString
		var targetInsert sql.NullString
		if err := rows.Scan(
			&rel.SourceTableUID,
			&rel.SourceTableName,
			&rel.SourceColumnName,
			&rel.TargetTableUID,
			&rel.TargetTableName,
			&rel.TargetColumnName,
			&rel.InsertNewTargetWithSource,
			&rel.InsertNewSourceWithTarget,
			&sourceInsert,
			&targetInsert,
			&rel.ReferenceDirection,
		); err != nil {
			return err
		}
		rel.SourceInsertSpecs = sourceInsert.String
		rel.TargetInsertSpecs = targetInsert.String
		results = append(results, rel)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	w.Header().Set("Content-Type", "application/json")
	return json.NewEncoder(w).Encode(results)
}
