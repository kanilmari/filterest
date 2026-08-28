// check_login_to_browse.go
// Middleware that enforces authentication before allowing access to browse routes.
// Bridges the session auth state and the login redirect flow.
// Exists to redirect unauthenticated users to the login page on browse-protected routes.
package middlewares

import (
	"database/sql"

	backend "easelect/backend/core_components"
)

// CheckLoginToBrowse hakee system_config -taulusta avaimen 'login_to_browse'.
// Returns false (no login required) when the config key is missing.
func CheckLoginToBrowse() (bool, error) {
	var loginToBrowse bool
	err := backend.Db.QueryRow(`
		SELECT boolean_value
		FROM system_config
		WHERE key = 'login_to_browse'
	`).Scan(&loginToBrowse)
	if err != nil {
		if err == sql.ErrNoRows {
			return false, nil
		}
		return false, err
	}
	return loginToBrowse, nil
}
