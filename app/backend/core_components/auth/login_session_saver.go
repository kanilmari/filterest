// login_session_saver.go
// Persists session state to the cookie store with the Secure flag enforced.
// Bridges login/logout handlers and the cookie-based session store.
// Exists to centralise session-save logic so all auth flows handle cookies consistently.
package auth

import (
	"fmt"
	"net/http"

	e_sessions "easelect/backend/core_components/sessions"

	"github.com/gorilla/sessions"
)

// saveSession tallentaa session ja palauttaa Secure-lipun alkuperäisen arvon.
func saveSession(w http.ResponseWriter, r *http.Request, session *sessions.Session) error {
	// Varmuuskopioi alkuperäiset kenttäarvot
	origOptions := *session.Options

	// Yhtenäistä tallennus muiden auth/session-cookiepolkujen kanssa.
	session.Options.Secure = e_sessions.ShouldUseSecureCookies()

	// Tallennus
	if err := session.Save(r, w); err != nil {
		// lokitetaan virhe punaisella (ohjeidesi mukaisesti)
		fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
		// Palautetaan alkuperäiset arvot, vaikka tallennus epäonnistuisi
		*session.Options = origOptions
		return err
	}

	// Nothing about the written cookie is logged. What used to be logged here was
	// the first sixty characters of the Set-Cookie header, which is the start of
	// the signed session value itself -- a piece of the credential, written to a
	// file on every sign-in and every renewal. Sixty characters are short of the
	// signature and so not usable on their own, which is exactly why it survived
	// so long; a credential still does not belong in a log at any length. A save
	// that fails is reported above, and that is the part worth knowing.

	// Palauta alkuperäiset arvot
	*session.Options = origOptions
	return nil
}
