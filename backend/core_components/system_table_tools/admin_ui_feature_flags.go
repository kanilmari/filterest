// admin_ui_feature_flags.go
// Serves the small allowlist of administrator-only user-interface feature flags.
// Bridges protected system configuration with short-lived admin testing controls.
// Exists so public configuration responses never expose internal preview switches.
package system_table_tools

import (
	"net/http"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/httpresponse"
)

const adminCoverImageTestPaletteConfigKey = "view_admin_cover_image_test_palette"

const adminUIFeatureFlagsQuery = `
	SELECT COALESCE((
		SELECT boolean_value
		FROM public.system_config
		WHERE key = $1
	), FALSE)`

// AdminUIFeatureFlagsResponse is the explicit response allowlist for protected UI flags.
type AdminUIFeatureFlagsResponse struct {
	ViewAdminCoverImageTestPalette bool `json:"view_admin_cover_image_test_palette"`
}

var readAdminUIFeatureFlags = func() (AdminUIFeatureFlagsResponse, error) {
	response := AdminUIFeatureFlagsResponse{}
	err := backend.Db.QueryRow(
		adminUIFeatureFlagsQuery,
		adminCoverImageTestPaletteConfigKey,
	).Scan(&response.ViewAdminCoverImageTestPalette)
	return response, err
}

// GetAdminUIFeatureFlagsHandler returns only explicitly allowlisted admin UI flags.
// The router assigns this handler the admin profile before it can read configuration.
func GetAdminUIFeatureFlagsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	flags, err := readAdminUIFeatureFlags()
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "admin UI feature flags unavailable")
		return
	}
	httpresponse.RespondWithJSON(w, http.StatusOK, flags)
}
