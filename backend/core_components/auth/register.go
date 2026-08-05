// register.go
// Handles new user self-registration form rendering and POST processing.
// Bridges the registration HTML template, CSRF validation, and the user-insert database path.
// Exists to let new users create accounts with input validation and CSRF enforcement.
package auth

import (
	"database/sql"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/logging"
	"easelect/backend/core_components/middlewares"
	"html/template"
	"net/http"
	"net/url"
	"os"
	"path/filepath"

	e_sessions "easelect/backend/core_components/sessions"

	"github.com/google/uuid"
	"github.com/gorilla/sessions"
	"golang.org/x/crypto/bcrypt"
)

var registrationEnabledFunc = middlewares.CheckRegistrationEnabled

func buildRegisterEntryRedirectTarget(redirect string) string {
	params := url.Values{}
	params.Set("register-entry", "1")
	if redirect != "" {
		params.Set("redirect", redirect)
	}
	return "/?" + params.Encode()
}

func RegisterHandler(w http.ResponseWriter, r *http.Request) {
	logging.Infof("registerHandler called")

	// Check if registration is enabled in system_config
	if !registrationEnabledFunc() {
		httpresponse.RespondWithError(w, http.StatusForbidden, "Registration is disabled")
		return
	}

	if r.Method == http.MethodGet {
		// fragment=1 -> render the register template as-is for SPA modal fetches.
		// Otherwise redirect into the guest SPA shell so /register stays in-app.
		if r.URL.Query().Get("fragment") != "1" {
			http.Redirect(w, r, buildRegisterEntryRedirectTarget(r.URL.Query().Get("redirect")), http.StatusSeeOther)
			return
		}
		showRegisterForm(w, r, registerErrors{})
		return
	}
	httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
}

func RegisterAPIHandler(w http.ResponseWriter, r *http.Request) {
	logging.Infof("registerAPIHandler called")

	// Check if registration is enabled in system_config
	if !registrationEnabledFunc() {
		httpresponse.RespondWithError(w, http.StatusForbidden, "Registration is disabled")
		return
	}

	if r.Method == http.MethodPost {
		handleRegisterPost(w, r)
		return
	}
	httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
}

