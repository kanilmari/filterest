// site_assistant_guard.go
// Keeps a site assistant session reading freely but writing only approved calls.
// Runs for every route, before auth can downgrade a session to guest.
// Exists because an assistant acts as a real administrator, so its writes need the owner's plan.
package site_assistant_guard

import (
	"bytes"
	"io"
	"log"
	"net/http"

	"easelect/backend/core_components/httpresponse"
	e_sessions "easelect/backend/core_components/sessions"
	"easelect/backend/core_components/site_assistant"

	gorilla "github.com/gorilla/sessions"
)

// maxGuardedRequestBody bounds the body the guard hashes for approval matching.
// The request-size stage already rejects larger bodies on protected routes.
const maxGuardedRequestBody = 8 << 20

// WithSiteAssistantGuard checks the delegation behind an assistant session.
// Requests without an assistant session pass through untouched.
func WithSiteAssistantGuard(next http.HandlerFunc) http.HandlerFunc {
	return WithSiteAssistantGuardStore(site_assistant.DefaultStore, next)
}

// WithSiteAssistantGuardStore is the testable form that takes an explicit store.
func WithSiteAssistantGuardStore(store *site_assistant.Store, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, err := r.Cookie(e_sessions.SessionName); err != nil || e_sessions.Store == nil {
			next(w, r)
			return
		}
		session, err := e_sessions.Store.Get(r, e_sessions.SessionName)
		if err != nil {
			// An unreadable cookie carries no assistant identity; ordinary auth handles it.
			next(w, r)
			return
		}
		delegationID, ok := session.Values[site_assistant.SessionDelegationKey].(string)
		if !ok || delegationID == "" {
			next(w, r)
			return
		}

		w.Header().Set("Cache-Control", "no-store")
		delegation, err := store.Lookup(delegationID)
		if err != nil {
			endAssistantSession(w, r, session)
			httpresponse.RespondWithError(w, http.StatusUnauthorized, "site_assistant_delegation_expired")
			return
		}
		if userID, _ := session.Values["user_id"].(int); userID != delegation.UserID {
			endAssistantSession(w, r, session)
			httpresponse.RespondWithError(w, http.StatusUnauthorized, "site_assistant_delegation_mismatch")
			return
		}
		if !site_assistant.RequestIsWrite(r.Method) {
			next(w, r)
			return
		}

		body, readErr := io.ReadAll(io.LimitReader(r.Body, maxGuardedRequestBody+1))
		_ = r.Body.Close()
		if readErr != nil || len(body) > maxGuardedRequestBody {
			httpresponse.RespondWithError(w, http.StatusRequestEntityTooLarge, "site_assistant_request_body_too_large")
			return
		}
		r.Body = io.NopCloser(bytes.NewReader(body))
		r.ContentLength = int64(len(body))

		bodyHash := site_assistant.HashRequestBody(body)
		canonicalQuery, queryErr := site_assistant.CanonicalQuery(r.URL.RawQuery)
		if queryErr != nil {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid query parameters")
			return
		}
		if approvalErr := store.UseWriteApproval(delegationID, r.Method, r.URL.Path, canonicalQuery, bodyHash); approvalErr != nil {
			log.Printf("[site_assistant_guard] unapproved %s %s for delegation %s", r.Method, r.URL.Path, delegationID)
			httpresponse.RespondWithJSON(w, http.StatusForbidden, map[string]any{
				"error": "site_assistant_approval_required",
				"code":  http.StatusForbidden,
				"call": map[string]string{
					"method":      r.Method,
					"path":        r.URL.Path,
					"query":       canonicalQuery,
					"body_sha256": bodyHash,
				},
			})
			return
		}
		next(w, r)
	}
}

// endAssistantSession drops an assistant session whose delegation no longer exists.
func endAssistantSession(w http.ResponseWriter, r *http.Request, session *gorilla.Session) {
	session.Options.MaxAge = -1
	if err := session.Save(r, w); err != nil {
		log.Printf("[site_assistant_guard] clearing the expired assistant session failed: %v", err)
	}
}
