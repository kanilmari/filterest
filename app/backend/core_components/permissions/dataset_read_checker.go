// dataset_read_checker.go
// Authorizes ancillary dataset metadata with the ordinary result-read grant.
// Bridges request actors and the shared enabled-function permission query.
// Administrators retain their metadata inventory; guests use their own grants.
package permissions

import (
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	"net/http"
)

func CanReadDataset(q dbutils.Querier, actor dbutils.RequestActorContext, dataset string) (bool, error) {
	if dataset == "" {
		return false, nil
	}
	if actor.IsAdmin {
		return true, nil
	}
	return CheckRouteTablePermission(q, "/api/get-results", actor.UserID, RouteTableScope{TableName: dataset}, AccessControlRouteTableOptions(false))
}

func RequireDatasetRead(w http.ResponseWriter, r *http.Request, q dbutils.Querier, dataset string) bool {
	allowed, err := CanReadDataset(q, dbutils.RequestActorContextFromRequest(r), dataset)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "dataset read authorization unavailable")
		return false
	}
	if !allowed {
		httpresponse.RespondWithError(w, http.StatusForbidden, "forbidden")
		return false
	}
	return true
}
