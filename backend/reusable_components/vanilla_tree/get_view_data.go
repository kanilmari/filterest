// get_view_data.go
// Endpoint for fetching data from PostgreSQL views without system_db_tables registration.
// Between the vanilla_tree API and information_schema.views validation.
// Exists to serve view data after confirming the view exists in the catalog.
package vanilla_tree

import (
	"database/sql"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/httpresponse"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
)

// validViewNameRegex ensures the view name contains only safe characters
// to prevent SQL injection (since we use it in a dynamic query).
var validViewNameRegex = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`)

// GetViewDataHandler handles requests to fetch data from a database view.
// It verifies the view exists in information_schema.views (public schema),
// then returns all rows with column names and data.
func GetViewDataHandler(response_writer http.ResponseWriter, request *http.Request) {
	viewName := request.URL.Query().Get("view")
	if viewName == "" {
		httpresponse.RespondWithError(response_writer, http.StatusBadRequest, "missing 'view' query parameter")
		return
	}

	// Validate view name format to prevent SQL injection
	if !validViewNameRegex.MatchString(viewName) {
		httpresponse.RespondWithError(response_writer, http.StatusBadRequest, "invalid view name")
		return
	}

	// Verify the view exists in information_schema.views (public schema only)
	var exists bool
	err := backend.Db.QueryRow(
		`SELECT EXISTS (
			SELECT 1 FROM information_schema.views
			WHERE table_schema = 'public' AND table_name = $1
		)`, viewName,
	).Scan(&exists)
	if err != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error checking view existence")
		return
	}
	if !exists {
		httpresponse.RespondWithError(response_writer, http.StatusNotFound, fmt.Sprintf("view %q not found", viewName))
		return
	}

	// Query all rows from the view (with a reasonable limit to prevent huge responses)
	query := fmt.Sprintf(`SELECT * FROM %q LIMIT 10000`, viewName)
	rows, err := backend.Db.Query(query)
	if err != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error querying view")
		return
	}
	defer rows.Close()

	columns, err := rows.Columns()
	if err != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error reading columns")
		return
	}

	var allRows []map[string]interface{}
	for rows.Next() {
		rowValues := make([]interface{}, len(columns))
		rowPointers := make([]interface{}, len(columns))
		for i := range rowValues {
			rowPointers[i] = &rowValues[i]
		}

		if err := rows.Scan(rowPointers...); err != nil {
			fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error scanning row")
			return
		}

		currentRow := make(map[string]interface{})
		for i, colName := range columns {
			val := rowValues[i]
			switch v := val.(type) {
			case []byte:
				currentRow[colName] = string(v)
			case sql.NullString:
				if v.Valid {
					currentRow[colName] = v.String
				} else {
					currentRow[colName] = nil
				}
			default:
				currentRow[colName] = v
			}
		}
		allRows = append(allRows, currentRow)
	}

	if allRows == nil {
		allRows = []map[string]interface{}{}
	}

	responseData := map[string]interface{}{
		"columns":   columns,
		"data":      allRows,
		"row_count": len(allRows),
	}

	response_writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	if err := json.NewEncoder(response_writer).Encode(responseData); err != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error encoding response")
		return
	}
}
