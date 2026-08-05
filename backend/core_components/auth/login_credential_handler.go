// login_credential_handler.go
// Handles the two-step JSON and legacy form login flows for authentication requests.
// Bridges credential checks, OTP delivery, and session creation for login requests.
// Exists to keep login entry-point branching and authentication handoff in one handler.

package auth

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/email"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/logging"
	"easelect/backend/core_components/otp"
	e_sessions "easelect/backend/core_components/sessions"

	"github.com/google/uuid"
	"github.com/gorilla/sessions"
	"golang.org/x/crypto/bcrypt"
)

const localLoginFactorMaxAttempts = 5

func LoginAPIHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	// AJAX JSON flow (new 2-step OTP login)
	ct := r.Header.Get("Content-Type")
	if strings.HasPrefix(ct, "application/json") {
		handleLoginJSON(w, r)
		return
	}
	// Legacy form-POST flow
	handleLoginPost(w, r)
}

// loginJSONRequest is the JSON body for the AJAX login flow.
type loginJSONRequest struct {
	Username    string `json:"username"`
	Password    string `json:"password"`
	Fingerprint string `json:"fingerprint"`
	CSRFToken   string `json:"csrf_token"`
	OTPCode     string `json:"otp_code"`
}

// handleLoginJSON handles the AJAX 2-step login:
//   - Phase 1 (otp_code empty): verify credentials → send OTP → respond {otp_required}
//   - Phase 2 (otp_code present): verify OTP → authenticate → respond {authenticated}
func handleLoginJSON(w http.ResponseWriter, r *http.Request) {
	if shouldBlockLoginAttempt(w, r) {
		respondJSON(w, http.StatusTooManyRequests, map[string]interface{}{
			"error": loginRateLimitErrorMessage,
		})
		return
	}

	var req loginJSONRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "invalid_request_body"})
		return
	}

	// Session & CSRF
	session, err := e_sessions.GetOrCreateSession(w, r)
	if err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]interface{}{"error": "session_error"})
		return
	}

	sessionToken, _ := session.Values["csrf_token"].(string)
	if req.CSRFToken == "" || sessionToken == "" || req.CSRFToken != sessionToken {
		respondJSON(w, http.StatusForbidden, map[string]interface{}{"error": "csrf_token_invalid"})
		return
	}

	// Phase 2: OTP verification
	if req.OTPCode != "" {
		handleLoginOTPVerify(w, r, session, req)
		return
	}

	// Phase 1: Credential verification → send OTP
	handleLoginCredentials(w, r, session, req)
}

