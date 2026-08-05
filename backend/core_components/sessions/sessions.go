// sessions.go
// Initializes and exposes the shared Gorilla session store for the Easelect runtime.
// Bridges environment-driven session settings to auth, pipeline, and handler code.
// Exists to keep cookie/session behavior consistent across standalone, multi-instance,
// and load-balanced Easelect deployments.
package e_sessions

import (
	"crypto/sha256"
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

// resolveSessionName picks the cookie name for this runtime. Explicit
// SESSION_COOKIE_NAME enables shared cookies across load-balanced replicas,
// while INSTANCE_NAME remains the default isolation mechanism for separate
// localhost/per-customer instances.
func resolveSessionName() string {
	if explicit := sanitizeSessionCookieName(os.Getenv("SESSION_COOKIE_NAME")); explicit != "" {
		return explicit
	}

	if instanceName := sanitizeSessionCookieName(os.Getenv("INSTANCE_NAME")); instanceName != "" {
		return "session_" + instanceName
	}

	return "session"
}

// InitSessionStore alustaa sessiostoren ja asettaa sen asetukset
func InitSessionStore() {
	// Luo store vain, jos se puuttuu
	if Store == nil {
		secretKey := os.Getenv("SESSION_KEY")
		if secretKey == "" {
			err := fmt.Errorf("SESSION_KEY environment variable is not set")
			fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
			panic(err)
		}

		// Optional AES encryption key — must be 16, 24, or 32 bytes.
		// Derive deterministically from SESSION_SECRET_KEY via SHA-256 so any
		// length input produces a valid 32-byte key.
		encKey := os.Getenv("SESSION_SECRET_KEY")
		if encKey == "" {
			fmt.Printf("\033[33mwarning: SESSION_SECRET_KEY is not set — session data will be stored unencrypted\033[0m\n")
			Store = sessions.NewCookieStore([]byte(secretKey))
		} else {
			derived := sha256.Sum256([]byte(encKey))
			Store = sessions.NewCookieStore([]byte(secretKey), derived[:])
		}
	}

	SessionName = resolveSessionName()

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
