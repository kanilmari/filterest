// board_handler.go
// Serves one read-only visual snapshot of active development worklines.
// Bridges the admin HTTP route with the observatory's canonical Agent Tools adapter.
// Exists so the frontend can browse exact phases and release scope in one request.
package workline_observatory

import (
	"log"
	"net/http"
	"strconv"
	"strings"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/httpresponse"
)

// BoardHandler returns the board or the bounded report history of one workline.
func BoardHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	if rawWorklineID := strings.TrimSpace(r.URL.Query().Get("workline_id")); rawWorklineID != "" {
		worklineID, err := parseReportHistoryWorklineID(rawWorklineID)
		if err != nil {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid_workline_id")
			return
		}
		history, err := loadBoardWorklineReportHistory(r.Context(), backend.Db, worklineID)
		if err != nil {
			log.Printf("workline observatory report history failed: %v", err)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "workline_observatory_history_unavailable")
			return
		}
		httpresponse.RespondWithJSON(w, http.StatusOK, history)
		return
	}
	snapshot, err := loadBoardSnapshot(r.Context(), backend.Db)
	if err != nil {
		log.Printf("workline observatory board failed: %v", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "workline_observatory_unavailable")
		return
	}
	httpresponse.RespondWithJSON(w, http.StatusOK, snapshot)
}

func parseReportHistoryWorklineID(value string) (int64, error) {
	worklineID, err := strconv.ParseInt(value, 10, 64)
	if err != nil || worklineID <= 0 {
		return 0, strconv.ErrSyntax
	}
	return worklineID, nil
}