// handleLoginCredentials verifies username+password and follows the user's configured factor.
func handleLoginCredentials(w http.ResponseWriter, r *http.Request, session *sessions.Session, req loginJSONRequest) {
	if req.Username == "" || req.Password == "" {
		respondJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "username_and_password_required"})
		return
	}

	// Look up user
	var userID int
	err := backend.Db.QueryRow(
		`SELECT id FROM system_users WHERE username = $1 AND enabled = true`,
		req.Username,
	).Scan(&userID)
	if err != nil {
		respondJSON(w, http.StatusUnauthorized, map[string]interface{}{"error": "wrong_credentials"})
		return
	}

	// Verify password
	var hashedPassword string
	err = backend.DbConfidential.QueryRow(
		`SELECT password FROM restricted.users_restricted WHERE id = $1`, userID,
	).Scan(&hashedPassword)
	if err != nil {
		respondJSON(w, http.StatusUnauthorized, map[string]interface{}{"error": "wrong_credentials"})
		return
	}
	if err = bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(req.Password)); err != nil {
		respondJSON(w, http.StatusUnauthorized, map[string]interface{}{"error": "wrong_credentials"})
		return
	}
	log.Printf("[login-json] credentials OK for user %s (id=%d) 🔑", req.Username, userID)

	verification, err := loadLoginVerificationRecord(userID)
	if err != nil {
		logging.Errorf("[login-json] failed to load login verification for user %d: %v", userID, err)
		respondJSON(w, http.StatusInternalServerError, map[string]interface{}{"error": "verification_method_unavailable"})
		return
	}

	switch verification.Method {
	case verificationNone:
		completeLoginJSON(w, r, session, userID, req.Username, req.Fingerprint)
		return
	case verificationFixedPIN, verificationTOTP:
		setPendingLoginState(session, userID, req.Username, req.Fingerprint)
		if err = saveSession(w, r, session); err != nil {
			respondJSON(w, http.StatusInternalServerError, map[string]interface{}{"error": "session_error"})
			return
		}
		respondJSON(w, http.StatusOK, map[string]interface{}{
			"otp_required":        true,
			"verification_method": string(verification.Method),
		})
		return
	case verificationEmail:
		// Continue below through the rate-limited email challenge pipeline.
	default:
		respondJSON(w, http.StatusInternalServerError, map[string]interface{}{"error": "verification_method_unavailable"})
		return
	}

	// Email verification: generate and send a rate-limited one-time code.
	reservation, err := otp.ReserveSend(userID, otp.ProfileLogin)
	if err != nil {
		logging.Errorf("[login-json] rate limit check error: %v", err)
		respondJSON(w, http.StatusInternalServerError, map[string]interface{}{"error": "internal_error"})
		return
	}
	if !reservation.Allowed {
		respondJSON(w, http.StatusTooManyRequests, map[string]interface{}{
			"error": "too_many_otp_requests",
		})
		return
	}

	if verification.Email == "" {
		logging.Errorf("[login-json] no email configured for user %d", userID)
		respondJSON(w, http.StatusInternalServerError, map[string]interface{}{"error": "email_not_found"})
		return
	}

	// Create OTP (5 minutes TTL)
	code, err := otp.CreateOTP(userID, otp.ProfileLogin, verification.Email)
	if err != nil {
		logging.Errorf("[login-json] OTP creation failed: %v", err)
		respondJSON(w, http.StatusInternalServerError, map[string]interface{}{"error": "otp_creation_failed"})
		return
	}

	// Send OTP email
	formattedCode := otp.FormatCode(code)
	if err = email.SendOTPEmail(verification.Email, formattedCode, "login"); err != nil {
		logging.Errorf("[login-json] email send failed: %v", err)
		if revokeErr := otp.RevokeOTP(userID, otp.ProfileLogin, code); revokeErr != nil {
			logging.Errorf("[login-json] failed to revoke undelivered OTP: %v", revokeErr)
		}
		respondJSON(w, http.StatusInternalServerError, map[string]interface{}{"error": "email_send_failed"})
		return
	}

	setPendingLoginState(session, userID, req.Username, req.Fingerprint)
	if err = saveSession(w, r, session); err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]interface{}{"error": "session_error"})
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"otp_required":        true,
		"verification_method": string(verificationEmail),
		"masked_email":        maskEmail(verification.Email),
	})
}

// handleLoginOTPVerify checks the OTP code and authenticates the session.
func handleLoginOTPVerify(w http.ResponseWriter, r *http.Request, session *sessions.Session, req loginJSONRequest) {
	userID, ok := session.Values["otp_pending_user_id"].(int)
	if !ok || userID == 0 {
		respondJSON(w, http.StatusUnauthorized, map[string]interface{}{"error": "no_pending_otp"})
		return
	}
	username, _ := session.Values["otp_pending_username"].(string)
	fingerprint, _ := session.Values["otp_pending_fingerprint"].(string)

	verificationRecord, err := loadLoginVerificationRecord(userID)
	if err != nil {
		logging.Errorf("[login-json] failed to load pending verification for user %d: %v", userID, err)
		respondJSON(w, http.StatusInternalServerError, map[string]interface{}{"error": "verification_method_unavailable"})
		return
	}

	verified := false
	attemptsRemaining := -1
	switch verificationRecord.Method {
	case verificationFixedPIN:
		verified = verifyFixedPIN(verificationRecord.PINHash, req.OTPCode)
		attemptsRemaining = localLoginFactorAttemptsRemaining(session, verified)
	case verificationTOTP:
		verified = verifyTOTPAt(verificationRecord.TOTPSecret, req.OTPCode, time.Now())
		attemptsRemaining = localLoginFactorAttemptsRemaining(session, verified)
	case verificationEmail:
		verification, err := otp.VerifyOTP(userID, otp.ProfileLogin, req.OTPCode)
		if err != nil {
			logging.Errorf("[login-json] OTP verify error: %v", err)
			respondJSON(w, http.StatusInternalServerError, map[string]interface{}{"error": "otp_verify_error"})
			return
		}
		verified = verification.IsVerified()
		attemptsRemaining = verification.AttemptsRemaining
	case verificationNone:
		respondJSON(w, http.StatusUnauthorized, map[string]interface{}{"error": "no_pending_otp"})
		return
	}
	if !verified {
		if attemptsRemaining == 0 {
			clearPendingLoginState(session)
		}
		if verificationRecord.Method != verificationEmail {
			if saveErr := saveSession(w, r, session); saveErr != nil {
				respondJSON(w, http.StatusInternalServerError, map[string]interface{}{"error": "session_error"})
				return
			}
		}
		respondJSON(w, http.StatusUnauthorized, map[string]interface{}{
			"error":              "wrong_otp",
			"attempts_remaining": attemptsRemaining,
		})
		return
	}

	// Clean up pending values
	clearPendingLoginState(session)

	completeLoginJSON(w, r, session, userID, username, fingerprint)
}

