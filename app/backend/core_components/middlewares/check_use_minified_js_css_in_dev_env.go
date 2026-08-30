// check_use_minified_js_css_in_dev_env.go
// Middleware that determines whether to serve minified or unminified JS/CSS assets.
// Bridges the environment configuration and the template rendering context.
// Exists to select the appropriate asset variant based on dev/prod environment settings.
package middlewares

import (
	"database/sql"
	"fmt"
	"os"
	"strings"

	backend "easelect/backend/core_components"
)

const frontendAssetModeEnvironmentVariable = "FILTEREST_FRONTEND_ASSET_MODE"

// resolveFrontendAssetModeOverride resolves an explicit instance-owned source/dist choice.
// Between protected runtime configuration and the legacy database-backed development toggle.
// Exists so parallel local instances can serve different frontend builds without sharing state.
func resolveFrontendAssetModeOverride(environmentType string, requestedMode string) (bool, bool, error) {
	if environmentType != "dev" {
		return true, true, nil
	}

	switch strings.ToLower(strings.TrimSpace(requestedMode)) {
	case "":
		return false, false, nil
	case "source":
		return false, true, nil
	case "dist":
		return true, true, nil
	default:
		return true, true, fmt.Errorf(
			"%s must be source or dist, got %q",
			frontendAssetModeEnvironmentVariable,
			requestedMode,
		)
	}
}

// ShouldUseMinifiedAssetsInDev returns true when minified JS/CSS should be served.
// Production environments always return true, ensuring hashed bundles stay active.
// Development first honors the instance-owned source/dist environment choice;
// installations without it retain the legacy database-backed toggle.
func ShouldUseMinifiedAssetsInDev() (bool, error) {
	useMinified, resolved, err := resolveFrontendAssetModeOverride(
		os.Getenv("ENVIRONMENT_TYPE"),
		os.Getenv(frontendAssetModeEnvironmentVariable),
	)
	if resolved || err != nil {
		return useMinified, err
	}

	var storedUseMinified sql.NullBool
	err = backend.Db.QueryRow(`
                SELECT boolean_value
                FROM system_config
                WHERE key = 'use_minified_js_css_in_dev_env'
	`).Scan(&storedUseMinified)
	if err != nil {
		if err == sql.ErrNoRows {
			return true, nil
		}
		return true, err
	}

	if !storedUseMinified.Valid {
		return true, nil
	}

	return storedUseMinified.Bool, nil
}
