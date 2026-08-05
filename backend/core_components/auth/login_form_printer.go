// login_form_printer.go
// Renders the login form HTML template and dispatches GET/POST requests.
// Bridges the HTTP router, login template, and the credential/legacy handlers.
// Exists to manage session store setup and route login page rendering for the auth package.
package auth

import (
	"context"
	backend "easelect/backend/core_components"
	"fmt"
	"html/template"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	frontendassets "easelect/backend/core_components/frontend_assets"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/logging"
	"easelect/backend/core_components/middlewares"
	e_sessions "easelect/backend/core_components/sessions"

	"github.com/google/uuid"
	"github.com/gorilla/sessions"
)

var (
	store                    *sessions.CookieStore
	frontend_dir             string
	configuredSiteNameReader = backend.ConfiguredSiteName
)

// shouldShowLoginTourScreenshots reads the login tour screenshot toggle from env.
// Between the browser-facing site name, instance .env, and login template it
// decides whether the tour tab should include screenshot cards.
// Why: public Filterest pages must not claim screenshot assets exist before the
// public tour media is ready, while the shared gallery infrastructure remains.
func shouldShowLoginTourScreenshots(siteName string) bool {
	normalizedSiteName := strings.ToLower(strings.TrimSpace(siteName))
	if strings.Contains(normalizedSiteName, "filterest") {
		return false
	}

	raw := strings.TrimSpace(strings.ToLower(os.Getenv("LOGIN_PAGE_TOUR_SCREENSHOTS_ENABLED")))
	switch raw {
	case "", "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return true
	}
}

// resolveLoginSiteName returns the public name shown on the login page.
// The administrator-owned First Run value wins over deployment and host fallbacks.
// Why: normal sign-in should adopt the chosen site identity immediately.
func resolveLoginSiteName(r *http.Request) string {
	ctx := context.Background()
	if r != nil {
		ctx = r.Context()
	}
	if siteName := configuredSiteNameReader(ctx, backend.Db); siteName != "" {
		return siteName
	}
	if r != nil {
		if host := normalizeLoginDisplayHost(r.Header.Get("X-Forwarded-Host")); host != "" {
			return host
		}
		if host := normalizeLoginDisplayHost(r.Host); host != "" {
			return host
		}
	}

	if siteName := strings.TrimSpace(os.Getenv("SITE_NAME")); siteName != "" {
		return siteName
	}
	return "Easelect"
}

// normalizeLoginDisplayHost formats a request host for user-facing login copy.
// Between proxy/client headers and the template data it strips ports and empty
// values while preserving a simple domain-style display value.
// Why: the login page should say filterest.com, not filterest.com:443 or a stale
// deployment fallback.
func normalizeLoginDisplayHost(rawHost string) string {
	host := strings.TrimSpace(rawHost)
	if host == "" {
		return ""
	}
	if firstHost, _, found := strings.Cut(host, ","); found {
		host = strings.TrimSpace(firstHost)
	}
	if splitHost, _, err := net.SplitHostPort(host); err == nil {
		host = splitHost
	}
	host = strings.Trim(host, "[]")
	host = strings.TrimSuffix(host, ".")
	return strings.ToLower(strings.TrimSpace(host))
}

func InitAuth(session_store *sessions.CookieStore, fe_dir string) {
	store = session_store
	frontend_dir = fe_dir
}

func LoginHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		pending, err := firstRunPendingReader(r.Context(), backend.Db)
		if err != nil {
			logging.Errorf("[LoginHandler] first-run state check failed: %v", err)
			httpresponse.RespondWithError(w, http.StatusServiceUnavailable, "Login is unavailable while setup state cannot be verified")
			return
		}
		if pending {
			http.Redirect(w, r, "/first-run", http.StatusSeeOther)
			return
		}
		session, _ := e_sessions.GetOrCreateSession(w, r)
		if session != nil && session.Values["user_id"] != nil {
			// Jos käyttäjä on muu kuin guest, eli jos user_id on jokin muu kuin 1, ohjataan etusivulle
			if uid, ok := session.Values["user_id"].(int); ok && uid != 1 {
				http.Redirect(w, r, "/", http.StatusSeeOther)
				return
			}
		}

		// fragment=1 → render the login template as-is (modal fetch path).
		// Direct GET /login always renders the standalone login page. The SPA
		// modal entry remains explicit at /?login-entry=1.

		showLoginForm(w, r, "")
		return
	}
	if r.Method == http.MethodPost {
		handleLoginPost(w, r)
		return
	}
	httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
}

