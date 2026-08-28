// sessions.go
// Initializes and exposes the shared Gorilla session store for the Easelect runtime.
// Bridges environment-driven session settings to auth, pipeline, and handler code.
// Exists to keep cookie/session behavior consistent across standalone, multi-instance,
// and load-balanced Easelect deployments.
package e_sessions

import (
	"fmt"
	"net/http"
	"os"
	"regexp"
	"strings"

	"github.com/gorilla/sessions"
)

// reCookieNameSafe strips characters that are invalid in HTTP cookie names.
// RFC 6265 allows US-ASCII printable chars except CTLs, spaces, and separators.
var reCookieNameSafe = regexp.MustCompile(`[^a-zA-Z0-9_.-]`)

// Store on globaali sessiostore, jota muut paketit (esim. middlewares) tarvitsevat
var Store *sessions.CookieStore

// SessionName is the cookie name, made unique per instance to avoid conflicts
var SessionName = "session"

// AllowInsecureDevProxy enables HTTP cookie delivery for same-Wi-Fi Vite/LAN
// testing. It is dev-only and opt-in because production and normal local usage
// must keep Secure cookies enforced.
func AllowInsecureDevProxy() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("ALLOW_INSECURE_DEV_PROXY"))) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

// ShouldUseSecureCookies returns the effective Secure flag for auth/session
// cookies. The default stays true; only explicit dev-LAN opt-in disables it.
func ShouldUseSecureCookies() bool {
	return !AllowInsecureDevProxy()
}

// sanitizeSessionCookieName keeps only characters that remain valid in cookie
// names after environment-driven overrides.
func sanitizeSessionCookieName(raw string) string {
	return reCookieNameSafe.ReplaceAllString(strings.TrimSpace(raw), "_")
}

// resolveSessionName returns the validated session name from the shared
// authentication-cookie identity contract.
func resolveSessionName() string {
	config, err := resolveAuthCookieConfig()
	if err != nil {
		return ""
	}
	return config.names.Session
}

// InitSessionStore alustaa sessiostoren ja asettaa sen asetukset
func InitSessionStore() {
	config, err := resolveAuthCookieConfig()
	if err != nil {
		panic(fmt.Errorf("invalid authentication-cookie configuration: %w", err))
	}
	currentAuthCookieConfig = config
	SessionName = config.names.Session

	// Luo store vain, jos se puuttuu
	if Store == nil {
		secretKey := os.Getenv("SESSION_KEY")
		if secretKey == "" {
			err := fmt.Errorf("SESSION_KEY environment variable is not set")
			fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
			panic(err)
		}

		// Scope signing and optional encryption keys to this isolated instance or
		// explicitly declared replica pool before constructing CookieStore.
		scopedSigningKey := deriveScopedCookieKey(secretKey, "session-signing", config)
		encKey := os.Getenv("SESSION_SECRET_KEY")
		if encKey == "" {
			fmt.Printf("\033[33mwarning: SESSION_SECRET_KEY is not set — session data will be stored unencrypted\033[0m\n")
			Store = sessions.NewCookieStore(scopedSigningKey)
		} else {
			derived := deriveScopedCookieKey(encKey, "session-encryption", config)
			Store = sessions.NewCookieStore(scopedSigningKey, derived)
		}
	}

	// Asetukset:
	Store.Options = &sessions.Options{
		Path:     "/",
		MaxAge:   86400 * 7, // 7 päivää
		HttpOnly: true,
		Secure:   ShouldUseSecureCookies(),
		SameSite: http.SameSiteLaxMode, // CSRF-suoja
	}
}

// GetStore palauttaa osoittimen sessiostoreen
func GetStore() *sessions.CookieStore {
	return Store
}
