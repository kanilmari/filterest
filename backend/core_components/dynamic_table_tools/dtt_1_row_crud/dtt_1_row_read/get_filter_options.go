// get_filter_options.go
// Returns distinct display values from a foreign key table for filter dropdowns.
// Bridges the filter bar UI with FK table data for multiselect filter population.
// Exists to provide a lightweight endpoint for populating filter dropdowns with FK display values.
package dtt_1_row_read

import (
	"fmt"
	"log"
	"net/http"

	auth "easelect/backend/core_components/auth"
	dtt_utils "easelect/backend/core_components/dynamic_table_tools/dtt_utils"
	"easelect/backend/core_components/httpresponse"
	e_sessions "easelect/backend/core_components/sessions"

	"github.com/lib/pq"
)

type filterOption struct {
	Value interface{} `json:"value"`
	Label string      `json:"label"`
}

// GetFilterOptionsHandler returns distinct {value, label} pairs from a foreign table.
// GET /api/get-filter-options?dataset=<foreign_table>
func GetFilterOptionsHandler(w http.ResponseWriter, r *http.Request) {
	tableName := r.URL.Query().Get("dataset")
	if tableName == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "missing 'dataset' query parameter")
		return
	}
	valueColumn := r.URL.Query().Get("value_column")
	if valueColumn == "" {
		valueColumn = "id"
	}

	// 1. Auth: get user role for DB connection selection
	userID, err := e_sessions.GetUserIDFromSession(r)
	if err != nil || userID <= 0 {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, "Unauthorized: login required")
		return
	}

	session, sessErr := e_sessions.GetOrCreateSession(nil, r)
	if sessErr != nil {
		log.Printf("\033[31merror: %s\033[0m\n", sessErr.Error())
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error fetching session")
		return
	}

	userRole, _ := session.Values["user_role"].(string)
	if userRole == "" {
		userRole = "guest"
	}

	currentDb := auth.GetDBForRole(userRole)
	readQuerier, err := getPilotReadQuerier(r.Context(), tableName, currentDb)
	if err != nil {
		log.Printf("\033[31merror: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error initializing pilot read transaction")
		return
	}

	// 2. Validate that the table exists in system_db_tables
	var exists bool
	err = currentDb.QueryRow(
		"SELECT EXISTS (SELECT 1 FROM system_db_tables WHERE table_name = $1)",
		tableName,
	).Scan(&exists)
	if err != nil {
		log.Printf("\033[31merror checking table existence: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error checking table existence")
		return
	}
	if !exists {
		httpresponse.RespondWithError(w, http.StatusNotFound, fmt.Sprintf("dataset %q not found", tableName))
		return
	}

	// 3. Resolve the display column using the shared FK heuristic
	displayCol, err := dtt_utils.ResolveFKDisplayColumn("public", tableName)
	if err != nil {
		log.Printf("\033[31merror resolving display column for %s: %s\033[0m\n", tableName, err.Error())
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "could not resolve display column")
		return
	}

	var valueColumnExists bool
	err = currentDb.QueryRow(
		`SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = $1
              AND column_name = $2
        )`,
		tableName,
		valueColumn,
	).Scan(&valueColumnExists)
	if err != nil {
		log.Printf("\033[31merror checking value column existence: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error checking filter option value column")
		return
	}
	if !valueColumnExists {
		httpresponse.RespondWithError(
			w,
			http.StatusBadRequest,
			fmt.Sprintf("value column %q not found on dataset %q", valueColumn, tableName),
		)
		return
	}

	// 4. Query distinct value + display column values. The value column defaults to
	// id, but text-backed FKs such as dev_agent_tasks.status -> dev_agent_task_statuses.slug
	// must be able to request their true referenced column instead of the row id.
	readPolicy, err := getLegacyMustTrueReadPolicy(currentDb, tableName)
	if err != nil {
		log.Printf("\033[31merror fetching row policy metadata: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error fetching row policy metadata")
		return
	}
	whereClause := fmt.Sprintf(
		" WHERE %s IS NOT NULL AND %s IS NOT NULL",
		pq.QuoteIdentifier(valueColumn),
		pq.QuoteIdentifier(displayCol),
	)
	queryArgs := []interface{}{}
	whereClause, queryArgs = appendReadPolicyToWhereClause(
		tableName,
		userRole,
		userID,
		readPolicy,
		whereClause,
		queryArgs,
	)
	query := fmt.Sprintf(
		"SELECT DISTINCT %s, %s FROM %s%s ORDER BY %s LIMIT 500",
		pq.QuoteIdentifier(valueColumn),
		pq.QuoteIdentifier(displayCol),
		pq.QuoteIdentifier(tableName),
		whereClause,
		pq.QuoteIdentifier(displayCol),
	)

	rows, err := readQuerier.Query(query, queryArgs...)
	if err != nil {
		log.Printf("\033[31merror querying filter options: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error fetching filter options")
		return
	}
	defer rows.Close()

	options := []filterOption{}
	for rows.Next() {
		var id interface{}
		var label string
		if err := rows.Scan(&id, &label); err != nil {
			log.Printf("\033[31merror scanning filter option row: %s\033[0m\n", err.Error())
			continue
		}
		options = append(options, filterOption{Value: id, Label: label})
	}
	if err := rows.Err(); err != nil {
		log.Printf("\033[31mrows iteration error: %s\033[0m\n", err.Error())
	}

	httpresponse.RespondWithJSON(w, http.StatusOK, options)
}
