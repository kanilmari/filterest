// user_permissions.go
// Returns the set of URL route endpoints the current user is permitted to access.
// Bridges the user session, the permissions model, and the frontend route-rights cache.
// Exists to let the frontend know which routes to enable without per-request permission checks.
package auth

import (
	"context"
	"database/sql"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/httpresponse"
	e_sessions "easelect/backend/core_components/sessions"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
)

// readGuestUIEndpoints reads only site-wide UI grants from the named guests
// group, independently of anonymous account memberships. Bootstrap never seeds
// defaults here: deleted rights, disabled routes and failed reads remain denied.
func readGuestUIEndpoints(ctx context.Context, db *sql.DB) ([]string, error) {
	if db == nil {
		return nil, fmt.Errorf("guest permission database unavailable")
	}
	rows, err := db.QueryContext(ctx, `
		SELECT DISTINCT f.url_route_endpoint
		FROM system_group_table_func_rights gf
		JOIN system_functions f ON gf.function_id = f.id
		JOIN system_user_groups groups ON gf.user_group_id = groups.id
		WHERE groups.name = 'guests' AND f.disabled = false
		  AND f.url_route_endpoint LIKE '/ui/%'
		  AND gf.target_table_uid IS NULL
		ORDER BY f.url_route_endpoint`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	endpoints := []string{}
	for rows.Next() {
		var endpoint string
		if err := rows.Scan(&endpoint); err != nil {
			return nil, err
		}
		endpoints = append(endpoints, endpoint)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return endpoints, nil
}

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
