// check_registration_enabled.go
// Middleware that checks whether user self-registration is enabled in system configuration.
// Bridges the system_config registration flag and the registration route handlers.
// Exists to block registration routes when the self-registration feature is disabled.
package middlewares

import (
	"database/sql"
	backend "easelect/backend/core_components"
	"encoding/json"
)

// CheckRegistrationEnabled queries system_config for the 'registration_enabled' boolean flag.
// Returns false by default when the key does not exist.
func CheckRegistrationEnabled() bool {
	var enabled sql.NullBool
	var jsonValue []byte
	err := backend.Db.QueryRow(`
		SELECT boolean_value, json_value
		FROM system_config
		WHERE key = 'registration_enabled'
	`).Scan(&enabled, &jsonValue)
	if err != nil {
		if err == sql.ErrNoRows {
			return false // default: registration disabled
		}
		return false
	}
	return registrationEnabledValue(enabled, jsonValue)
}

func registrationEnabledValue(enabled sql.NullBool, jsonValue []byte) bool {
	if enabled.Valid {
		return enabled.Bool
	}
	var document struct {
		Value bool `json:"value"`
	}
	if len(jsonValue) == 0 || json.Unmarshal(jsonValue, &document) != nil {
		return false
	}
	return document.Value
}