// completeLoginJSON regenerates and persists an authenticated session after all configured checks pass.
func completeLoginJSON(w http.ResponseWriter, r *http.Request, session *sessions.Session, userID int, username, fingerprint string) {
	session.Options.MaxAge = -1
	if err := session.Save(r, w); err != nil {
		log.Printf("session invalidation warning: %s", err.Error())
	}
	session, err := e_sessions.GetOrCreateSession(w, r)
	if err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]interface{}{"error": "session_error"})
		return
	}
	session.Options = &sessions.Options{
		Path:     "/",
		MaxAge:   86400 * 7,
		HttpOnly: true,
		Secure:   e_sessions.ShouldUseSecureCookies(),
		SameSite: http.SameSiteLaxMode,
	}

	if err = setAuthenticatedSessionIdentity(session, userID, username); err != nil {
		logging.Errorf("[login-json] session identity setup failed for user %d: %v", userID, err)
		respondJSON(w, http.StatusInternalServerError, map[string]interface{}{"error": "session_error"})
		return
	}

	// Device ID
	deviceCookie, err := r.Cookie("device_id")
	var deviceID string
	if err != nil || deviceCookie.Value == "" {
		deviceID = uuid.NewString()
	} else {
		deviceID = deviceCookie.Value
	}
	session.Values["device_id"] = deviceID

	// Fingerprint
	isDev := os.Getenv("ENVIRONMENT_TYPE") == "dev"
	if fingerprint == "" && !isDev {
		respondJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "fingerprint_required"})
		return
	}
	if fingerprint == "" && isDev {
		fingerprint = "dev-mode-fingerprint"
	}
	hmacFP := HMACFingerprint(fingerprint)
	session.Values["fingerprint_hash"] = hmacFP

	// Cookies
	cookieLifetime := 7 * 24 * time.Hour
	http.SetCookie(w, &http.Cookie{
		Name: "fingerprint", Value: hmacFP, Path: "/",
		HttpOnly: true, Secure: e_sessions.ShouldUseSecureCookies(), SameSite: http.SameSiteLaxMode,
		Expires: time.Now().Add(cookieLifetime),
	})
	http.SetCookie(w, &http.Cookie{
		Name: "device_id", Value: deviceID, Path: "/",
		HttpOnly: true, Secure: e_sessions.ShouldUseSecureCookies(), SameSite: http.SameSiteLaxMode,
		Expires: time.Now().Add(cookieLifetime),
	})

	// Save session
	if err = saveSession(w, r, session); err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]interface{}{"error": "session_error"})
		return
	}

	log.Printf("[login-json] user '%s' (id=%d) authenticated successfully 🎉", username, userID)
	respondJSON(w, http.StatusOK, map[string]interface{}{
		"authenticated": true,
		"redirect":      "/",
	})
}

func setPendingLoginState(session *sessions.Session, userID int, username, fingerprint string) {
	session.Values["otp_pending_user_id"] = userID
	session.Values["otp_pending_username"] = username
	session.Values["otp_pending_fingerprint"] = fingerprint
	session.Values["otp_pending_attempts"] = 0
}

func clearPendingLoginState(session *sessions.Session) {
	delete(session.Values, "otp_pending_user_id")
	delete(session.Values, "otp_pending_username")
	delete(session.Values, "otp_pending_fingerprint")
	delete(session.Values, "otp_pending_attempts")
}

func localLoginFactorAttemptsRemaining(session *sessions.Session, verified bool) int {
	if verified {
		return localLoginFactorMaxAttempts
	}
	attempts, _ := session.Values["otp_pending_attempts"].(int)
	attempts++
	session.Values["otp_pending_attempts"] = attempts
	remaining := localLoginFactorMaxAttempts - attempts
	if remaining < 0 {
		return 0
	}
	return remaining
}

// respondJSON writes a JSON response with the given status code.
func respondJSON(w http.ResponseWriter, status int, data map[string]interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

// maskEmail masks an email for display: "user@example.com" → "u***@e***.com"
func maskEmail(addr string) string {
	parts := strings.SplitN(addr, "@", 2)
	if len(parts) != 2 {
		return "***"
	}
	local := parts[0]
	domain := parts[1]
	if len(local) > 1 {
		local = string(local[0]) + "***"
	}
	dotIdx := strings.LastIndex(domain, ".")
	if dotIdx > 1 {
		domain = string(domain[0]) + "***" + domain[dotIdx:]
	}
	return local + "@" + domain
}
