// get_table_view.go
// HTTP handler that retrieves system_db_tables metadata for a named dataset,
// including its default view name. Returns data in the standard
// column/data JSON envelope used across the application.

package dtt_3_table_read

import (
	"database/sql"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/httpresponse"
	"encoding/json"
	"log"
	"net/http"
)

// GetMetadataHandlerWrapper huolehtii table-parametrin lukemisesta ja kutsuu GetMetadata-funktiota.
func GetTableViewHandlerWrapper(response_writer http.ResponseWriter, request *http.Request) {
	table_name := request.URL.Query().Get("dataset")
	if table_name == "" {
		httpresponse.RespondWithError(response_writer, http.StatusBadRequest, "table name is missing")
		return
	}

	log.Printf("calling GetMetadata for table %s", table_name)
	GetMetadata(response_writer, request)
}

// GetMetadata hakee system_db_tables-taulusta yhden rivin (name = annettu table_name)
// ja liittää sen system_table_views-tauluun (id = default_table_view) saadakseen oletusnäkymän nimen.
// Palauttaa JSON-muodossa sarakenimet ja data-rakenteen, saman tyyppisesti kuin GetResults.
func GetMetadata(response_writer http.ResponseWriter, request *http.Request) {
	table_name := request.URL.Query().Get("dataset")
	if table_name == "" {
		httpresponse.RespondWithError(response_writer, http.StatusBadRequest, "table name is missing")
		return
	}

	query := `
		SELECT 
			st.*,
			tv.name AS default_view_name
		FROM system_db_tables st
		LEFT JOIN system_table_views tv ON st.default_table_view = tv.id
		WHERE st.name = $1
	`

	// log.Printf("suoritetaan kysely: %s", query) // säilytetään kommentoituna
	// log.Printf("parametrit (args): [%s]", table_name) // säilytetään kommentoituna

	rows_result, err := backend.Db.QueryContext(request.Context(), query, table_name)
	if err != nil {
		log.Printf("[GetMetadata] query error for table %q: %v", table_name, err)
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error fetching table metadata")
		return
	}
	defer rows_result.Close()

	result_columns, err := rows_result.Columns()
	if err != nil {
		log.Printf("[GetMetadata] error reading columns: %v", err)
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error reading result columns")
		return
	}

	// Koska oletettavasti tässä haetaan vain yksi rivi, luodaan array kaiken varalta samaan tyyliin kuin GetResults-funktiossa.
	query_results := make([]map[string]interface{}, 0)

	for rows_result.Next() {
		row_values := make([]interface{}, len(result_columns))
		row_pointers := make([]interface{}, len(result_columns))
		for i := range row_values {
			row_pointers[i] = &row_values[i]
		}

		if err := rows_result.Scan(row_pointers...); err != nil {
			log.Printf("error processing rows: %v", err)
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error processing rows")
			return
		}

		current_row_result := make(map[string]interface{})
		for i, column_name := range result_columns {
			val := row_values[i]
			switch typed_val := val.(type) {
			case []byte:
				current_row_result[column_name] = string(typed_val)
			case sql.NullString:
				if typed_val.Valid {
					current_row_result[column_name] = typed_val.String
				} else {
					current_row_result[column_name] = nil
				}
			default:
				// Muita tyyppejä ei tässä esimerkissä eritellä erikseen
				current_row_result[column_name] = typed_val
			}
		}
		query_results = append(query_results, current_row_result)
	}

	// Kootaan vastaus samassa hengessä kuin GetResults, mutta suppeammin.
	response_data := map[string]interface{}{
		"columns": result_columns,
		"data":    query_results,
	}

	response_writer.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(response_writer).Encode(response_data); err != nil {
		log.Printf("error encoding response: %v", err)
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error encoding response")
		return
	}
}
