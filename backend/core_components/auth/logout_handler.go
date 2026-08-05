// logout_handler.go
// Handles user logout by invalidating the session and clearing security cookies.
// Bridges the session store, device/fingerprint cookies, and the post-logout redirect.
// Exists to ensure clean session teardown with redirect behavior driven by login-to-browse config.
package auth

import (
	"fmt"
	"log"
	"net/http"

	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/middlewares"
	e_sessions "easelect/backend/core_components/sessions"
)

func LogoutHandler(w http.ResponseWriter, r *http.Request) {
	log.Println("logoutHandler called")

	session, err := e_sessions.GetOrCreateSession(w, r)
	if err != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "session get failed")
		return
	}

	// 1) Mitätöidään session
	session.Options.MaxAge = -1 // Vanhentaa evästeen ja tuhoaa session
	err = saveSession(w, r, session)
	if err != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "session save failed")
		return
	}

	// 2) Poistetaan device_id-eväste
	http.SetCookie(w, &http.Cookie{
		Name:     "device_id",
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   e_sessions.ShouldUseSecureCookies(),
		SameSite: http.SameSiteLaxMode,
	})

	// 3) Poistetaan fingerprint-eväste
	http.SetCookie(w, &http.Cookie{
		Name:     "fingerprint",
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   e_sessions.ShouldUseSecureCookies(),
		SameSite: http.SameSiteLaxMode,
	})

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
