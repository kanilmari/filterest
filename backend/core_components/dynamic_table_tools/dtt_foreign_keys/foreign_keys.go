// foreign_keys.go
// HTTP handlers for managing PostgreSQL foreign key constraints.
// Provides endpoints to add and delete foreign key constraints and to
// query existing foreign keys and table names.

package dtt_foreign_keys

import (
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dataset_routes"
	"easelect/backend/core_components/httpresponse"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/lib/pq"
)

func AddForeignKeyHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	var requestData struct {
		ReferencingTable  string `json:"referencing_dataset"`
		ReferencingColumn string `json:"referencing_column"`
		ReferencedTable   string `json:"referenced_dataset"`
		ReferencedColumn  string `json:"referenced_column"`
	}

	if err := json.NewDecoder(r.Body).Decode(&requestData); err != nil {
		log.Printf("\033[31merror: decoding data: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusBadRequest, "Invalid data")
		return
	}

	// Validate inputs
	if requestData.ReferencingTable == "" || requestData.ReferencingColumn == "" ||
		requestData.ReferencedTable == "" || requestData.ReferencedColumn == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "All fields are required")
		return
	}

	// Optional: Validate that the tables and columns exist
	if !tableExists(requestData.ReferencingTable) || !tableExists(requestData.ReferencedTable) {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "One of the specified tables does not exist")
		return
	}

	if !columnExists(requestData.ReferencingTable, requestData.ReferencingColumn) ||
		!columnExists(requestData.ReferencedTable, requestData.ReferencedColumn) {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "One of the specified columns does not exist")
		return
	}

	// Construct the ALTER TABLE ADD CONSTRAINT command
	// Generate a unique constraint name
	constraintName := fmt.Sprintf("fk_%s_%s", requestData.ReferencingTable, requestData.ReferencingColumn)

	// Build the ALTER TABLE statement
	alterTableStmt := fmt.Sprintf(
		"ALTER TABLE %s ADD CONSTRAINT %s FOREIGN KEY (%s) REFERENCES %s (%s)",
		pq.QuoteIdentifier(requestData.ReferencingTable),
		pq.QuoteIdentifier(constraintName),
		pq.QuoteIdentifier(requestData.ReferencingColumn),
		pq.QuoteIdentifier(requestData.ReferencedTable),
		pq.QuoteIdentifier(requestData.ReferencedColumn),
	)

	// Execute the statement
	_, err := backend.Db.Exec(alterTableStmt)
	if err != nil {
		log.Printf("\033[31merror: adding foreign key: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("Error adding foreign key: %v", err))
		return
	}

	// Return success message
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"message": "Foreign key added successfully",
	})
}
func tableExists(tableName string) bool {
	var exists bool
	query := `
        SELECT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = $1 AND table_type = 'BASE TABLE'
        )
    `
	err := backend.Db.QueryRow(query, tableName).Scan(&exists)
	if err != nil {
		log.Printf("\033[31merror: checking if table exists: %v\033[0m", err)
		return false
	}
	return exists
}

func columnExists(tableName, columnName string) bool {
	var exists bool
	query := `
        SELECT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
        )
    `
	err := backend.Db.QueryRow(query, tableName, columnName).Scan(&exists)
	if err != nil {
		log.Printf("\033[31merror: checking if column exists: %v\033[0m", err)
		return false
	}
	return exists
}

