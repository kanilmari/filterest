// schema_comments_and_indexes_handler.go
// Handles setting PostgreSQL column comments and creating or dropping indexes on dynamic table
// columns. Receives configuration from the frontend and applies schema-level annotations.
// Exists to expose admin-controlled schema annotations through validated API routes.
package dtt_crud_workflows

import (
	"easelect/backend/core_components/httpresponse"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/security"
)

// ─── COMMENT ON (tables & columns) ──────────────────────────────────────────

// escapeStringLiteral escapes a string for safe use as a SQL string literal.
// Replaces single quotes with doubled single quotes (PostgreSQL standard).
func escapeStringLiteral(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

// SetCommentsRequest defines the JSON body for POST /api/set-comments.
// Supports setting a table-level comment and/or multiple column comments
// in a single request.
type SetCommentsRequest struct {
	TableName      string          `json:"dataset_name"`
	TableComment   string          `json:"table_comment"`
	ColumnComments []ColumnComment `json:"column_comments"`
}

// ColumnComment maps a column name to a descriptive comment.
type ColumnComment struct {
	ColumnName string `json:"column_name"`
	Comment    string `json:"comment"`
}

// SetCommentsHandler handles POST /api/set-comments.
// Sets COMMENT ON TABLE and/or COMMENT ON COLUMN for a given table.
// All identifiers are sanitized. Comment text is parameterized (no injection risk).
func SetCommentsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	var req SetCommentsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("\033[31m[SetCommentsHandler] JSON decode error: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}

	if req.TableName == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "dataset_name is required")
		return
	}

	tableName, err := security.SanitizeIdentifier(req.TableName)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, fmt.Sprintf("Invalid table name: %v", err))
		return
	}

	if req.TableComment == "" && len(req.ColumnComments) == 0 {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "Provide table_comment and/or column_comments")
		return
	}

	results := []string{}

	// Set table-level comment
	if req.TableComment != "" {
		query := fmt.Sprintf(`COMMENT ON TABLE "%s" IS %s`, tableName, escapeStringLiteral(req.TableComment))
		_, err := backend.Db.Exec(query)
		if err != nil {
			log.Printf("[SetCommentsHandler] COMMENT ON TABLE %s failed: %v", tableName, err)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "Failed to set table comment")
			return
		}
		results = append(results, fmt.Sprintf("Table comment set on %s", tableName))
		log.Printf("[SetCommentsHandler] COMMENT ON TABLE %s set", tableName)
	}

	// Set column-level comments
	for _, cc := range req.ColumnComments {
		colName, err := security.SanitizeIdentifier(cc.ColumnName)
		if err != nil {
			httpresponse.RespondWithError(w, http.StatusBadRequest, fmt.Sprintf("Invalid column name '%s': %v", cc.ColumnName, err))
			return
		}

		query := fmt.Sprintf(`COMMENT ON COLUMN "%s"."%s" IS %s`, tableName, colName, escapeStringLiteral(cc.Comment))
		_, err = backend.Db.Exec(query)
		if err != nil {
			log.Printf("[SetCommentsHandler] COMMENT ON COLUMN %s.%s failed: %v", tableName, colName, err)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to set comment on column %s", colName))
			return
		}
		results = append(results, fmt.Sprintf("Column comment set on %s.%s", tableName, colName))
		log.Printf("[SetCommentsHandler] COMMENT ON COLUMN %s.%s set", tableName, colName)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "ok",
		"results": results,
	})
}

// ─── CREATE INDEX ───────────────────────────────────────────────────────────

// CreateIndexesRequest defines the JSON body for POST /api/create-indexes.
// Supports creating multiple indexes on a single table in one request.
type CreateIndexesRequest struct {
	TableName string     `json:"dataset_name"`
	Indexes   []IndexDef `json:"indexes"`
}

// IndexDef defines a single index to create.
// Columns is a list of column names to include in the index.
// Unique controls whether a UNIQUE constraint is applied.
// IndexName is optional — if omitted, a name is generated automatically.
type IndexDef struct {
	IndexName string   `json:"index_name"`
	Columns   []string `json:"columns"`
	Unique    bool     `json:"unique"`
}

// CreateIndexesHandler handles POST /api/create-indexes.
// Creates one or more indexes on a given table. All identifiers are sanitized.
// Uses CREATE INDEX IF NOT EXISTS for idempotent operations.
func CreateIndexesHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	var req CreateIndexesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("\033[31m[CreateIndexesHandler] JSON decode error: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}

	if req.TableName == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "dataset_name is required")
		return
	}

	tableName, err := security.SanitizeIdentifier(req.TableName)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, fmt.Sprintf("Invalid table name: %v", err))
		return
	}

	if len(req.Indexes) == 0 {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "At least one index definition is required")
		return
	}

	results := []string{}

	for i, idx := range req.Indexes {
		if len(idx.Columns) == 0 {
			httpresponse.RespondWithError(w, http.StatusBadRequest, fmt.Sprintf("Index %d: at least one column is required", i))
			return
		}

		// Sanitize all column names
		sanitizedCols := make([]string, len(idx.Columns))
		for j, col := range idx.Columns {
			sanitized, err := security.SanitizeIdentifier(col)
			if err != nil {
				httpresponse.RespondWithError(w, http.StatusBadRequest, fmt.Sprintf("Index %d, invalid column name '%s': %v", i, col, err))
				return
			}
			sanitizedCols[j] = fmt.Sprintf(`"%s"`, sanitized)
		}

		// Generate or sanitize index name
		indexName := idx.IndexName
		if indexName == "" {
			indexName = fmt.Sprintf("idx_%s_%s", tableName, strings.Join(idx.Columns, "_"))
		}
		indexName, err = security.SanitizeIdentifier(indexName)
		if err != nil {
			httpresponse.RespondWithError(w, http.StatusBadRequest, fmt.Sprintf("Index %d, invalid index name '%s': %v", i, idx.IndexName, err))
			return
		}

		// Build CREATE INDEX statement
		uniqueStr := ""
		if idx.Unique {
			uniqueStr = "UNIQUE "
		}
		colList := strings.Join(sanitizedCols, ", ")
		query := fmt.Sprintf(`CREATE %sINDEX IF NOT EXISTS "%s" ON "%s"(%s)`, uniqueStr, indexName, tableName, colList)

		_, err = backend.Db.Exec(query)
		if err != nil {
			log.Printf("[CreateIndexesHandler] CREATE INDEX %s on %s failed: %v", indexName, tableName, err)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to create index %s", indexName))
			return
		}

		results = append(results, fmt.Sprintf("Index %s created on %s(%s)", indexName, tableName, strings.Join(idx.Columns, ", ")))
		log.Printf("[CreateIndexesHandler] Created index %s on %s(%s)", indexName, tableName, strings.Join(idx.Columns, ", "))
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "ok",
		"results": results,
	})
}
