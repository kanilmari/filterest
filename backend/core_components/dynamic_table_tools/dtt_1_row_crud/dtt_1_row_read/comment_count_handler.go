// comment_count_handler.go
// Batch endpoint that returns comment counts per parent row.
// Bridges the system_comments table and the frontend badge/count display.
// Exists to fetch comment counts for multiple rows in a single request.

package dtt_1_row_read

import (
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/httpresponse"
	"encoding/json"
	"log"
	"net/http"
	"strconv"

	"github.com/lib/pq"
)

// Request body: { dataset, row_ids: [...] }
// Response body: { counts: { "<row_id>": <count> } }
// CommentCountHandler handles POST /api/comment-counts
func CommentCountHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var body struct {
		Dataset string `json:"dataset"`
		RowIDs  []int  `json:"row_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if body.Dataset == "" || len(body.RowIDs) == 0 {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "dataset and row_ids are required")
		return
	}

	// Cap to prevent abuse
	if len(body.RowIDs) > 500 {
		body.RowIDs = body.RowIDs[:500]
	}

	rows, err := backend.Db.Query(`
		SELECT row_id, COUNT(*)
		FROM system_comments
		WHERE table_name = $1 AND row_id = ANY($2)
		GROUP BY row_id`,
		body.Dataset, pq.Array(body.RowIDs),
	)
	if err != nil {
		log.Printf("\033[31merror: counting comments batch: %s\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error counting comments")
		return
	}
	defer rows.Close()

	counts := make(map[string]int)
	for rows.Next() {
		var rowID, count int
		if err := rows.Scan(&rowID, &count); err != nil {
			log.Printf("\033[31merror: scanning comment count: %s\033[0m", err)
			continue
		}
		counts[strconv.Itoa(rowID)] = count
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"counts": counts,
	})
}
