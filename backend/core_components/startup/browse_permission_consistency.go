// browse_permission_consistency.go
// Heals an inconsistent bootstrap state where anonymous browsing is enabled but
// the guest principal has no dataset-read rights, which otherwise 403-storms.
// Bridges application startup and the system_config / permission tables.
// Exists so a fresh machine converges to a usable, secure posture without direct SQL.
package startup

import (
	"database/sql"
	"log"
)

// EnsureAnonymousBrowseConsistency guards against a broken bootstrap combination:
// login_to_browse=false (anonymous browsing allowed) while the guest principal
// (user_id=1, see Dictionary "permission principal") has zero tableless right for
// the core browse route /api/datasets. In that state every anonymous page-load
// dataset call returns "403 - Forbidden (function-level)" and the app never
// renders. Some bootstrap seeds have shipped this inconsistent pair.
//
// When detected, it heals to the secure default (login_to_browse=true), so the
// frontend redirects anonymous visitors to /login instead of failing. It never
// touches instances that are already consistent:
//   - login_to_browse=true            -> login-required, nothing to do
//   - guest already has /api/datasets  -> public browse properly configured, nothing to do
//
// Runs synchronously at startup (before ListenAndServe) so the first request
// already sees the corrected posture. Idempotent: after healing, the first guard
// clause short-circuits on every later boot.
func EnsureAnonymousBrowseConsistency(db *sql.DB) {
	// 1. Is anonymous browsing enabled? A missing row means "no login required".
	var loginToBrowse sql.NullBool
	err := db.QueryRow(`SELECT boolean_value FROM system_config WHERE key = 'login_to_browse'`).Scan(&loginToBrowse)
	if err != nil && err != sql.ErrNoRows {
		log.Printf("\033[31merror: [STARTUP] anonymous-browse consistency: login_to_browse read failed: %v\033[0m", err)
		return
	}
	if loginToBrowse.Valid && loginToBrowse.Bool {
		// Login already required -> guest 403s are expected and handled by the
		// forced-login flow, not an inconsistency.
		return
	}

	// 2. With anonymous browsing enabled, can the guest principal actually read
	//    the dataset catalog? This mirrors the tableless permission check in
	//    access_control.userHasFunctionPermissionOnTable for route /api/datasets.
	var guestCanReadDatasets bool
	err = db.QueryRow(`
		SELECT EXISTS (
			SELECT 1
			FROM system_group_table_func_rights gf
			JOIN system_functions f ON gf.function_id = f.id
			JOIN system_user_group_memberships ug ON gf.user_group_id = ug.group_id
			WHERE f.url_route_endpoint = '/api/datasets'
			  AND ug.user_id = 1
			  AND gf.target_table_uid IS NULL
		)`).Scan(&guestCanReadDatasets)
	if err != nil {
		log.Printf("\033[31merror: [STARTUP] anonymous-browse consistency: guest permission probe failed: %v\033[0m", err)
		return
	}
	if guestCanReadDatasets {
		// Anonymous browsing is genuinely configured (public-browse instance).
		return
	}

	// 3. Inconsistent: anonymous browsing is on but the guest can read nothing.
	//    Heal to the secure default so the app is usable instead of 403-storming.
	_, err = db.Exec(`
		INSERT INTO system_config (key, json_value, boolean_value, text_value, value_type, creation_spec)
		VALUES ('login_to_browse', '{"value": true}'::jsonb, TRUE, 'true', 2, 'startup anonymous-browse consistency guard')
		ON CONFLICT (key) DO UPDATE SET
			json_value    = jsonb_set(COALESCE(system_config.json_value, '{}'::jsonb), '{value}', 'true'::jsonb, true),
			boolean_value = TRUE,
			text_value    = 'true',
			updated       = NOW()`)
	if err != nil {
		log.Printf("\033[31merror: [STARTUP] anonymous-browse consistency: heal failed: %v\033[0m", err)
		return
	}

	log.Printf("\033[33m[STARTUP] Inconsistent bootstrap detected: anonymous browsing was enabled but the guest " +
		"principal has no dataset-read rights. Forced login_to_browse=true (login required) so the app is usable. " +
		"To run a public-browse instance instead, grant the guests group read rights and set login_to_browse=false.\033[0m")
}
