// rebuild_search_vectors.go
// HTTP handler that triggers a full rebuild of the full-text search vectors for a specified table.
// Recomputes tsvector values for all rows and updates the search index.
// Exists to repair or initialize search vectors through a routed admin API path.
package dtt_search_vectors

import (
	"database/sql"
	"easelect/backend/core_components/httpresponse"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"

	"easelect/backend/core_components/dbutils"
	e_sessions "easelect/backend/core_components/sessions"

	"github.com/lib/pq"
)

type rebuildRequest struct {
	Dataset string `json:"dataset"`
}

func RebuildSearchVectorHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only POST allowed")
		return
	}
	userID, err := e_sessions.GetUserIDFromSession(r)
	if err != nil || userID <= 0 {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req rebuildRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid request")
		return
	}
	table := strings.TrimSpace(req.Dataset)
	if table == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "missing dataset")
		return
	}
	tx, ok := dbutils.GetTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction missing")
		return
	}
	if err := rebuildSearchVector(tx, table); err != nil {
		log.Printf("[RebuildSearchVector] rebuild error for %s: %v", table, err)
		_ = tx.Rollback()
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "search vector rebuild failed")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"status":"ok"}`))
}

func rebuildSearchVector(db *sql.Tx, table string) error {
	alter := fmt.Sprintf(`ALTER TABLE %s ADD COLUMN IF NOT EXISTS search_vector_simple TSVECTOR`, pq.QuoteIdentifier(table))
	if _, err := db.Exec(alter); err != nil {
		return fmt.Errorf("alter table add search_vector_simple: %w", err)
	}
	cols, err := dbutils.GetQueryableColumns(table, db, false)
	if err != nil {
		return fmt.Errorf("get filtered columns: %w", err)
	}
	if len(cols) > 0 {
		var parts []string
		for _, c := range cols {
			parts = append(parts, fmt.Sprintf("coalesce(%s::text,'')", pq.QuoteIdentifier(c)))
		}
		concat := strings.Join(parts, " || ' ' || ")
		update := fmt.Sprintf(`UPDATE %s SET search_vector_simple = to_tsvector('simple', %s)`, pq.QuoteIdentifier(table), concat)
		if _, err := db.Exec(update); err != nil {
			return fmt.Errorf("update search_vector_simple: %w", err)
		}
	}
	idxName := "idx_" + table + "_sv_simple"
	createIdx := fmt.Sprintf(`CREATE INDEX IF NOT EXISTS %s ON %s USING GIN (search_vector_simple)`,
		pq.QuoteIdentifier(idxName), pq.QuoteIdentifier(table))
	_, err = db.Exec(createIdx)
	if err != nil {
		return fmt.Errorf("create index %s: %w", idxName, err)
	}
	return nil
}
