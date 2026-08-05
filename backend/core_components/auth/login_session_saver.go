// login_session_saver.go
// Persists session state to the cookie store with the Secure flag enforced.
// Bridges login/logout handlers and the cookie-based session store.
// Exists to centralise session-save logic so all auth flows handle cookies consistently.
package auth

import (
	"fmt"
	"log"
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

	if cookie := w.Header().Get("Set-Cookie"); cookie != "" {
		val := cookie
		if len(val) > 60 {
			val = val[:60]
		}
		log.Printf("[saveSession] Set-Cookie: %s...", val)
	}

	// Palauta alkuperäiset arvot
	*session.Options = origOptions
	return nil
}
