// user_role_resolver.go
// Resolves the application-level role string for an authenticated user.
// Bridges stored group memberships and the backend DB-pool router.
// Exists so login, auth bootstrap, and request middleware share one role mapping.
package backend

import (
	"database/sql"
	"fmt"
)

const adminGroupID = 1

// ResolveUserRole maps a user id to the runtime role string used by request DB routing.
func ResolveUserRole(userID int) (string, error) {
	if userID <= 1 {
		return "guest", nil
	}

	isAdmin, err := userHasAdminGroupMembership(userID)
	if err != nil {
		return "", err
	}
	if isAdmin {
		return "admin", nil
	}
	return "basic", nil
}

func userHasAdminGroupMembership(userID int) (bool, error) {
	roleDB := DbGuest
	if roleDB == nil {
		roleDB = Db
	}
	if roleDB == nil {
		return false, fmt.Errorf("role resolver database unavailable")
	}

	var dummy int
	err := roleDB.QueryRow(
		`SELECT 1 FROM system_user_group_memberships WHERE user_id = $1 AND group_id = $2`,
		userID,
		adminGroupID,
	).Scan(&dummy)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}
