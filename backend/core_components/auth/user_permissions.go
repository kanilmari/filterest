// user_permissions.go
// Returns the set of URL route endpoints the current user is permitted to access.
// Bridges the user session, the permissions model, and the frontend route-rights cache.
// Exists to let the frontend know which routes to enable without per-request permission checks.
package auth

import (
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/httpresponse"
	e_sessions "easelect/backend/core_components/sessions"
	"encoding/json"
	"log"
	"net/http"
)

// UserPermissionsResponse keeps the login-only permission cache payload stable for typed frontend callers.
type UserPermissionsResponse struct {
	Endpoints []string `json:"endpoints"`
}

// UserPermissionsHandler returns url_route_endpoint values that the current user is allowed to access.
func UserPermissionsHandler(w http.ResponseWriter, r *http.Request) {
	userID, err := e_sessions.GetUserIDFromSession(r)
	if err != nil || userID <= 0 {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	query := `
        SELECT DISTINCT f.url_route_endpoint
        FROM system_group_table_func_rights gf
        JOIN system_functions f ON gf.function_id = f.id
        JOIN system_user_group_memberships ug ON gf.user_group_id = ug.group_id
        WHERE ug.user_id = $1 AND f.disabled = false
          AND f.url_route_endpoint IS NOT NULL AND f.url_route_endpoint != ''
    `
	rows, err := backend.Db.Query(query, userID)
	if err != nil {
		log.Printf("\033[31merror: UserPermissionsHandler query failed: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "query error")
		return
	}
	defer rows.Close()

	endpoints := []string{}
	for rows.Next() {
		var ep string
		if err := rows.Scan(&ep); err != nil {
			log.Printf("\033[31merror: UserPermissionsHandler scan failed: %v\033[0m", err)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "scan error")
			return
		}
		endpoints = append(endpoints, ep)
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(UserPermissionsResponse{Endpoints: endpoints}); err != nil {
		log.Printf("\033[31merror: UserPermissionsHandler encode failed: %v\033[0m", err)
	}
}