func handleRegisterPost(w http.ResponseWriter, r *http.Request) {
	// Rate limiting: same IP-based limiter as login to prevent automated account creation.
	clientIP := getClientIP(r)
	if checkLoginRateLimit(clientIP) {
		logging.Infof("[handleRegisterPost] rate limited IP: %s", clientIP)
		httpresponse.RespondWithError(w, http.StatusTooManyRequests, "Too many registration attempts. Please try again later.")
		return
	}

	err := r.ParseForm()
	if err != nil {
		logging.Errorf("error: form processing failed: %s", err.Error())
		httpresponse.RespondWithError(w, http.StatusBadRequest, "form processing failed")
		return
	}

	session, err := e_sessions.GetOrCreateSession(w, r)
	if err != nil {
		logging.Errorf("error: session get failed: %s", err.Error())
		showRegisterForm(w, r, registerErrors{General: "session_error"})
		return
	}
	postedToken := r.FormValue("csrf_token")
	sessionToken, _ := session.Values["csrf_token"].(string)
	if postedToken == "" || sessionToken == "" || postedToken != sessionToken {
		w.WriteHeader(http.StatusForbidden)
		showRegisterForm(w, r, registerErrors{General: "csrf_token_invalid"})
		return
	}
	username := r.FormValue("username")
	password := r.FormValue("password")
	email := r.FormValue("email")
	full_name := r.FormValue("full_name")

	logging.Infof("received registration data: username=%s, email=%s, full_name=%s",
		username, email, full_name)

	var existing int
	err = backend.Db.QueryRow(`
                       SELECT id FROM system_users WHERE username = $1
               `, username).Scan(&existing)
	switch {
	case err != nil && err != sql.ErrNoRows:
		logging.Errorf("error: username check failed: %s", err.Error())
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "registration failed (check)")
		return
	case err != sql.ErrNoRows:
		showRegisterForm(w, r, registerErrors{Username: "username_exists"})
		return
	}

	err = backend.DbConfidential.QueryRow(`
                       SELECT id FROM restricted.users_restricted WHERE email = $1
               `, email).Scan(&existing)
	switch {
	case err != nil && err != sql.ErrNoRows:
		logging.Errorf("error: email check failed: %s", err.Error())
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "registration failed (check)")
		return
	case err != sql.ErrNoRows:
		showRegisterForm(w, r, registerErrors{Email: "email_exists"})
		return
	}

	hashed_password, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		logging.Errorf("error: password hashing failed: %s", err.Error())
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "password hashing failed")
		return
	}

	// 1) Lisätään rivi system_users-tauluun (pääkäyttäjällä)
	// Dev-ympäristössä enabled=true, muuten false
	enabled := false
	if os.Getenv("ENVIRONMENT_TYPE") != "prod" {
		enabled = true
	}

	var newUserID int
	err = backend.Db.QueryRow(`
            INSERT INTO system_users (
                username,
                full_name,
                created,
                updated,
                enabled,
                privileged
            )
            VALUES ($1, $2, NOW(), NOW(), $3, false)
            RETURNING id
        `, username, full_name, enabled).Scan(&newUserID)
	if err != nil {
		logging.Errorf("error: user insert failed: %s", err.Error())
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "registration failed (step 1)")
		return
	}

	// 2) Lisätään salasanatieto restricted.users_restricted-tauluun (rajatulla yhteydellä)
	_, err = backend.DbConfidential.Exec(`
            INSERT INTO restricted.users_restricted (id, password, email)
            VALUES ($1, $2, $3)
        `, newUserID, string(hashed_password), email)
	if err != nil {
		logging.Errorf("error: restricted table insert failed: %s", err.Error())
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "registration failed (step 2)")
		return
	}

	// 3) Lisätään käyttäjä oletuksena "users"-ryhmään
	var usersGroupID int
	err = backend.Db.QueryRow(`
                       SELECT id FROM system_user_groups
                       WHERE name = $1
               `, "users").Scan(&usersGroupID)
	if err != nil {
		logging.Errorf("error: 'users' group not found: %s", err.Error())
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "registration failed (step 3)")
		return
	}

	_, err = backend.Db.Exec(`
			INSERT INTO system_user_group_memberships (user_id, group_id, created, updated)
			VALUES ($1, $2, NOW(), NOW())
		`, newUserID, usersGroupID)
	if err != nil {
		logging.Errorf("error: group membership insert failed: %s", err.Error())
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "registration failed (step 3)")
		return
	}

	logging.Infof("registration successful, redirecting to login")
	http.Redirect(w, r, "/login", http.StatusSeeOther)
}

type registerErrors struct {
	Username string
	Email    string
	General  string
}

func showRegisterForm(w http.ResponseWriter, r *http.Request, errs registerErrors) {
	session, err := e_sessions.GetOrCreateSession(w, r)
	if err != nil {
		logging.Errorf("[showRegisterForm] session get failed: %v, resetting", err)
		session = sessions.NewSession(store, e_sessions.SessionName)
	}

	csrfToken, ok := session.Values["csrf_token"].(string)
	if !ok || csrfToken == "" {
		csrfToken = uuid.NewString()
		session.Values["csrf_token"] = csrfToken
		if err = saveSession(w, r, session); err != nil {
			logging.Errorf("error: session save failed after csrf token creation: %s", err.Error())
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "Internal server error")
			return
		}
	}

	templatePath := filepath.Join(frontend_dir, "templates", "register.html")
	tmpl, err := template.ParseFiles(templatePath)
	if err != nil {
		logging.Errorf("error: register template load failed: %s", err.Error())
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "Internal server error")
		return
	}

	data := struct {
		UsernameErr string
		EmailErr    string
		GeneralErr  string
		CSRFToken   string
		FormAction  string
	}{
		UsernameErr: errs.Username,
		EmailErr:    errs.Email,
		GeneralErr:  errs.General,
		CSRFToken:   csrfToken,
		FormAction:  buildRegisterFormActionPath(r),
	}

	if err = tmpl.Execute(w, data); err != nil {
		logging.Errorf("error: register template execution failed: %s", err.Error())
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "Internal server error")
		return
	}
}

func buildRegisterFormActionPath(r *http.Request) string {
	if r != nil && r.URL.Query().Get("fragment") == "1" {
		return "/api/register_ndYOyXV0INOK3F?fragment=1"
	}
	return "/api/register_ndYOyXV0INOK3F"
}