func GetTableNamesHandler(w http.ResponseWriter, r *http.Request) {
	withAliases := r.URL.Query().Get("with_aliases") == "1"
	query := `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name;
    `
	rows, err := backend.Db.Query(query)
	if err != nil {
		log.Printf("\033[31merror: fetching table names: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "Error fetching table names")
		return
	}
	defer rows.Close()

	var tableNames []string
	for rows.Next() {
		var tableName string
		if err := rows.Scan(&tableName); err != nil {
			log.Printf("\033[31merror: scanning table name: %v\033[0m", err)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "Error fetching table names")
			return
		}
		if !backend.ShouldExposeCloudManagementDatasetName(tableName) {
			continue
		}
		tableNames = append(tableNames, tableName)
	}
	if err := rows.Err(); err != nil {
		log.Printf("\033[31merror: rows iteration error in GetTableNamesHandler: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "rows iteration error")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if withAliases {
		registry, aliasErr := dataset_routes.LoadAliasRegistry(backend.Db)
		if aliasErr != nil {
			log.Printf("\033[33mwarning: dataset alias registry fallback in GetTableNamesHandler: %v\033[0m", aliasErr)
		}
		json.NewEncoder(w).Encode(map[string]any{
			"names":         tableNames,
			"raw_to_public": registry.RawToPublic,
			"public_to_raw": registry.PublicToRaw,
		})
		return
	}
	json.NewEncoder(w).Encode(tableNames)
}

func GetForeignKeys(w http.ResponseWriter, r *http.Request) {
	datasetsParam := r.URL.Query().Get("datasets")
	var tableList []string
	if datasetsParam != "" {
		tableList = strings.Split(datasetsParam, ",")
		for i := range tableList {
			tableList[i] = strings.TrimSpace(tableList[i])
		}
		filtered := tableList[:0]
		for _, tbl := range tableList {
			if tableExists(tbl) {
				filtered = append(filtered, tbl)
			}
		}
		tableList = filtered
	}

	query := `
        SELECT
            tc.constraint_name,
            tc.table_name AS referencing_table,
            kcu.column_name AS referencing_column,
            ccu.table_name AS referenced_table,
            ccu.column_name AS referenced_column
        FROM
            information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
                ON tc.constraint_name = kcu.constraint_name
                AND tc.constraint_schema = kcu.constraint_schema
            JOIN information_schema.constraint_column_usage AS ccu
                ON ccu.constraint_name = tc.constraint_name
                AND ccu.constraint_schema = tc.constraint_schema
        WHERE
            tc.constraint_type = 'FOREIGN KEY'`
	var args []interface{}
	if len(tableList) > 0 {
		query += `
            AND (tc.table_name = ANY($1) OR ccu.table_name = ANY($1))`
		args = append(args, pq.Array(tableList))
	}
	query += ";"

	rows, err := backend.Db.Query(query, args...)
	if err != nil {
		log.Printf("\033[31merror: fetching foreign keys: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "Error fetching foreign keys")
		return
	}
	defer rows.Close()

	// Build data
	columns := []string{"referencing_table", "referencing_column", "referenced_table", "referenced_column"}
	var results []map[string]interface{}

	for rows.Next() {
		var constraintName, referencingTable, referencingColumn, referencedTable, referencedColumn string
		if err := rows.Scan(&constraintName, &referencingTable, &referencingColumn, &referencedTable, &referencedColumn); err != nil {
			log.Printf("\033[31merror: processing foreign keys: %v\033[0m", err)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "Error processing foreign keys")
			return
		}
		row := map[string]interface{}{
			"constraint_name":    constraintName,
			"referencing_table":  referencingTable,
			"referencing_column": referencingColumn,
			"referenced_table":   referencedTable,
			"referenced_column":  referencedColumn,
		}
		results = append(results, row)
	}
	if err := rows.Err(); err != nil {
		log.Printf("\033[31merror: rows iteration error in GetForeignKeys: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "rows iteration error")
		return
	}

	// Return response
	response := map[string]interface{}{
		"columns": columns,
		"data":    results,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func DeleteForeignKeyHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "Metodi ei ole sallittu")
		return
	}

	var requestData struct {
		ConstraintName   string `json:"constraint_name"`
		ReferencingTable string `json:"referencing_dataset"`
	}

	if err := json.NewDecoder(r.Body).Decode(&requestData); err != nil {
		log.Printf("Virhe datan dekoodauksessa: %v", err)
		httpresponse.RespondWithError(w, http.StatusBadRequest, "Virheellinen data")
		return
	}

	// Validate inputs
	if requestData.ConstraintName == "" || requestData.ReferencingTable == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "Vierasavaimen nimi ja taulu ovat pakollisia")
		return
	}

	// Build the ALTER TABLE DROP CONSTRAINT statement
	dropConstraintStmt := fmt.Sprintf(
		"ALTER TABLE %s DROP CONSTRAINT %s",
		pq.QuoteIdentifier(requestData.ReferencingTable),
		pq.QuoteIdentifier(requestData.ConstraintName),
	)

	// Execute the statement
	_, err := backend.Db.Exec(dropConstraintStmt)
	if err != nil {
		log.Printf("Virhe vierasavaimen poistamisessa: %v", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("Virhe vierasavaimen poistamisessa: %v", err))
		return
	}

	// Return success message
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"message": "Vierasavain poistettu onnistuneesti",
	})
}
