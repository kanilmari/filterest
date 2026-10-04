// session_store_access.go
// Loads and writes the sign-in session: the only code that reads or writes its cookie through the store.
// Between every handler and stage that keeps state in the session, and the Gorilla cookie store.
// Exists because the session was read in seven places and written in twenty-one, so anything a session
// must not carry, and every option a written cookie needs, had to be repeated at each of them.
package e_sessions

import (
	"log"
	"net/http"
	"runtime"
	"strings"

	"github.com/gorilla/sessions"
)

// RetiredSessionKeys are values earlier releases kept in the session and this one
// neither writes nor reads. A session holds no name: a copy of the name went
// stale as soon as it was changed in another browser, and before the login name
// was separated from the display name it was the login name itself. Load drops
// these keys from every session it hands out, so the next write of a cookie that
// still carries one leaves it out.
var RetiredSessionKeys = []string{"username", "otp_pending_username"}

// Load returns the request's sign-in session as the store decodes it, without
// the RetiredSessionKeys. Within one request the store hands every caller the
// same session, so what one stage changes the next one sees. When the cookie
// cannot be decoded, the store's error and its empty replacement come back
// unchanged, and the caller decides, as before, whether that ends the request.
func Load(r *http.Request) (*sessions.Session, error) {
	session, err := GetStore().Get(r, SessionName)
	if session != nil {
		for _, key := range RetiredSessionKeys {
			delete(session.Values, key)
		}
	}
	return session, err
}

// Save writes the session to its cookie. It is the only place the sign-in
// session is written; a source test keeps every other package calling it.
//
// The session keeps its own options: a sign-in deadline shortens a cookie's
// lifetime and a sign-out deletes it, so nothing here resets them. Only the
// Secure flag is taken from ShouldUseSecureCookies for this write, as the sign-in
// handlers' own writer did, and the session's options are left as they were
// found. A failure is logged once, naming the function that asked for the
// write, and returned for the caller to answer.
func Save(w http.ResponseWriter, r *http.Request, session *sessions.Session) error {
	options := *session.Options
	session.Options.Secure = ShouldUseSecureCookies()
	err := session.Save(r, w)
	*session.Options = options
	if err != nil {
		log.Printf("\033[31m[sessions] writing the session failed in %s: %v\033[0m", saveCallerName(), err)
	}
	return err
}

// saveCallerName names the function that called Save, such as
// "auth.CheckFingerprintHandler", so a failed write says where it came from.
func saveCallerName() string {
	programCounter, _, _, ok := runtime.Caller(2)
	if !ok {
		return "an unknown caller"
	}
	function := runtime.FuncForPC(programCounter)
	if function == nil {
		return "an unknown caller"
	}
	name := function.Name()
	if slash := strings.LastIndex(name, "/"); slash >= 0 {
		name = name[slash+1:]
	}
	return name
}
