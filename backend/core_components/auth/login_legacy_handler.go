// login_legacy_handler.go
// Handles the legacy form-POST login flow for non-JSON POST requests to /login.
// Bridges form-submitted credentials, OTP validation, and session regeneration.
// Exists to support the classic HTML-form login path alongside the JSON credential handler.
package auth

import (
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/httpresponse"
	e_sessions "easelect/backend/core_components/sessions"

	"github.com/google/uuid"
	"github.com/gorilla/sessions"
	"golang.org/x/crypto/bcrypt"
)

// handleLoginPost handles the legacy form-based login flow.
func handleLoginPost(w http.ResponseWriter, r *http.Request) {
	log.Println("handleLoginPost() started 📥")
	if os.Getenv("ENVIRONMENT_TYPE") != "dev" {
		log.Println("legacy form login blocked outside explicit dev mode 🔒")
		httpresponse.RespondWithError(w, http.StatusForbidden, "legacy_form_login_disabled")
		return
	}

	// Rate limiting: reject IPs that exceed the per-window threshold.
	// In dev environment, bypass rate limiting for E2E test suites.
	clientIP := getClientIP(r)
	if shouldBlockLoginAttempt(w, r) {
		log.Printf("[handleLoginPost] rate limited IP: %s", clientIP)
		httpresponse.RespondWithError(w, http.StatusTooManyRequests, loginRateLimitErrorMessage)
		return
	}

	// --- Lomakkeen parsinta ---
	// ParseMultipartForm kutsuu sisäisesti ParseFormia, joten r.FormValue() toimii
	// vaikka Content-Type ei olisi multipart/form-data. Virhe on odotettavissa
	// normaaleilla form-posteilla (application/x-www-form-urlencoded), joten
	// tarkistetaan onko kyseessä oikea ongelma vai vain väärä content-type.
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		if !strings.Contains(err.Error(), "multipart") {
			// Oikea parsintavirhe — lomake on rikki
			fmt.Printf("\033[31merror: form parsing failed: %s\033[0m\n", err.Error())
			showLoginForm(w, r, "Virhe lomakkeen käsittelyssä.")
			return
		}
		// Content-Type ei ole multipart — normaali form post, ParseForm on jo ajettu
		log.Println("form parsed (url-encoded) ✅")
	} else {
		log.Println("form parsed (multipart) ✅")
	}

	// --- POST-parametrit & honeypotit ---
	honeypotFilled := logPostFormValues(
		r,
		"nickname",
		"email_confirm",
	)
	if honeypotFilled {
		log.Println("⚠️  honeypot field filled – possible bot")
	}

	// --- IP & domain ---
	logLoginAttemptDomain(clientIP)

	// --- CSRF-tarkistus ---
	session, err := e_sessions.GetOrCreateSession(w, r)
	if err != nil {
		fmt.Printf("\033[31merror: session get failed: %s\033[0m\n", err.Error())
		showLoginForm(w, r, "Istuntovirhe. Yritä uudelleen.")
		return
	}

	postedToken := r.FormValue("csrf_token")
	sessionToken, _ := session.Values["csrf_token"].(string)
	if postedToken == "" || sessionToken == "" || postedToken != sessionToken {
		log.Println("csrf check failed 🔒 (token mismatch)")
		showLoginForm(w, r, "Virheellinen CSRF-token. Yritä uudelleen.")
		return
	}
	log.Println("csrf check OK ✅")

	// --- Käyttäjätunnus & salasana ---
	username := r.FormValue("username")
	password := r.FormValue("password")
	log.Printf("login attempt: user=%s", username)

	var userID int
	err = backend.Db.QueryRow(`
        SELECT id
          FROM system_users
         WHERE username = $1
           AND enabled = true
    `, username).Scan(&userID)
	switch {
	case err == sql.ErrNoRows:
		log.Printf("user not found or disabled: %s", username)
		showLoginForm(w, r, "Väärä käyttäjätunnus tai salasana.")
		return
	case err != nil:
		fmt.Printf("\033[31merror: db error fetching user: %s\033[0m\n", err.Error())
		showLoginForm(w, r, "Tapahtui virhe. Yritä uudelleen.")
		return
	}

	var hashedPassword string
	err = backend.DbConfidential.QueryRow(`
        SELECT password
          FROM restricted.users_restricted
         WHERE id = $1
    `, userID).Scan(&hashedPassword)
	switch {
	case err == sql.ErrNoRows:
		log.Printf("hashedPassword not found for id %d", userID)
		showLoginForm(w, r, "Väärä käyttäjätunnus tai salasana.")
		return
	case err != nil:
		fmt.Printf("\033[31merror: db error fetching password: %s\033[0m\n", err.Error())
		showLoginForm(w, r, "Tapahtui virhe. Yritä uudelleen.")
		return
	}

	if err = bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(password)); err != nil {
		log.Println("bcrypt: wrong password ❌")
		showLoginForm(w, r, "Väärä käyttäjätunnus tai salasana.")
		return
	}
	log.Println("password verification OK 🔑")

	verification, err := loadLoginVerificationRecord(userID)
	if err != nil {
		log.Printf("login verification unavailable for user %d: %v", userID, err)
		showLoginForm(w, r, "Kirjautumisen varmennustapaa ei voitu lukea.")
		return
	}
	submittedCode := strings.TrimSpace(r.FormValue("otp"))
	switch verification.Method {
	case verificationNone:
	case verificationFixedPIN:
		if !verifyFixedPIN(verification.PINHash, submittedCode) {
			showLoginForm(w, r, "Virheellinen vahvistuskoodi.")
			return
		}
	case verificationTOTP:
		if !verifyTOTPAt(verification.TOTPSecret, submittedCode, time.Now()) {
			showLoginForm(w, r, "Virheellinen vahvistuskoodi.")
			return
		}
	case verificationEmail:
		showLoginForm(w, r, "Sähköpostivarmennus edellyttää tavallista kaksivaiheista kirjautumista.")
		return
	}

	// --- Session regeneration (defense-in-depth against session fixation) ---
	// Invalidate the pre-authentication session and create a fresh one.
	// With CookieStore the cookie content is re-encrypted on every save,
	// so fixation risk is inherently low, but this follows OWASP best practice.
	session.Options.MaxAge = -1
	if err = session.Save(r, w); err != nil {
		log.Printf("session invalidation warning: %s", err.Error())
	}
	session, err = e_sessions.GetOrCreateSession(w, r)
	if err != nil {
		fmt.Printf("\033[31merror: session regeneration failed: %s\033[0m\n", err.Error())
		showLoginForm(w, r, "Istuntovirhe. Yritä uudelleen.")
		return
	}
	// Gorilla sessions caches the session per-request, so GetOrCreateSession
	// returns the same object whose Options.MaxAge is still -1 from above.
	// Reset to store defaults so the new session cookie has a valid lifetime.
	session.Options = &sessions.Options{
		Path:     "/",
		MaxAge:   86400 * 7, // 7 days — matches InitSessionStore
		HttpOnly: true,
		Secure:   e_sessions.ShouldUseSecureCookies(),
		SameSite: http.SameSiteLaxMode,
	}
	log.Println("session regenerated after authentication ✅")

	// --- Sessioarvot ---
	if err = setAuthenticatedSessionIdentity(session, userID, username); err != nil {
		fmt.Printf("\033[31merror: session identity setup failed: %s\033[0m\n", err.Error())
		showLoginForm(w, r, "Istuntovirhe. Yritä uudelleen.")
		return
	}

	// --- device_id-cookie ---
	deviceCookie, err := r.Cookie("device_id")
	var deviceID string
	if err != nil || deviceCookie.Value == "" {
		deviceID = uuid.NewString()
		log.Println("created new deviceID:", deviceID)
	} else {
		deviceID = deviceCookie.Value
		log.Println("existing deviceID:", deviceID)
	}
	session.Values["device_id"] = deviceID

	// --- Fingerprint (pakollinen, paitsi dev-moodissa) ---
	fingerprint := r.FormValue("fingerprint")
	isDev := os.Getenv("ENVIRONMENT_TYPE") == "dev"
	if fingerprint == "" && !isDev {
		log.Println("fingerprint missing – login aborted 🔒")
		showLoginForm(w, r, "Kirjautuminen vaatii sormenjäljen.")
		return
	}
	if fingerprint == "" && isDev {
		fingerprint = "dev-mode-fingerprint"
		log.Println("fingerprint bypassed (dev mode) ✅")
	}
	hmacFP := HMACFingerprint(fingerprint)
	session.Values["fingerprint_hash"] = hmacFP
	log.Println("fingerprint received and HMAC computed ✅")

	// Kaikki evästeet asetetaan aina Secure-lipulla
	cookieLifetime := 7 * 24 * time.Hour

	// --- Evästeiden asetus ---
	// fingerprint cookie is now HttpOnly — JS no longer needs to read it.
	// The cookie stores the HMAC value so clients cannot forge valid fingerprints.
	http.SetCookie(w, &http.Cookie{
		Name:     "fingerprint",
		Value:    hmacFP,
		Path:     "/",
		HttpOnly: true, // 🔒  ei JS-pääsyä
		Secure:   e_sessions.ShouldUseSecureCookies(),
		SameSite: http.SameSiteLaxMode, // 🔒  CSRF-suoja
		Expires:  time.Now().Add(cookieLifetime),
	})
	http.SetCookie(w, &http.Cookie{
		Name:     "device_id",
		Value:    deviceID,
		Path:     "/",
		HttpOnly: true, // 🔒  ei JS-pääsyä
		Secure:   e_sessions.ShouldUseSecureCookies(),
		SameSite: http.SameSiteLaxMode,
		Expires:  time.Now().Add(cookieLifetime),
	})
	log.Println("cookies set for fingerprint and device_id 🍪")

	// --- Session tallennus ---
	log.Println("attempting to save session...")
	if err = saveSession(w, r, session); err != nil {
		fmt.Printf("\033[31merror: session save failed: %s\033[0m\n", err.Error())
		showLoginForm(w, r, "Istuntovirhe. Yritä uudelleen.")
		return
	}
	log.Println("session saved OK ✅")

	// --- Yhteenveto ---
	log.Printf("security mechanisms OK: csrf ✔︎ session-cookie ✔︎ session save ✔︎ fingerprint ✔︎ device_id ✔︎")
	log.Printf("user '%s' (id=%d) logged in successfully 🎉", username, userID)

	delete(session.Values, "redirect_after_login")
	if err = saveSession(w, r, session); err != nil {
		fmt.Printf("\033[31merror: session save failed: %s\033[0m\n", err.Error())
	}
	http.Redirect(w, r, "/", http.StatusSeeOther)
}
