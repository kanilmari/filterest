// many_to_many_lookup.go
// Queries many-to-many relationship metadata for the add-row workflow.
// Bridges system_foreign_key_relations_m_m and the frontend M:M picker.
// Exists to expose bridging-table info so the add-row UI can render M:M selectors.

package dtt_1_row_create

import (
	"easelect/backend/core_components/httpresponse"
	"encoding/json"
	"fmt"
	"net/http"

	backend "easelect/backend/core_components"
)

// ManyToManyInfo edustaa many-to-many -suhdetta dedikoidusta taulusta
type ManyToManyInfo struct {
	LinkTableUID       string `json:"bridging_table_uid"`
	LinkTableName      string `json:"bridging_dataset_name"`
	MainTableFkColumn  string `json:"main_dataset_fk_column"`
	ThirdTableUID      string `json:"third_table_uid"`
	ThirdTableName     string `json:"third_dataset_name"`
	ThirdTableFkColumn string `json:"third_dataset_fk_column"`
}

// GetManyToManyTablesHandlerWrapper hakee many-to-many -suhteet
// dedikoidusta taulusta, joissa päätauluna on annettu main_table_name.
func GetManyToManyTablesHandlerWrapper(w http.ResponseWriter, r *http.Request) {
	tableUID := r.URL.Query().Get("table_uid")
	if tableUID == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "missing 'table_uid' query parameter")
		return
	}
	if err := GetManyToManyTablesHandler(w, tableUID); err != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error fetching many-to-many join tables")
	}
}

// GetManyToManyTablesHandler suorittaa kyselyn system_foreign_key_relations_m_m -tauluun
// ja palauttaa ne rivit, joissa main_table_uid vastaa annettua arvoa.
func GetManyToManyTablesHandler(w http.ResponseWriter, mainTableUID string) error {
	query := `
        SELECT
                fr.bridging_table_uid,
                s_br.table_name AS bridging_table_name,
                CASE
                        WHEN fr.table_a_uid = $1 THEN fr.bridging_col_a
                        ELSE fr.bridging_col_b
                END AS main_table_fk_column,
                CASE
                        WHEN fr.table_a_uid = $1 THEN fr.table_b_uid
                        ELSE fr.table_a_uid
                END AS third_table_uid,
                CASE
                        WHEN fr.table_a_uid = $1 THEN s_b.table_name
                        ELSE s_a.table_name
                END AS third_table_name,
                CASE
                        WHEN fr.table_a_uid = $1 THEN fr.bridging_col_b
                        ELSE fr.bridging_col_a
                END AS third_table_fk_column
        FROM system_foreign_key_relations_m_m fr
        JOIN system_db_tables s_br ON s_br.table_uid = fr.bridging_table_uid
        JOIN system_db_tables s_a  ON s_a.table_uid = fr.table_a_uid
        JOIN system_db_tables s_b  ON s_b.table_uid = fr.table_b_uid
        WHERE (fr.table_a_uid = $1 OR fr.table_b_uid = $1);
        `

	rows, err := backend.Db.Query(query, mainTableUID)
	if err != nil {
		return err
	}
	defer rows.Close()

	var results []ManyToManyInfo
	for rows.Next() {
		var info ManyToManyInfo
		if err := rows.Scan(
			&info.LinkTableUID,
			&info.LinkTableName,
			&info.MainTableFkColumn,
			&info.ThirdTableUID,
			&info.ThirdTableName,
			&info.ThirdTableFkColumn,
		); err != nil {
			return err
		}
		results = append(results, info)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	w.Header().Set("Content-Type", "application/json")
	return json.NewEncoder(w).Encode(results)
}
