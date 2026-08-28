// db_for_role.go
// Returns the appropriate database connection handle for a given user role.
// Bridges role strings (admin, basic, guest) and the backend package's *sql.DB pool map.
// Exists to centralise role-to-connection mapping with a safe guest fallback for unknown roles.
package auth

import (
	"database/sql"
	backend "easelect/backend/core_components"
)

// GetDBForRole returns the database handle for a given role.
// Unknown roles default to the guest connection.
func GetDBForRole(role string) *sql.DB {
	switch role {
	case "admin":
		if backend.DbAdmin != nil {
			return backend.DbAdmin
		}
	case "basic":
		if backend.DbBasic != nil {
			return backend.DbBasic
		}
	case "guest":
		if backend.DbGuest != nil {
			return backend.DbGuest
		}
	default:
		if backend.DbGuest != nil {
			return backend.DbGuest
		}
	}
	return backend.DbGuest
}
