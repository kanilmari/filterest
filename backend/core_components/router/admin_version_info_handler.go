// admin_version_info_handler.go
// Serves the running product and database versions to authorized administrators.
// Bridges the existing readiness snapshot with the filterbar's admin-only version indicator.
// Exists so the UI does not rely on a cosmetically hidden public endpoint for role-gated details.
package router

import (
	"net/http"
	"os"
	"strings"

	"easelect/backend/core_components/httpresponse"
)

const (
	adminRuntimeModeDocker = "docker"
	adminRuntimeModeNative = "native"
)

type adminVersionInfoResponse struct {
	ProductName       string `json:"product_name"`
	AppVersion        string `json:"app_version"`
	DBVersion         string `json:"db_version"`
	RequiredDBVersion string `json:"required_db_version"`
	DBCompatible      bool   `json:"db_compatible"`
	RuntimeMode       string `json:"runtime_mode"`
}

// currentAdminRuntimeMode returns a stable, non-secret execution-mode value.
// Docker images opt in through EASELECT_RUNTIME_MODE; ordinary host processes
// fall back to native so the admin UI never exposes an unreviewed env value.
func currentAdminRuntimeMode() string {
	if strings.EqualFold(strings.TrimSpace(os.Getenv("EASELECT_RUNTIME_MODE")), adminRuntimeModeDocker) {
		return adminRuntimeModeDocker
	}
	return adminRuntimeModeNative
}

func adminVersionInfoHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	readiness := systemReadinessProbe()
	httpresponse.RespondWithJSON(w, http.StatusOK, adminVersionInfoResponse{
		ProductName:       readiness.ProductName,
		AppVersion:        readiness.AppVersion,
		DBVersion:         readiness.DBVersion,
		RequiredDBVersion: readiness.RequiredDBVersion,
		DBCompatible:      readiness.DBCompatible,
		RuntimeMode:       currentAdminRuntimeMode(),
	})
}
