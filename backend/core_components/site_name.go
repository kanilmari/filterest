// site_name.go
// Reads the administrator-owned site identity from the shared system configuration.
// Exists so browser-facing pages use the First Run choice instead of deployment defaults.
package backend

import (
	"context"
	"database/sql"
	"strings"
)

const siteNameConfigKey = "site_name"

// ConfiguredSiteName returns the saved site identity or an empty string when
// setup has not chosen one yet or the configuration cannot be read. Callers
// retain their own host, environment, or product fallback for that case.
func ConfiguredSiteName(ctx context.Context, db *sql.DB) string {
	if db == nil {
		return ""
	}

	var siteName string
	err := db.QueryRowContext(ctx, `
		SELECT COALESCE(
			NULLIF(BTRIM(text_value), ''),
			NULLIF(BTRIM(json_value ->> 'value'), ''),
			''
		)
		FROM system_config
		WHERE key = $1
	`, siteNameConfigKey).Scan(&siteName)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(siteName)
}
