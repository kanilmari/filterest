// text_index_status.go
// Provides an HTTP endpoint that returns the current status of the full-text search index for
// a table. Reports coverage, staleness, and configuration of the text search vectors.
// Exists so admins can inspect search-index readiness before running rebuild work.
package dtt_search_vectors

import (
	"easelect/backend/core_components/httpresponse"
	"encoding/json"
	"log"
	"net/http"

	backend "easelect/backend/core_components"
)

type textIndexInfo struct {
	Dataset  string `json:"dataset"`
	HasIndex bool   `json:"has_index"`
}

func TextIndexStatusHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only GET allowed")
		return
	}
	query := `
SELECT t.table_name,
       EXISTS (
           SELECT 1 FROM pg_indexes
           WHERE schemaname = 'public'
             AND tablename = t.table_name
             AND indexname = 'idx_' || t.table_name || '_sv_simple'
       ) AS has_index
FROM information_schema.tables t
WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
ORDER BY t.table_name;`
	rows, err := backend.Db.Query(query)
	if err != nil {
		log.Printf("\033[31mquery text index status: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "query error")
		return
	}
	defer rows.Close()

	var results []textIndexInfo
	for rows.Next() {
		var info textIndexInfo
		if err := rows.Scan(&info.Dataset, &info.HasIndex); err != nil {
			log.Printf("\033[31mscan text index status: %v\033[0m", err)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "scan error")
			return
		}
		results = append(results, info)
	}
	if err := rows.Err(); err != nil {
		log.Printf("\033[31merror: rows iteration error in TextIndexStatusHandler: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "rows iteration error")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(results)
}
