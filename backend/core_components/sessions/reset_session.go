// reset_session.go
// Resets or destroys the current user session. Used during logout and security events to
// invalidate the session store entry and clear session cookies.
// Exists to recover safely from stale, corrupted, or intentionally closed sessions.
package e_sessions

import (
	"easelect/backend/core_components/httpresponse"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
)

func ResetSessionHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		// virheilmoitus (Go: punaisella, pienellä alkukirjaimella)
		errMsg := "unsupported method, only POST allowed"
		fmt.Printf("\033[31mvirhe: %s\033[0m\n", errMsg)
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, errMsg)
		return
	}

	// Basic CSRF protection: verify Origin or Referer matches our host.
	// Cannot use session-based CSRF here since the session may be corrupted.
	origin := r.Header.Get("Origin")
	referer := r.Header.Get("Referer")

	if origin != "" {
		// If Origin is present, it must match the request host.
		expectedOrigin := "https://" + r.Host
		if origin != expectedOrigin {
			if resetSessionAllowsCrossOriginDevRequest(r, origin) {
				goto originValidated
			}
			log.Printf("[ResetSessionHandler] CSRF: origin mismatch: got %s, expected %s", origin, expectedOrigin)
			httpresponse.RespondWithError(w, http.StatusForbidden, "Origin mismatch")
			return
		}
	} else if referer != "" {
		// Fallback to Referer check.
		expectedPrefix := "https://" + r.Host
		if !strings.HasPrefix(referer, expectedPrefix) {
			if resetSessionAllowsCrossOriginDevRequest(r, referer) {
				goto originValidated
			}
			log.Printf("[ResetSessionHandler] CSRF: referer mismatch: %s", referer)
			httpresponse.RespondWithError(w, http.StatusForbidden, "Referer mismatch")
			return
		}
	}

originValidated:

	log.Println("[ResetSessionHandler] Clearing session and all auth cookies")

	// Clear only the current instance or replica pool. Sibling cookies on the
	// same hostname belong to other runtimes and must remain untouched.
	ExpireCurrentAuthCookies(w)

	// JSON-vastaus
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"success": true, "message": "Session and all auth cookies cleared"}`))
}

func resetSessionAllowsCrossOriginDevRequest(r *http.Request, rawOriginOrReferer string) bool {
	parsed, err := url.Parse(rawOriginOrReferer)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return false
	}

	if AllowInsecureDevProxy() && parsed.Scheme == "http" {
		return true
	}

	if strings.ToLower(strings.TrimSpace(os.Getenv("ENVIRONMENT_TYPE"))) != "dev" {
		return false
	}
	if parsed.Scheme != "http" {
		return false
	}
	if !isLoopbackResetSessionHost(parsed.Hostname()) || !isLoopbackResetSessionHost(requestHostWithoutPort(r.Host)) {
		return false
	}

	port := parsed.Port()
	if port == "" {
		return false
	}
	configuredVitePort := strings.TrimSpace(os.Getenv("VITE_DEV_PORT"))
	if configuredVitePort == "" {
		configuredVitePort = "5173"
	}
	return port == configuredVitePort
}

func requestHostWithoutPort(host string) string {
	if parsedHost, _, err := net.SplitHostPort(host); err == nil {
		return parsedHost
	}
	return strings.Trim(host, "[]")
}

func isLoopbackResetSessionHost(host string) bool {
	normalized := strings.Trim(strings.ToLower(host), "[]")
	if normalized == "localhost" {
		return true
	}
	ip := net.ParseIP(normalized)
	return ip != nil && ip.IsLoopback()
}
