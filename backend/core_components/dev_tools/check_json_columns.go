// check_json_columns.go
// Development-only handler that scans public text columns for JSON-shaped payloads.
// Bridges schema inspection queries and a warning-oriented HTTP response for local audits.
// Exists to flag columns that likely deserve a JSONB migration or cleanup pass.
package devtools

import (
	"easelect/backend/core_components/httpresponse"
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"github.com/lib/pq"

	backend "easelect/backend/core_components"
)

// CheckJsonInTextColumnsHandler scans all text/varchar columns in public tables
// and returns a list of warnings if they appear to contain JSON data.
func CheckJsonInTextColumnsHandler(w http.ResponseWriter, r *http.Request) {
	// Find all text/varchar columns in public tables
	query := `
		SELECT table_name, column_name, data_type
		FROM information_schema.columns
		WHERE table_schema = 'public'
		  AND data_type IN ('text', 'character varying')
		ORDER BY table_name, column_name
	`

	rows, err := backend.Db.Query(query)
	if err != nil {
		log.Printf("CheckJsonInTextColumns error querying columns: %v", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "Error querying columns")
		return
	}
	defer rows.Close()

	var warnings []string

	for rows.Next() {
		var tableName, columnName, dataType string
		if err := rows.Scan(&tableName, &columnName, &dataType); err != nil {
			continue
		}

		// Check if the column contains data that looks like JSON
		// We check for values starting with { or [ and ending with } or ]
		// We limit to 1 to just detect existence
		checkQuery := fmt.Sprintf(`
			SELECT 1
			FROM %s
			WHERE %s::text ~ '^\s*[\{\[].*[\}\]]\s*$'
			LIMIT 1
		`, pq.QuoteIdentifier(tableName), pq.QuoteIdentifier(columnName))

		var exists int
		err := backend.Db.QueryRow(checkQuery).Scan(&exists)
		if err == nil && exists == 1 {
			// Found potential JSON data in text column
			msg := fmt.Sprintf("Column '%s' in table '%s' is type '%s' but appears to contain JSON data.", columnName, tableName, dataType)
			warnings = append(warnings, msg)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"warnings": warnings,
	})
}
