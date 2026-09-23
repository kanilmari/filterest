// session_expiry_responder.go
// Answers a request whose sign-in the server can no longer accept.
// Between every authentication pipeline stage and the browser that made the request.
// Exists so an ended sign-in reaches the person as "sign in again" in one agreed
// shape, instead of a login page handed back to a background request as if the
// request had succeeded.
package session_expiry

import (
	"log"
	"net/http"
	"net/url"
	"strings"

	"easelect/backend/core_components/auth_generation"
	"easelect/backend/core_components/httpresponse"

	"github.com/gorilla/sessions"
)

// The fixed markers the login page turns into a sentence the person can read.
// The frontend twin that consumes them is
// app/frontend/core_components/auth/auth_session_notice_handler.js.
const (
	AuthNoticeParameter = "auth_notice"
	SessionEndedNotice  = "session-ended"
	RedirectParameter   = "redirect"
	LoginPath           = "/login"
)

// SessionNoLongerValidMessage is the machine-readable reason in the JSON answer.
// It is not shown to anyone: the person reads the login page's own sentence.
const SessionNoLongerValidMessage = "session_no_longer_valid"

// IsBrowserDocumentNavigation reports whether this request is a person opening or
// following an address, rather than a script's background request for data.
// Only a document navigation can be answered by sending the browser to another
// page; every other request must be told in a form its caller can read.
func IsBrowserDocumentNavigation(r *http.Request) bool {
	if r == nil || r.URL == nil {
		return false
	}
	if r.Method != http.MethodGet || strings.HasPrefix(r.URL.Path, "/api/") {
		return false
	}
	if !strings.Contains(strings.ToLower(r.Header.Get("Accept")), "text/html") {
		return false
	}
	fetchMode := strings.ToLower(strings.TrimSpace(r.Header.Get("Sec-Fetch-Mode")))
	if fetchMode != "" && fetchMode != "navigate" {
		return false
	}
	return true
}

// LoginPathWithSessionEndedNotice builds the login address that explains itself,
// carrying the address the person was trying to reach so sign-in can return there.
func LoginPathWithSessionEndedNotice(returnPath string) string {
	query := url.Values{}
	query.Set(AuthNoticeParameter, SessionEndedNotice)
	query.Set(RedirectParameter, returnPath)
	return LoginPath + "?" + query.Encode()
}

// RespondSignInNoLongerValid is the one answer the whole application gives when a
// request arrives with a sign-in the server can no longer accept: an expired or
// revoked session, a lost device or fingerprint binding, or a session whose
// contents no longer make sense.
//
// It is deliberately NOT for a person who is signed in and lacks a right. That
// stays an ordinary permission denial through httpresponse.RespondWithError, so
// the two cases never get the same words or the same recovery.
//
// The stale sign-in is dropped from the session first. Without that, the browser
// keeps presenting a half-valid identity, and GET /login sends an apparently
// signed-in visitor straight back to the page that just refused them.
//
// A page navigation is then sent to the login page with the notice marker. Every
// other request — which in practice means every fetch the application makes — is
// answered with the machine-readable authentication failure the frontend request
// pipeline already understands, so it can take the person to sign in instead of
// parsing a login page as if it were data.
func RespondSignInNoLongerValid(
	w http.ResponseWriter,
	r *http.Request,
	session *sessions.Session,
	reason string,
) {
	if reason != "" {
		log.Printf("[session_expiry] sign-in no longer valid: %s", reason)
	}

	if session != nil {
		auth_generation.ClearIdentity(session)
	}

	if IsBrowserDocumentNavigation(r) {
		returnPath := returnPathForRequest(r)
		if session != nil {
			session.Values["redirect_after_login"] = returnPath
			saveClearedSession(w, r, session)
		}
		http.Redirect(w, r, LoginPathWithSessionEndedNotice(returnPath), http.StatusSeeOther)
		return
	}

	if session != nil {
		saveClearedSession(w, r, session)
	}
	httpresponse.RespondWithAuthFailure(w, SessionNoLongerValidMessage)
}

// returnPathForRequest keeps the address the person wanted, but never sends them
// back to the login page itself.
func returnPathForRequest(r *http.Request) string {
	if r == nil || r.URL == nil {
		return "/"
	}
	returnPath := r.URL.RequestURI()
	if returnPath == "" || strings.HasPrefix(returnPath, LoginPath) {
		return "/"
	}
	return returnPath
}

func saveClearedSession(w http.ResponseWriter, r *http.Request, session *sessions.Session) {
	if err := session.Save(r, w); err != nil {
		log.Printf("\033[31m[session_expiry] clearing the ended sign-in failed: %v\033[0m", err)
	}
}
