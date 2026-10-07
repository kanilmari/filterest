// register.go
// Handles new user self-registration form rendering and POST processing.
// Bridges the registration HTML template, CSRF validation, and the user-insert database path.
// Exists to let new users create accounts with input validation and CSRF enforcement.
package auth

import (
	"bytes"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/auth/credentials"
	frontendassets "easelect/backend/core_components/frontend_assets"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/logging"
	"easelect/backend/core_components/middlewares"
	"easelect/backend/pipeline/admin_check"
	"errors"
	"html/template"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"

	e_sessions "easelect/backend/core_components/sessions"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

var registrationEnabledFunc = middlewares.CheckRegistrationEnabled

const defaultRegistrationVerificationMethod = verificationFixedPIN

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
		showRegisterForm(w, r, registerErrors{}, string(defaultRegistrationVerificationMethod), http.StatusOK)
		return
	}
}

func RegisterAPIHandler(w http.ResponseWriter, r *http.Request) {
	logging.Infof("registerAPIHandler called")

	// Closed public signup still permits explicit administrator account creation.
	// Keep the existing admin-access gate and the same CSRF/rate-limited writer.
	if !registrationEnabledFunc() {
		if !registrationHasCurrentAdministrator(w, r) {
			httpresponse.RespondWithError(w, http.StatusForbidden, "Registration is disabled")
			return
		}
		admin_check.WithAdminUserCheck(handleRegisterPost)(w, r)
		return
	}

	if r.Method == http.MethodPost {
		handleRegisterPost(w, r)
		return
	}
}

// registrationHasCurrentAdministrator requires the canonical current identity and role.
// It bridges a public route's signed cookie to the existing administrator-access stage;
// a cached role claim alone never grants the closed-registration exception.
func registrationHasCurrentAdministrator(w http.ResponseWriter, r *http.Request) bool {
	if e_sessions.Store == nil {
		return false
	}
	session, err := e_sessions.GetOrCreateSession(w, r)
	if err != nil || session.Values["authenticated"] != true {
		return false
	}
	userID, ok := session.Values["user_id"].(int)
	if !ok || userID <= 1 {
		return false
	}
	current, err := backend.AuthenticatedSessionMatches(r.Context(), backend.DbConfidential, session, userID)
	if err != nil || !current {
		return false
	}
	role, err := backend.ResolveUserRole(userID)
	return err == nil && role == "admin"
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
	loginName := r.FormValue("username")
	username := r.FormValue("display_name")
	password := r.FormValue("password")
	email := r.FormValue("email")
	fullName := r.FormValue("full_name")
	verificationMethodValue := strings.ToLower(strings.TrimSpace(r.FormValue("verification_method")))
	fixedPIN := strings.TrimSpace(r.FormValue("fixed_pin"))
	confirmFixedPIN := strings.TrimSpace(r.FormValue("confirm_fixed_pin"))

	session, err := e_sessions.GetOrCreateSession(w, r)
	if err != nil {
		logging.Errorf("error: session get failed: %s", err.Error())
		showRegisterForm(w, r, registerErrors{General: "session_error"}, verificationMethodValue, http.StatusOK)
		return
	}
	postedToken := r.FormValue("csrf_token")
	sessionToken, _ := session.Values["csrf_token"].(string)
	if postedToken == "" || sessionToken == "" || postedToken != sessionToken {
		showRegisterForm(w, r, registerErrors{General: "csrf_token_invalid"}, verificationMethodValue, http.StatusForbidden)
		return
	}

	verificationMethod, verificationError := validateRegistrationVerification(
		verificationMethodValue,
		fixedPIN,
		confirmFixedPIN,
	)
	if verificationError != "" {
		showRegisterForm(w, r, registerErrors{Verification: verificationError}, verificationMethodValue, http.StatusOK)
		return
	}

	// The submitted name, address and full name stay out of the log.
	logging.Infof("received registration data")

	if validationErr := credentials.ValidateLoginName(loginName); validationErr != nil {
		refusal := httpresponse.AccountNameRefusal(validationErr)
		showRegisterForm(w, r, registerErrors{LoginName: refusal.LangKey}, string(verificationMethod), refusal.Status)
		return
	}
	hashed_password, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		logging.Errorf("error: password hashing failed: %s", err.Error())
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "password hashing failed")
		return
	}
	fixedPINHash, err := buildRegistrationFixedPINHash(verificationMethod, fixedPIN)
	if err != nil {
		logging.Errorf("error: fixed PIN hashing failed: %s", err.Error())
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "registration failed (verification)")
		return
	}

	enabled := isLocalDevelopmentLoginRequest(clientIP)
	newUserID, err := createRegisteredAccount(r.Context(), loginName, username, fullName, email, string(hashed_password), fixedPINHash, verificationMethod, enabled)
	if err != nil {
		var refusal *httpresponse.Refusal
		if errors.As(err, &refusal) {
			errs := registerErrors{}
			switch refusal.LangKey {
			case "login_name_exists", "login_name_invalid", "login_name_reserved":
				errs.LoginName = refusal.LangKey
			case "username_exists", "username_empty":
				errs.Username = refusal.LangKey
			case "email_exists":
				errs.Email = refusal.LangKey
			default:
				errs.General = refusal.LangKey
			}
			showRegisterForm(w, r, errs, string(verificationMethod), refusal.Status)
		} else {
			httpresponse.RespondWithError(w, 500, "registration_failed")
		}
		return
	}
	logging.Infof("registration committed for user id=%d", newUserID)
	status := accountNoticeStatus(r.Context(), email, loginName, true)
	if strings.Contains(r.Header.Get("Accept"), "application/json") {
		httpresponse.RespondWithJSON(w, http.StatusOK, map[string]interface{}{"registered": true, "mail_status": status, "redirect": "/login"})
		return
	}
	showRegisterForm(w, r, registerErrors{Success: status}, string(verificationMethod), http.StatusOK)
}

