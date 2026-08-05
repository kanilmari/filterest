// check_registration_enabled.go
// Middleware that checks whether user self-registration is enabled in system configuration.
// Bridges the system_config registration flag and the registration route handlers.
// Exists to block registration routes when the self-registration feature is disabled.
package middlewares

import (
	"database/sql"
	backend "easelect/backend/core_components"
)

// CheckRegistrationEnabled queries system_config for the 'registration_enabled' boolean flag.
// Returns false by default when the key does not exist.
func CheckRegistrationEnabled() bool {
	var enabled bool
	err := backend.Db.QueryRow(`
		SELECT boolean_value
		FROM system_config
		WHERE key = 'registration_enabled'
	`).Scan(&enabled)
	if err != nil {
		if err == sql.ErrNoRows {
			return false // default: registration disabled
		}
		return false
	}
	return enabled
}
