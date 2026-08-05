// referenced_table_data.go
// Provides foreign-key dropdown options for row creation and editing forms.
// Bridges referenced tables, FK display-column resolution, and the frontend dropdown renderer.
// Exists to fetch available FK values so users can pick from valid references.
package dtt_1_row_create

import (
	backend "easelect/backend/core_components"
	dtt_utils "easelect/backend/core_components/dynamic_table_tools/dtt_utils"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"easelect/backend/core_components/httpresponse"
	"strings"

	"github.com/lib/pq"
)

func GetReferencedTableData(w http.ResponseWriter, r *http.Request) {
	// Hae viitatun taulun nimi ja skeeman nimi URL-parametreista
	foreignTableName := r.URL.Query().Get("dataset")
	foreignSchemaName := r.URL.Query().Get("schema")
	if foreignTableName == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "referenced table is missing")
		return
	}
	if foreignSchemaName == "" {
		foreignSchemaName = "public"
	}

	// Hae viitatun taulun primary key -sarakkeet
	pkColumns, err := getPrimaryKeyColumns(foreignSchemaName, foreignTableName)
	if err != nil || len(pkColumns) == 0 {
		log.Printf("error fetching primary key columns for table %s: %v", foreignTableName, err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error fetching primary key columns")
		return
	}

	// Hae viitatun taulun sopiva näyttösarake (esim. ensimmäinen tekstityyppinen sarake)
	displayColumn, err := getDisplayColumn(foreignSchemaName, foreignTableName)
	if err != nil {
		log.Printf("error fetching display column for table %s: %v", foreignTableName, err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error fetching display column")
		return
	}

	// Luo SQL-kysely primary key -sarakkeiden ja näyttösarakkeen hakemiseksi
	selectColumns := append(pkColumns, displayColumn)
	query := fmt.Sprintf("SELECT %s FROM %s.%s", strings.Join(quoteIdentifiers(selectColumns), ", "), pq.QuoteIdentifier(foreignSchemaName), pq.QuoteIdentifier(foreignTableName))

	rows, err := backend.Db.Query(query)
	if err != nil {
		log.Printf("error fetching data from table %s: %v", foreignTableName, err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error fetching data from referenced table")
		return
	}
	defer rows.Close()

	var options []map[string]interface{}
	for rows.Next() {
		// Luo slice skannattaville arvoille
		values := make([]interface{}, len(selectColumns))
		valuePtrs := make([]interface{}, len(selectColumns))
		for i := range values {
			valuePtrs[i] = &values[i]
		}

		if err := rows.Scan(valuePtrs...); err != nil {
			log.Printf("error scanning data from table %s: %v", foreignTableName, err)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "error processing data")
			return
		}

		// Rakennetaan option-objekti
		option := make(map[string]interface{})
		// Lisää primary key -arvot
		for i, col := range pkColumns {
			option[col] = values[i]
		}
		// Lisää näyttösarake
		option["display"] = values[len(pkColumns)]

		options = append(options, option)
	}
	if err := rows.Err(); err != nil {
		log.Printf("error iterating rows from table %s: %v", foreignTableName, err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "rows iteration error")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(options)
}

func getPrimaryKeyColumns(schemaName, tableName string) ([]string, error) {
	query := `
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
        WHERE tc.table_name = $1 AND tc.table_schema = $2 AND tc.constraint_type = 'PRIMARY KEY'
        ORDER BY kcu.ordinal_position;
    `
	rows, err := backend.Db.Query(query, tableName, schemaName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var pkColumns []string
	for rows.Next() {
		var columnName string
		if err := rows.Scan(&columnName); err != nil {
			return nil, err
		}
		pkColumns = append(pkColumns, columnName)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return pkColumns, nil
}

// getDisplayColumn hakee viitatun taulun "näyttösarakkeen", joka näytetään
// käyttäjälle FK-vierasavainviittauksen tunnistukseksi (esim. pudotusvalikossa).
// Delegoi dtt_utils.ResolveFKDisplayColumn():lle — ks. sen dokumentaatio.
func getDisplayColumn(schemaName, tableName string) (string, error) {
	return dtt_utils.ResolveFKDisplayColumn(schemaName, tableName)
}

func quoteIdentifiers(identifiers []string) []string {
	quoted := make([]string, len(identifiers))
	for i, id := range identifiers {
		quoted[i] = pq.QuoteIdentifier(id)
	}
	return quoted
}