type registerErrors struct {
	LoginName    string
	Success      string
	Username     string
	Email        string
	Verification string
	General      string
}

// validateRegistrationVerification accepts only methods that ordinary self-registration can finish safely.
// It bridges untrusted form values with the restricted credential fields created for the new user.
// It exists to keep unsupported or incompletely configured factors out of login-ready account records.
func validateRegistrationVerification(methodValue, fixedPIN, confirmFixedPIN string) (loginVerificationMethod, string) {
	method, err := parseLoginVerificationMethod(methodValue)
	if err != nil || method == verificationTOTP {
		return "", "first_run_verification_invalid"
	}
	switch method {
	case verificationFixedPIN:
		if !isValidFixedPIN(fixedPIN) {
			return "", "first_run_fixed_pin_invalid"
		}
		if fixedPIN != confirmFixedPIN {
			return "", "first_run_fixed_pin_mismatch"
		}
	case verificationEmail:
		if !registrationEmailVerificationAvailable() {
			return "", "first_run_postmark_required"
		}
	}
	return method, ""
}

// registrationEmailVerificationAvailable exposes email choice only when delivery has both required credentials.
// It bridges protected process configuration with the public registration form and server validation.
// It exists so users cannot select an authentication method that the installation cannot deliver.
func registrationEmailVerificationAvailable() bool {
	return isPostmarkDeliveryConfiguredForAuth() &&
		firstConfiguredAuthEnv("EMAIL_FROM_ADDRESS", "POSTMARK_FROM_ADDRESS") != ""
}

// buildRegistrationFixedPINHash turns a validated fixed PIN into restricted credential material.
// It bridges the selected registration method with the bcrypt-based sign-in verifier.
// It exists so plaintext PIN values never enter the stored user record.
func buildRegistrationFixedPINHash(method loginVerificationMethod, fixedPIN string) (string, error) {
	if method != verificationFixedPIN {
		return "", nil
	}
	return hashFixedPIN(fixedPIN)
}

func selectedRegistrationVerificationMethod(value string, emailAvailable bool) string {
	method, err := parseLoginVerificationMethod(value)
	if err != nil || method == verificationTOTP || (method == verificationEmail && !emailAvailable) {
		return string(defaultRegistrationVerificationMethod)
	}
	return string(method)
}

func showRegisterForm(w http.ResponseWriter, r *http.Request, errs registerErrors, verificationMethod string, status int) {
	frontendassets.SetShellNoStoreHeaders(w)
	standalonePage := r.URL.Query().Get("fragment") != "1"
	session, err := e_sessions.GetOrCreateSession(w, r)
	if err != nil {
		logging.Errorf("[showRegisterForm] session get failed: %v, resetting", err)
		session = e_sessions.NewSessionWithCookieOptions()
	}

	csrfToken, ok := session.Values["csrf_token"].(string)
	if !ok || csrfToken == "" {
		csrfToken = uuid.NewString()
		session.Values["csrf_token"] = csrfToken
		if err = e_sessions.Save(w, r, session); err != nil {
			respondAuthPageFailure(w, r, standalonePage)
			return
		}
	}

	templatePath := filepath.Join(frontend_dir, "templates", "register.html")
	tmpl, err := template.ParseFiles(templatePath)
	if err != nil {
		logging.Errorf("error: register template load failed: %s", err.Error())
		respondAuthPageFailure(w, r, standalonePage)
		return
	}

	emailVerificationAvailable := registrationEmailVerificationAvailable()
	data := struct {
		frontendassets.ShellPageData
		LoginNameErr               string
		Success                    string
		UsernameErr                string
		EmailErr                   string
		VerificationErr            string
		GeneralErr                 string
		CSRFToken                  string
		FormAction                 string
		VerificationMethod         string
		EmailVerificationAvailable bool
	}{
		ShellPageData:              frontendassets.NewShellPageData(r),
		LoginNameErr:               errs.LoginName,
		Success:                    errs.Success,
		UsernameErr:                errs.Username,
		EmailErr:                   errs.Email,
		VerificationErr:            errs.Verification,
		GeneralErr:                 errs.General,
		CSRFToken:                  csrfToken,
		FormAction:                 buildRegisterFormActionPath(r),
		VerificationMethod:         selectedRegistrationVerificationMethod(verificationMethod, emailVerificationAvailable),
		EmailVerificationAvailable: emailVerificationAvailable,
	}

	var rendered bytes.Buffer
	if err = tmpl.Execute(&rendered, data); err != nil {
		logging.Errorf("error: register template execution failed: %s", err.Error())
		respondAuthPageFailure(w, r, standalonePage)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write(rendered.Bytes())
}

func buildRegisterFormActionPath(r *http.Request) string {
	if r != nil && r.URL.Query().Get("fragment") == "1" {
		return "/api/register_ndYOyXV0INOK3F?fragment=1"
	}
	return "/api/register_ndYOyXV0INOK3F"
}
