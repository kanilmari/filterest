// registered_user_checker.go
// Refuses anonymous and guest calls to authenticated resource-consuming helpers.
// Bridges core route policy and reusable handlers without adding core imports there.
// Existing pipeline authentication still validates signed-in identities first.
package auth

import (
	"easelect/backend/core_components/httpresponse"
	e_sessions "easelect/backend/core_components/sessions"
	"net/http"
)

func WithRegisteredUser(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := e_sessions.GetUserIDFromSession(r)
		if err != nil || id <= 1 {
			httpresponse.RespondWithError(w, 403, "forbidden")
			return
		}
		next(w, r)
	}
}
