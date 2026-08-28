// check_use_minified_js_css_in_dev_env.go
// Middleware that determines whether to serve minified or unminified JS/CSS assets.
// Bridges the environment configuration and the template rendering context.
// Exists to select the appropriate asset variant based on dev/prod environment settings.
package middlewares

import (
	"database/sql"
	"os"

	backend "easelect/backend/core_components"
)

// ShouldUseMinifiedAssetsInDev returns true when minified JS/CSS should be served.
// Production environments always return true, ensuring hashed bundles stay active.
// In development, the system_config flag defaults to true and can be toggled to
// allow serving unminified source files for easier debugging.
func ShouldUseMinifiedAssetsInDev() (bool, error) {
	if os.Getenv("ENVIRONMENT_TYPE") != "dev" {
		return true, nil
	}

	var useMinified sql.NullBool
	err := backend.Db.QueryRow(`
                SELECT boolean_value
                FROM system_config
                WHERE key = 'use_minified_js_css_in_dev_env'
        `).Scan(&useMinified)
	if err != nil {
		if err == sql.ErrNoRows {
			return true, nil
		}
		return true, err
	}

	if !useMinified.Valid {
		return true, nil
	}

	return useMinified.Bool, nil
}
