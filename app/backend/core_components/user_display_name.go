// user_display_name.go
// Reads one account's public display name by the account's id.
// Between the logs and provenance writers that name who acted, and the public user table.
// Exists because the session no longer carries a name: a copy in the cookie went stale when the name
// changed in another browser, and before the login name was separated it was the login name itself.
package backend

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

// DisplayNameLookupTimeout bounds a name read made only to label a log or a
// provenance field, so a slow user table costs that label and never the work
// it accompanies.
const DisplayNameLookupTimeout = 2 * time.Second

// UserDisplayName returns the display name of the account with this id, the one
// other people see. It is one primary-key read, made when a name is needed, so
// every browser of a renamed account is named by its current name at once.
func UserDisplayName(ctx context.Context, db *sql.DB, userID int) (string, error) {
	if db == nil {
		return "", errors.New("display name lookup: database is not available")
	}
	var displayName string
	if err := db.QueryRowContext(ctx, `SELECT username FROM system_users WHERE id = $1`, userID).Scan(&displayName); err != nil {
		return "", err
	}
	return displayName, nil
}

// UserDisplayNameOr returns the display name of a signed-in account, or fallback
// for the guest account (id 1, and anything lower), a name that cannot be read
// within DisplayNameLookupTimeout or an empty one. Logs and provenance use it:
// they name who acted when that is a signed-in person, and a request never fails
// or waits long over the name.
func UserDisplayNameOr(ctx context.Context, db *sql.DB, userID int, fallback string) string {
	if userID <= 1 {
		return fallback
	}
	ctx, cancel := context.WithTimeout(ctx, DisplayNameLookupTimeout)
	defer cancel()
	displayName, err := UserDisplayName(ctx, db, userID)
	if err != nil || strings.TrimSpace(displayName) == "" {
		return fallback
	}
	return strings.TrimSpace(displayName)
}
