// board_handler.go
// Serves one read-only visual snapshot of active development worklines.
// Bridges the admin HTTP route with the observatory's canonical Agent Tools adapter.
// Exists so the frontend can browse exact phases and release scope in one request.
package workline_observatory

import (
	"log"
	"net/http"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/httpresponse"
)

// BoardHandler returns active and paused worklines plus the selected release goal.
func BoardHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed")
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
