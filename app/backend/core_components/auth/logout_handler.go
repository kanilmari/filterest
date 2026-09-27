// logout_handler.go
// Ends one browser's sign-in: records that it is over, then clears its cookies.
// Bridges the revoked-sign-in store, the session and binding cookies, and the
// post-logout redirect driven by login-to-browse configuration.
// Exists so signing out stops being something only the browser knows about. The
// cookies were expired here and nothing else happened, so a request that was
// already in flight in another tab wrote all three back when it finished and the
// person held working credentials again. The record is written first, and every
// authentication boundary refuses the sign-in it names from then on.
package auth

import (
	"fmt"
	"log"
	"net/http"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/middlewares"
	"easelect/backend/core_components/session_expiry"
	e_sessions "easelect/backend/core_components/sessions"
	"easelect/backend/core_components/sign_in_deadline"
	"easelect/backend/core_components/sign_in_revocation"

	"github.com/gorilla/sessions"
)

func LogoutHandler(w http.ResponseWriter, r *http.Request) {
	log.Println("logoutHandler called")

	session, err := e_sessions.GetOrCreateSession(w, r)
	if err != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "session get failed")
		return
	}

	// 1) Kirjataan uloskirjautuminen muistiin ennen kuin selaimen evästeet viedään.
	// Read before the session is emptied, and written before the browser is told
	// to drop anything, so there is never a moment where the person believes they
	// are out while the server would still accept the sign-in back.
	signOutRecorded := recordSignOutOfThisBrowser(r, session)

	// 2) Poistetaan vain tämän instanssin auth-evästeet.
	// All three cookies are ended by writing them empty and already expired, and
	// that is the whole of it. Saving the session here as well would be worse than
	// redundant: the store signs whatever the session still holds every time it is
	// written, with a fresh timestamp, and telling the browser to delete a cookie
	// does not stop that. A sign-out that saved the session therefore answered with
	// a valid, newly signed sign-in in the same response -- readable by whoever made
	// the request, and good for another SignInLifetime from that moment. Writing the
	// cookies directly signs nothing.
	//
	// Not touching the session has a second effect worth keeping. The pipeline's
	// audit stage reads the session after this handler returns, from the same cached
	// object; emptying it here would have left every sign-out recorded as having no
	// one behind it.
	e_sessions.ExpireCurrentAuthCookies(w)

	// 3) Jos uloskirjautumista ei saatu kirjattua, sitä ei esitetä valmiina.
	// This browser has lost its cookies either way, so the person is sent on
	// rather than stopped; the login page carries the one sentence that says what
	// is still uncertain and what to do about it. It goes to the login page on
	// both kinds of site, because that is where this application explains
	// authentication, and a site that lets visitors browse has no other place
	// for the sentence.
	if !signOutRecorded {
		http.Redirect(w, r, session_expiry.LoginPathWithNotice(
			session_expiry.SignOutNotRecordedNotice, "/"), http.StatusSeeOther)
		return
	}

	// 4) Tarkistetaan loginToBrowse
	loginToBrowse, confErr := middlewares.CheckLoginToBrowse()
	if confErr != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", confErr.Error())
		loginToBrowse = true
	}

	// 5) Ohjataan sivulle
	if loginToBrowse {
		// Jos login to browse on pakollinen, ohjataan aina /login
		http.Redirect(w, r, "/login", http.StatusSeeOther)
	} else {
		// Muuten voi siirtyä takaisin etusivulle (root)
		http.Redirect(w, r, "/", http.StatusSeeOther)
	}
}

// recordSignOutOfThisBrowser writes down that this one sign-in is over, and
// reports whether the sign-out can be presented as complete.
//
// A session with no sign-in identity has nothing to record and nothing that can
// be resurrected into an identity either: a visitor who was never signed in, and
// a sign-in made before this contract existed, which the shared boundary refuses
// outright (core_components/login_access_policy.go) rather than letting it run
// on. Both are complete sign-outs, and both are reported as such; only a store
// that could not be written is not.
func recordSignOutOfThisBrowser(r *http.Request, session *sessions.Session) bool {
	signInID, present := sign_in_revocation.SessionValue(session)
	if !present {
		if userID, _ := session.Values["user_id"].(int); userID > 1 {
			log.Printf("[logout] the sign-in of user %d carries no sign-in identity; it predates per-sign-in revocation and cannot be recorded", userID)
		}
		return true
	}

	// The record is kept to this sign-in's own deadline, so it lasts exactly as
	// long as the sign-in it refuses could be presented and no longer. A sign-in
	// with no deadline is refused for good, because nothing would ever prove it
	// spent.
	expiresAt, dated := sign_in_deadline.SessionValue(session)
	if !dated {
		log.Printf("[logout] the sign-in of this browser carries no deadline; it predates the sign-in limit and the shared boundary already refuses it")
		return true
	}

	if err := sign_in_revocation.Record(r.Context(), backend.Db, signInID, expiresAt); err != nil {
		log.Printf("\033[31merror: [logout] the sign-out could not be recorded and can still be undone by a request already in flight: %v\033[0m", err)
		return false
	}
	return true
}
