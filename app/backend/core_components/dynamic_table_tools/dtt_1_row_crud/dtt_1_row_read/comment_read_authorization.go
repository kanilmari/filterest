// comment_read_authorization.go
// Authorizes the parent dataset and rows before comment storage is accessed.
// Connects polymorphic comments to the canonical read grant and row-policy checks.
// Keeps comments from disclosing hidden records or being attached to missing rows.
package dtt_1_row_read

import (
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/auth"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/permissions"
	"log"
	"net/http"
)

// requireCommentReadAccess uses the same dataset grant, mandatory flags and
// exact-row policy as normal reads, including the pilot's request transaction.
// All requested rows must exist and be visible before any comment is read or written.
func requireCommentReadAccess(w http.ResponseWriter, r *http.Request, dataset string, rowIDs []int) bool {
	actor := dbutils.RequestActorContextFromRequest(r)
	allowed, err := permissions.CheckRouteTablePermission(backend.Db, "/api/get-results", actor.UserID,
		permissions.RouteTableScope{TableName: dataset}, permissions.AccessControlRouteTableOptions(false))
	if err != nil {
		log.Printf("\033[31merror: checking comment dataset permission: %v\033[0m", err)
		httpresponse.RespondWithError(w, 500, "error checking comment access")
		return false
	}
	if !allowed {
		httpresponse.RespondWithError(w, http.StatusForbidden, "dataset read access required")
		return false
	}
	currentDB := auth.GetDBForRole(actor.UserRole)
	if currentDB == nil {
		httpresponse.RespondWithError(w, 500, "row read connection unavailable")
		return false
	}
	policy, err := getLegacyMustTrueReadPolicy(currentDB, dataset)
	if err != nil {
		httpresponse.RespondWithError(w, 500, "error checking row visibility")
		return false
	}
	querier, err := getPilotReadQuerier(r.Context(), dataset, currentDB)
	if err != nil {
		httpresponse.RespondWithError(w, 500, "error initializing row visibility")
		return false
	}
	checked := make(map[int]bool, len(rowIDs))
	for _, rowID := range rowIDs {
		if checked[rowID] {
			continue
		}
		visible, err := isRelatedParentRowVisible(querier, dataset, rowID, actor.UserRole, actor.UserID, policy)
		if err != nil {
			log.Printf("\033[31merror: checking comment row visibility: %v\033[0m", err)
			httpresponse.RespondWithError(w, 500, "error checking row visibility")
			return false
		}
		if !visible {
			httpresponse.RespondWithError(w, http.StatusNotFound, "row not found")
			return false
		}
		checked[rowID] = true
	}
	return true
}
