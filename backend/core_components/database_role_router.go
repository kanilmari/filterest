// database_role_router.go
// Resolves the runtime database pool that should back a request for a given application role.
// Bridges request/session role strings and the backend package's role-specific SQL pools.
// Exists so request-scoped transactions can use the same visibility baseline as non-transactional reads.
package backend

import (
	"database/sql"
	"net/http"
	"strings"
)

const requestPolicyOnlyAdminPilotTableName = "app_service_catalog"

// GetRequestDBForRole returns the role-aligned DB handle for runtime request work.
// It prefers the dedicated pool for the supplied role and falls back to Db only when
// the specific role pool is unavailable.
func GetRequestDBForRole(role string) *sql.DB {
	switch role {
	case "admin":
		if DbAdmin != nil {
			return DbAdmin
		}
	case "basic":
		if DbBasic != nil {
			return DbBasic
		}
	case "guest":
		if DbGuest != nil {
			return DbGuest
		}
	default:
		if DbGuest != nil {
			return DbGuest
		}
	}
	return Db
}

// GetRequestDBForRequest returns the request DB handle for runtime request work.
// The first RLS pilot uses the basic pool for admin requests targeting
// app_service_catalog so tx-local app.is_admin must be honored by policy
// instead of silently succeeding via the privileged admin pool.
func GetRequestDBForRequest(role string, request *http.Request) *sql.DB {
	if shouldUsePolicyOnlyAdminPilotPool(role, request) && DbBasic != nil {
		return DbBasic
	}
	return GetRequestDBForRole(role)
}

func shouldUsePolicyOnlyAdminPilotPool(role string, request *http.Request) bool {
	if role != "admin" || request == nil || request.URL == nil {
		return false
	}
	return strings.TrimSpace(request.URL.Query().Get("dataset")) == requestPolicyOnlyAdminPilotTableName
}
