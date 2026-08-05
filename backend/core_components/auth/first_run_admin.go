// first_run_admin.go
// Creates the first login-ready administrator from a one-time browser form.
// Bridges the server-owned first-run flag, restricted credentials, and admin membership in one transaction.
// Exists so a fresh Easelect/Filterest install never ships reusable administrator credentials.
package auth

import (
	"context"
	"database/sql"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/logging"
	e_sessions "easelect/backend/core_components/sessions"
	"errors"
	"html/template"
	"net/http"
	"net/mail"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/gorilla/sessions"
	"golang.org/x/crypto/bcrypt"
)

const (
	firstRunConfigKey                = "first_run"
	installationEnvironmentConfigKey = "installation_environment"
	siteNameConfigKey                = "site_name"
	firstRunCreationSpec             = "first-run administrator browser setup"
	minimumAdminPassword             = 12
	maximumAdminPassword             = 128
	maximumAdminUsername             = 64
	maximumSiteName                  = 100
)

var (
	firstRunUsernamePattern  = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]*$`)
	errFirstRunClosed        = errors.New("first-run administrator setup is closed")
	errFirstRunUsernameTaken = errors.New("first-run administrator username is already in use")
	errFirstRunEmailTaken    = errors.New("first-run administrator email is already in use")
	firstRunPendingReader    = IsFirstRunAdminSetupPending
)

type firstRunAdminInput struct {
	SiteName           string
	Username           string
	Email              string
	Password           string
	ConfirmPassword    string
	Environment        string
	VerificationMethod string
	FixedPIN           string
	ConfirmFixedPIN    string
	TOTPCode           string
	TOTPSecret         string
}

type firstRunAdminErrors struct {
	SiteName     string
	Username     string
	Email        string
	Password     string
	Environment  string
	Verification string
	Factor       string
	General      string
}

// FirstRunAdminHandler serves and submits the one-time administrator form.
// It remains public only while the database says setup is pending and no login-ready admin exists.
func FirstRunAdminHandler(w http.ResponseWriter, r *http.Request) {
	pending, err := firstRunPendingReader(r.Context(), backend.Db)
	if err != nil {
		logging.Errorf("[FirstRunAdminHandler] first-run state check failed: %v", err)
		httpresponse.RespondWithError(w, http.StatusServiceUnavailable, "First-run setup is unavailable")
		return
	}
	if !pending {
		http.Redirect(w, r, "/login", http.StatusSeeOther)
		return
	}

	switch r.Method {
	case http.MethodGet:
		showFirstRunAdminForm(w, r, firstRunAdminInput{}, firstRunAdminErrors{}, http.StatusOK)
	case http.MethodPost:
		handleFirstRunAdminPost(w, r)
	default:
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

func handleFirstRunAdminPost(w http.ResponseWriter, r *http.Request) {
	clientIP := getClientIP(r)
	if checkLoginRateLimit(clientIP) {
		httpresponse.RespondWithError(w, http.StatusTooManyRequests, "Too many setup attempts. Please try again later.")
		return
	}

	if err := r.ParseForm(); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "form processing failed")
		return
	}

	input := firstRunAdminInput{
		SiteName:           strings.TrimSpace(r.FormValue("site_name")),
		Username:           strings.TrimSpace(r.FormValue("username")),
		Email:              strings.TrimSpace(r.FormValue("email")),
		Password:           r.FormValue("password"),
		ConfirmPassword:    r.FormValue("confirm_password"),
		Environment:        strings.ToLower(strings.TrimSpace(r.FormValue("installation_environment"))),
		VerificationMethod: strings.ToLower(strings.TrimSpace(r.FormValue("verification_method"))),
		FixedPIN:           strings.TrimSpace(r.FormValue("fixed_pin")),
		ConfirmFixedPIN:    strings.TrimSpace(r.FormValue("confirm_fixed_pin")),
		TOTPCode:           strings.TrimSpace(r.FormValue("totp_code")),
	}

	session, err := e_sessions.GetOrCreateSession(w, r)
	if err != nil {
		showFirstRunAdminForm(w, r, input, firstRunAdminErrors{General: "session_error"}, http.StatusInternalServerError)
		return
	}
	postedToken := r.FormValue("csrf_token")
	sessionToken, _ := session.Values["csrf_token"].(string)
	if postedToken == "" || sessionToken == "" || postedToken != sessionToken {
		showFirstRunAdminForm(w, r, input, firstRunAdminErrors{General: "csrf_token_invalid"}, http.StatusForbidden)
		return
	}
	input.TOTPSecret, _ = session.Values["first_run_totp_secret"].(string)

	validationErrors := validateFirstRunAdminInput(input)
	if validationErrors != (firstRunAdminErrors{}) {
		showFirstRunAdminForm(w, r, input, validationErrors, http.StatusBadRequest)
		return
	}

	if err = createFirstRunAdmin(r.Context(), backend.Db, input); err != nil {
		switch {
		case errors.Is(err, errFirstRunClosed):
			http.Redirect(w, r, "/login", http.StatusSeeOther)
		case errors.Is(err, errFirstRunUsernameTaken):
			showFirstRunAdminForm(w, r, input, firstRunAdminErrors{Username: "username_exists"}, http.StatusConflict)
		case errors.Is(err, errFirstRunEmailTaken):
			showFirstRunAdminForm(w, r, input, firstRunAdminErrors{Email: "email_exists"}, http.StatusConflict)
		default:
			logging.Errorf("[FirstRunAdminHandler] administrator creation failed: %v", err)
			showFirstRunAdminForm(w, r, input, firstRunAdminErrors{General: "first_run_admin_creation_failed"}, http.StatusInternalServerError)
		}
		return
	}

	delete(session.Values, "first_run_totp_secret")
	if err = saveSession(w, r, session); err != nil {
		logging.Errorf("[FirstRunAdminHandler] failed to clear enrollment secret from session: %v", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "session_error")
		return
	}

	http.Redirect(w, r, "/login?first-run-complete=1", http.StatusSeeOther)
}

func validateFirstRunAdminInput(input firstRunAdminInput) firstRunAdminErrors {
	var validation firstRunAdminErrors
	if !isValidFirstRunSiteName(input.SiteName) {
		validation.SiteName = "first_run_site_name_invalid"
	}
	switch input.Environment {
	case "dev", "test", "qa", "prod":
	default:
		validation.Environment = "first_run_environment_invalid"
	}
	method, methodErr := parseLoginVerificationMethod(input.VerificationMethod)
	if methodErr != nil {
		validation.Verification = "first_run_verification_invalid"
	} else {
		switch method {
		case verificationFixedPIN:
			if !isValidFixedPIN(input.FixedPIN) {
				validation.Factor = "first_run_fixed_pin_invalid"
			} else if input.FixedPIN != input.ConfirmFixedPIN {
				validation.Factor = "first_run_fixed_pin_mismatch"
			}
		case verificationTOTP:
			if input.TOTPSecret == "" || !verifyTOTPAt(input.TOTPSecret, input.TOTPCode, time.Now()) {
				validation.Factor = "first_run_totp_invalid"
			}
		case verificationEmail:
			if !isPostmarkDeliveryConfiguredForAuth() || firstConfiguredAuthEnv("EMAIL_FROM_ADDRESS", "POSTMARK_FROM_ADDRESS") == "" {
				validation.Factor = "first_run_postmark_required"
			}
		}
	}
	if len(input.Username) < 3 || len(input.Username) > maximumAdminUsername || !firstRunUsernamePattern.MatchString(input.Username) {
		validation.Username = "first_run_username_invalid"
	}
	parsedAddress, emailErr := mail.ParseAddress(input.Email)
	if emailErr != nil || !strings.EqualFold(parsedAddress.Address, input.Email) {
		validation.Email = "first_run_email_invalid"
	}
	if len(input.Password) < minimumAdminPassword || len(input.Password) > maximumAdminPassword {
		validation.Password = "first_run_password_invalid"
	} else if input.Password != input.ConfirmPassword {
		validation.Password = "first_run_password_mismatch"
	}
	return validation
}

func isValidFirstRunSiteName(siteName string) bool {
	if siteName != strings.TrimSpace(siteName) {
		return false
	}
	runeCount := utf8.RuneCountInString(siteName)
	if runeCount < 1 || runeCount > maximumSiteName {
		return false
	}
	for _, value := range siteName {
		if unicode.IsControl(value) {
			return false
		}
	}
	return true
}

// isFirstRunAdminSetupPending fails closed unless both required conditions hold.
func IsFirstRunAdminSetupPending(ctx context.Context, db *sql.DB) (bool, error) {
	if db == nil {
		return false, errors.New("database is not initialized")
	}
	var pending bool
	err := db.QueryRowContext(ctx, `
		SELECT COALESCE(boolean_value, FALSE)
		       AND NOT EXISTS (
				SELECT 1
				FROM system_users u
				JOIN system_user_group_memberships ug ON ug.user_id = u.id
				JOIN system_user_groups g ON g.id = ug.group_id AND g.name = 'admins'
				JOIN restricted.users_restricted ur ON ur.id = u.id
				WHERE u.enabled IS TRUE
				  AND u.admin_access_allowed IS TRUE
			)
		FROM system_config
		WHERE key = $1
	`, firstRunConfigKey).Scan(&pending)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return pending, err
}

// createFirstRunAdmin serializes concurrent attempts by locking the first-run row.
// Every account, credential, permission, and flag change shares one transaction.
func createFirstRunAdmin(ctx context.Context, db *sql.DB, input firstRunAdminInput) error {
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	method, err := parseLoginVerificationMethod(input.VerificationMethod)
	if err != nil {
		return err
	}
	var fixedPINHash string
	if method == verificationFixedPIN {
		fixedPINHash, err = hashFixedPIN(input.FixedPIN)
		if err != nil {
			return err
		}
	}
	var totpSecret string
	if method == verificationTOTP {
		totpSecret = normalizeTOTPSecret(input.TOTPSecret)
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var firstRun bool
	if err = tx.QueryRowContext(ctx, `
		SELECT COALESCE(boolean_value, FALSE)
		FROM system_config
		WHERE key = $1
		FOR UPDATE
	`, firstRunConfigKey).Scan(&firstRun); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return errFirstRunClosed
		}
		return err
	}
	if !firstRun {
		return errFirstRunClosed
	}

	var existing int
	err = tx.QueryRowContext(ctx, `
		SELECT 1
		FROM system_users u
		JOIN system_user_group_memberships ug ON ug.user_id = u.id
		JOIN system_user_groups g ON g.id = ug.group_id AND g.name = 'admins'
		JOIN restricted.users_restricted ur ON ur.id = u.id
		WHERE u.enabled IS TRUE
		  AND u.admin_access_allowed IS TRUE
		LIMIT 1
	`).Scan(&existing)
	if err == nil {
		return errFirstRunClosed
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}

	result, err := tx.ExecContext(ctx, `
		UPDATE system_config
		SET text_value = $1,
		    json_value = jsonb_build_object('value', $1::text),
		    updated = NOW()
		WHERE key = $2
	`, input.Environment, installationEnvironmentConfigKey)
	if err != nil {
		return err
	}
	if rows, rowsErr := result.RowsAffected(); rowsErr != nil || rows != 1 {
		if rowsErr != nil {
			return rowsErr
		}
		return errors.New("installation environment config is unavailable")
	}

	result, err = tx.ExecContext(ctx, `
		UPDATE system_config
		SET text_value = $1,
		    json_value = jsonb_build_object('value', $1::text),
		    updated = NOW()
		WHERE key = $2
	`, input.SiteName, siteNameConfigKey)
	if err != nil {
		return err
	}
	if rows, rowsErr := result.RowsAffected(); rowsErr != nil || rows != 1 {
		if rowsErr != nil {
			return rowsErr
		}
		return errors.New("site name config is unavailable")
	}

	err = tx.QueryRowContext(ctx, `SELECT 1 FROM system_users WHERE lower(username) = lower($1) LIMIT 1`, input.Username).Scan(&existing)
	if err == nil {
		return errFirstRunUsernameTaken
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	err = tx.QueryRowContext(ctx, `SELECT 1 FROM restricted.users_restricted WHERE lower(email) = lower($1) LIMIT 1`, input.Email).Scan(&existing)
	if err == nil {
		return errFirstRunEmailTaken
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}

	var adminGroupID int64
	if err = tx.QueryRowContext(ctx, `SELECT id FROM system_user_groups WHERE name = 'admins'`).Scan(&adminGroupID); err != nil {
		return err
	}

	var userID int64
	if err = tx.QueryRowContext(ctx, `
		INSERT INTO system_users (
			username, full_name, created, updated, enabled, privileged,
			main_group_id, creation_spec, admin_access_allowed
		)
		VALUES ($1, $1, NOW(), NOW(), TRUE, FALSE, $2, $3, TRUE)
		RETURNING id
	`, input.Username, adminGroupID, firstRunCreationSpec).Scan(&userID); err != nil {
		return err
	}

	if _, err = tx.ExecContext(ctx, `
		INSERT INTO system_user_group_memberships (user_id, group_id, created, updated, creation_spec)
		VALUES ($1, $2, NOW(), NOW(), $3)
	`, userID, adminGroupID, firstRunCreationSpec); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `
		INSERT INTO restricted.users_restricted (
			id, password, email, login_verification_method, fixed_pin_hash, totp_secret
		)
		VALUES ($1, $2, $3, $4, NULLIF($5, ''), NULLIF($6, ''))
	`, userID, string(hashedPassword), input.Email, string(method), fixedPINHash, totpSecret); err != nil {
		return err
	}
	result, err = tx.ExecContext(ctx, `
		UPDATE system_config
		SET boolean_value = FALSE,
		    json_value = jsonb_set(COALESCE(json_value, '{}'::jsonb), '{value}', 'false'::jsonb, TRUE),
		    updated = NOW()
		WHERE key = $1 AND boolean_value IS TRUE
	`, firstRunConfigKey)
	if err != nil {
		return err
	}
	if rows, rowsErr := result.RowsAffected(); rowsErr != nil || rows != 1 {
		if rowsErr != nil {
			return rowsErr
		}
		return errFirstRunClosed
	}

	return tx.Commit()
}

func showFirstRunAdminForm(w http.ResponseWriter, r *http.Request, input firstRunAdminInput, errs firstRunAdminErrors, status int) {
	session, err := e_sessions.GetOrCreateSession(w, r)
	if err != nil {
		logging.Errorf("[showFirstRunAdminForm] session get failed: %v, resetting", err)
		session = sessions.NewSession(store, e_sessions.SessionName)
	}

	csrfToken, _ := session.Values["csrf_token"].(string)
	sessionChanged := false
	if csrfToken == "" {
		csrfToken = uuid.NewString()
		session.Values["csrf_token"] = csrfToken
		sessionChanged = true
	}
	totpSecret, _ := session.Values["first_run_totp_secret"].(string)
	if totpSecret == "" {
		totpSecret, err = generateTOTPSecret()
		if err != nil {
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "Internal server error")
			return
		}
		session.Values["first_run_totp_secret"] = totpSecret
		sessionChanged = true
	}
	if sessionChanged {
		if err = saveSession(w, r, session); err != nil {
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "Internal server error")
			return
		}
	}

	tmpl, err := template.ParseFiles(filepath.Join(frontend_dir, "templates", "first_run_admin.html"))
	if err != nil {
		logging.Errorf("[showFirstRunAdminForm] template load failed: %v", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "Internal server error")
		return
	}
	w.Header().Set("Cache-Control", "no-store, max-age=0, must-revalidate, private")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")
	if status != http.StatusOK {
		w.WriteHeader(status)
	}
	if input.Environment == "" {
		if isExplicitDevEnvironment() {
			input.Environment = "dev"
		} else {
			input.Environment = "prod"
		}
	}
	if input.VerificationMethod == "" {
		input.VerificationMethod = string(verificationNone)
	}
	initialSection := "settings"
	if errs.SiteName != "" || errs.Username != "" || errs.Email != "" || errs.Password != "" || errs.General != "" {
		initialSection = "credentials"
	}
	data := struct {
		FirstRunSiteName   string
		Username           string
		Email              string
		Environment        string
		VerificationMethod string
		TOTPSecret         string
		InitialSection     string
		SiteNameErr        string
		UsernameErr        string
		EmailErr           string
		PasswordErr        string
		EnvironmentErr     string
		VerificationErr    string
		FactorErr          string
		GeneralErr         string
		CSRFToken          string
	}{
		FirstRunSiteName: input.SiteName, Username: input.Username, Email: input.Email,
		Environment: input.Environment, VerificationMethod: input.VerificationMethod,
		TOTPSecret: totpSecret, InitialSection: initialSection,
		SiteNameErr: errs.SiteName, UsernameErr: errs.Username, EmailErr: errs.Email,
		PasswordErr: errs.Password, EnvironmentErr: errs.Environment,
		VerificationErr: errs.Verification, FactorErr: errs.Factor, GeneralErr: errs.General,
		CSRFToken: csrfToken,
	}
	if err = tmpl.Execute(w, data); err != nil {
		logging.Errorf("[showFirstRunAdminForm] template execution failed: %v", err)
	}
}
