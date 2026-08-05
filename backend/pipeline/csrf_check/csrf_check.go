// csrf_check.go
// Pipeline stage that enforces CSRF token validation on state-changing HTTP methods.
// Bridges the X-CSRF-Token header (or form field) and the session-stored token.
// Exists to reject forged cross-site requests, with profile-based bypass replacing hardcoded exceptions.
package csrf_check

import (
	"fmt"
	"net/http"
	"os"
	"strings"

	"easelect/backend/core_components/httpresponse"
	e_sessions "easelect/backend/core_components/sessions"
)

// WithCSRFCheck validates the CSRF token for state-changing requests.
// Safe methods (GET, HEAD, OPTIONS) pass through without checks.
//
// This is a pipeline stage function: it takes and returns http.HandlerFunc,
// matching the pipeline's StageFunc signature.
func WithCSRFCheck(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
			fmt.Fprintf(os.Stderr, "CSRF pipeline check for method: %s, path: %s\n", r.Method, r.URL.Path)
			os.Stderr.Sync()

			// State-changing method — validate CSRF token
			session, err := e_sessions.GetOrCreateSession(w, r)
			if err != nil {
				httpresponse.RespondWithError(w, http.StatusForbidden, "invalid session")
				return
			}
			sessionToken, _ := session.Values["csrf_token"].(string)
			if sessionToken == "" {
				httpresponse.RespondWithError(w, http.StatusForbidden, "missing CSRF token")
				return
			}

			// Try header first, then form field
			token := r.Header.Get("X-CSRF-Token")
			if token == "" {
				ct := r.Header.Get("Content-Type")
				if strings.HasPrefix(ct, "multipart/form-data") {
					if err := r.ParseMultipartForm(50 << 20); err == nil {
						token = r.Form.Get("csrf_token")
					}
				} else if err := r.ParseForm(); err == nil {
					token = r.Form.Get("csrf_token")
				}
			}
			if token == "" || token != sessionToken {
				fmt.Fprintf(os.Stderr, "CSRF check failed for %s %s\n", r.Method, r.URL.Path)
				os.Stderr.Sync()
				httpresponse.RespondWithError(w, http.StatusForbidden, "missing CSRF token")
				return
			}
		}

		// Safe method or valid token — proceed
		next(w, r)
	}
}
