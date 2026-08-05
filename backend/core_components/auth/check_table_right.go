// check_table_right.go
// Checks whether the current user has access rights for a specific table route.
// Bridges the permissions database and the pipeline access-control stage.
// Exists to query the permissions model and return an allow/deny decision per table-route pair.
package auth

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/permissions"
	e_sessions "easelect/backend/core_components/sessions"
)

func resolvePermissionScope(tableName, tableUID string, q dbutils.Querier) permissions.RouteTableScope {
	scope := permissions.RouteTableScope{
		TableName: tableName,
		TableUID:  tableUID,
	}
	resolvedScope, err := permissions.ResolveRouteTableScope(q, scope)
	if err != nil {
		return scope.Normalize()
	}
	return resolvedScope
}

func checkRouteTablePermission(q dbutils.Querier, route string, userID int, scope permissions.RouteTableScope) bool {
	allowed, err := permissions.CheckRouteTablePermission(q, route, userID, scope, permissions.StrictRouteTableOptions())
	return err == nil && allowed
}

func queryAllowedRoutes(q dbutils.Querier, routes []string, userID int, scope permissions.RouteTableScope) (map[string]bool, error) {
	return permissions.QueryAllowedRoutes(q, routes, userID, scope, permissions.StrictRouteTableOptions())
}

type CheckTableRightsRequest struct {
	Dataset    string   `json:"dataset"`
	DatasetUID string   `json:"dataset_uid"`
	Routes     []string `json:"routes"`
}

type CheckTableRightsResponse struct {
	AllowedByRoute map[string]bool `json:"allowed_by_route"`
}

type CheckTableRightsMultiRequest struct {
	Items []CheckTableRightsRequest `json:"items"`
}

type CheckTableRightsMultiResult struct {
	Dataset        string          `json:"dataset"`
	DatasetUID     string          `json:"dataset_uid,omitempty"`
	AllowedByRoute map[string]bool `json:"allowed_by_route"`
}

type CheckTableRightsMultiResponse struct {
	Results []CheckTableRightsMultiResult `json:"results"`
}

func normalizeRequestedRoutes(routes []string) []string {
	return permissions.NormalizeRouteEndpoints(routes)
}

// CheckTableRightHandler verifies if the current user has rights to a
// particular route for a specific table.
func CheckTableRightHandler(w http.ResponseWriter, r *http.Request) {
	userID, err := e_sessions.GetUserIDFromSession(r)
	if err != nil || userID <= 0 {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	route := r.URL.Query().Get("route")
	if route == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "missing route")
		return
	}
	scope := resolvePermissionScope(
		r.URL.Query().Get("dataset"),
		r.URL.Query().Get("dataset_uid"),
		backend.Db,
	)
	allowed := checkRouteTablePermission(backend.Db, route, userID, scope)

	log.Printf("CheckTableRightHandler: route=%s, table=%s, uid=%s, userID=%d -> allowed=%v", route, scope.TableName, scope.TableUID, userID, allowed)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"allowed": allowed})
}

// CheckTableRightsHandler verifies a batch of route rights for one dataset scope.
func CheckTableRightsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only POST method is allowed")
		return
	}

	userID, err := e_sessions.GetUserIDFromSession(r)
	if err != nil || userID <= 0 {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req CheckTableRightsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, fmt.Errorf("invalid input: %w", err).Error())
		return
	}

	routes := normalizeRequestedRoutes(req.Routes)
	if len(routes) == 0 {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "missing routes")
		return
	}

	scope := resolvePermissionScope(req.Dataset, req.DatasetUID, backend.Db)
	allowedByRoute, err := queryAllowedRoutes(backend.Db, routes, userID, scope)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("failed to check table rights: %v", err))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(CheckTableRightsResponse{
		AllowedByRoute: allowedByRoute,
	})
}

// CheckTableRightsMultiHandler verifies route rights for multiple dataset scopes in one request.
func CheckTableRightsMultiHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only POST method is allowed")
		return
	}

	userID, err := e_sessions.GetUserIDFromSession(r)
	if err != nil || userID <= 0 {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req CheckTableRightsMultiRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, fmt.Errorf("invalid input: %w", err).Error())
		return
	}
	if len(req.Items) == 0 {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "missing items")
		return
	}

	results := make([]CheckTableRightsMultiResult, 0, len(req.Items))
	for _, item := range req.Items {
		routes := normalizeRequestedRoutes(item.Routes)
		if len(routes) == 0 {
			continue
		}

		scope := resolvePermissionScope(item.Dataset, item.DatasetUID, backend.Db)
		allowedByRoute, err := queryAllowedRoutes(backend.Db, routes, userID, scope)
		if err != nil {
			httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("failed to check table rights: %v", err))
			return
		}

		results = append(results, CheckTableRightsMultiResult{
			Dataset:        item.Dataset,
			DatasetUID:     item.DatasetUID,
			AllowedByRoute: allowedByRoute,
		})
	}
	if len(results) == 0 {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "missing routes")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(CheckTableRightsMultiResponse{
		Results: results,
	})
}