func showLoginForm(w http.ResponseWriter, r *http.Request, errorMsg string) {
	log.Println("showLoginForm() started 🪪")

	// --- Sessio & sessio-cookie ---
	session, err := e_sessions.GetOrCreateSession(w, r)
	if err != nil {
		log.Printf("[showLoginForm] session get failed: %v, resetting", err)
		session = sessions.NewSession(store, e_sessions.SessionName)
		session.Options = &sessions.Options{
			Path:     "/",
			MaxAge:   86400 * 7, // 7 days
			HttpOnly: true,
			Secure:   e_sessions.ShouldUseSecureCookies(),
			SameSite: http.SameSiteLaxMode,
		}
	}

	if _, errCookie := r.Cookie(e_sessions.SessionName); errCookie == nil {
		log.Println("session cookie found 🍪")
	} else {
		log.Println("session cookie not found – creating new 🔄")
	}

	// --- CSRF-token ---
	csrfToken, ok := session.Values["csrf_token"].(string)
	if !ok || csrfToken == "" {
		csrfToken = uuid.NewString()
		session.Values["csrf_token"] = csrfToken
		log.Println("new csrf token created 🔐")

		log.Println("attempting to save session (csrf-token)...")
		if err = saveSession(w, r, session); err != nil {
			fmt.Printf("\033[31merror: session save failed after csrf token creation: %s\033[0m\n", err.Error())
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "Internal server error")
			return
		}
		log.Println("session save OK ✅")
	} else {
		log.Println("existing csrf token")
	}

	// --- Templaatin renderöinti ---
	templatePath := filepath.Join(frontend_dir, "templates", "login.html")
	tmpl, err := template.ParseFiles(templatePath)
	if err != nil {
		fmt.Printf("\033[31merror: login template load failed: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "Internal server error")
		return
	}

	useMinified, flagErr := middlewares.ShouldUseMinifiedAssetsInDev()
	if flagErr != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", flagErr.Error())
		useMinified = true
	}

	siteName := resolveLoginSiteName(r)
	assetPaths := frontendassets.Resolve(frontend_dir, useMinified)

	data := struct {
		ErrorMsg            string
		CSRFToken           string
		UseMinifiedAssets   bool
		SiteName            string
		StandalonePage      bool
		ShowCloseButton     bool
		ShowTourScreenshots bool
		ImportsCSSPath      string
		LoginBundlePath     string
	}{
		ErrorMsg:            errorMsg,
		CSRFToken:           csrfToken,
		UseMinifiedAssets:   useMinified,
		SiteName:            siteName,
		StandalonePage:      r.URL.Query().Get("fragment") != "1",
		ShowCloseButton:     r.URL.Query().Get("fragment") == "1",
		ShowTourScreenshots: shouldShowLoginTourScreenshots(siteName),
		ImportsCSSPath:      assetPaths.ImportsCSSPath,
		LoginBundlePath:     assetPaths.LoginBundlePath,
	}

	log.Println("LoginHandler: Rendering template with CSRF token")

	if err = tmpl.Execute(w, data); err != nil {
		fmt.Printf("\033[31merror: login template execution failed: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "Internal server error")
		return
	}

	log.Println("login template rendered successfully 🖼️")
}

// logPostFormValues logs all POST form fields and checks honeypot fields.
// Returns true if any honeypot field was filled (indicates possible bot).
func logPostFormValues(
	r *http.Request,
	honeypotFieldNames ...string,
) (honeypotFilled bool) {

	honeypotSet := map[string]struct{}{}
	for _, honeypotFieldName := range honeypotFieldNames {
		honeypotSet[honeypotFieldName] = struct{}{}
	}

	for fieldName, fieldValues := range r.PostForm {
		// vältä lokitusta kaikista mahdollisista salasanakentistä
		isSensitive := strings.Contains(strings.ToLower(fieldName), "password")

		for _, fieldValue := range fieldValues {
			if !isSensitive {
				log.Printf("form field %s = %q", fieldName, fieldValue)
			}

			if _, exists := honeypotSet[fieldName]; exists && fieldValue != "" {
				honeypotFilled = true
			}
		}
	}
	return
}
