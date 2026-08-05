// get_user_id_from_session.go
// Retrieves the authenticated user's ID from the current HTTP session. Returns the user ID
// stored during login for use by request handlers and middleware.
// Exists to give handlers one canonical session-to-user lookup helper.
package e_sessions

import (
	"fmt"
	"net/http"
)

// getUserIDFromSession lukee user_id:n Gorilla-sessiosta.
func GetUserIDFromSession(r *http.Request) (int, error) {
	store := GetStore()
	session, err := store.Get(r, SessionName)
	if err != nil {
		return 0, fmt.Errorf("session get failed: %w", err)
	}
	val, ok := session.Values["user_id"]
	if !ok {
		return 0, fmt.Errorf("user_id missing from session")
	}
	userID, ok2 := val.(int)
	if !ok2 {
		return 0, fmt.Errorf("user_id is not an int")
	}
	return userID, nil
}
