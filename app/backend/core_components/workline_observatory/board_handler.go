// board_handler.go
// Serves one read-only visual snapshot of active development worklines.
// Bridges the admin HTTP route with the observatory's canonical Agent Tools adapter.
// Exists so the frontend can browse exact phases and release scope in one request.
package workline_observatory

import (
	"database/sql"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/httpresponse"
)

// BoardHandler returns the board or the bounded report history of one workline.
func BoardHandler(w http.ResponseWriter, r *http.Request) {

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
	// The board and its search read one moment of the database (see boardReader).
	tx, err := backend.Db.BeginTx(r.Context(), &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		log.Printf("workline observatory board failed: %v", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "workline_observatory_unavailable")
		return
	}
	defer func() { _ = tx.Rollback() }()
	snapshot, err := loadBoardSnapshot(r.Context(), tx)
	if err != nil {
		log.Printf("workline observatory board failed: %v", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "workline_observatory_unavailable")
		return
	}
	searchMatches, err := loadBoardSearchMatches(r.Context(), tx, r.URL.Query().Get("search"))
	// Every read is done: give the connection back before filtering and before a
	// slow client receives the answer. The deferred rollback covers early returns.
	_ = tx.Rollback()
	if errors.Is(err, errWorklineSearchTooLong) {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err != nil {
		log.Printf("workline observatory search failed: %v", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "workline_observatory_unavailable")
		return
	}
	snapshot, err = queryBoardSnapshot(snapshot, r.URL.Query(), searchMatches)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
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
