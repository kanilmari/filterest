// user_profile_handlers.go
// Handles fetching and updating user profile data (username, email, password).
// Bridges public system_users fields and restricted.users_restricted via separate DB connections.
// Exists to provide profile read/write endpoints that respect the public/confidential data split.
package auth

import (
	"database/sql"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/email"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/logging"
	"easelect/backend/core_components/otp"
	e_sessions "easelect/backend/core_components/sessions"
	"encoding/json"
	"net/http"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

// UserProfileFetchHandler returns the authenticated user's username and email.
func UserProfileFetchHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	session, err := e_sessions.GetOrCreateSession(w, r)
	if err != nil {
		logging.Errorf("[UserProfileFetchHandler] session get failed: %v", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "session_error")
		return
	}

	userID, ok := session.Values["user_id"].(int)
	// Guest browsing uses user_id=1 without a real confidential profile row.
	// Treat that identity as unauthenticated for the profile endpoint.
	if !ok || userID <= 1 {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, "not_authenticated")
		return
	}

	var username string
	err = backend.Db.QueryRow(`SELECT username FROM system_users WHERE id = $1`, userID).Scan(&username)
	if err != nil {
		logging.Errorf("[UserProfileFetchHandler] failed to fetch username for user %d: %v", userID, err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "db_error")
		return
	}

	var email string
	err = backend.DbConfidential.QueryRow(`SELECT email FROM restricted.users_restricted WHERE id = $1`, userID).Scan(&email)
	if err != nil {
		logging.Errorf("[UserProfileFetchHandler] failed to fetch email for user %d: %v", userID, err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "db_error")
		return
	}

	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]interface{}{
		"user_id":  userID,
		"username": username,
		"email":    email,
	})
}

type profileUpdateRequest struct {
	Username        string `json:"username"`
	Email           string `json:"email"`
	EmailOTP        string `json:"email_otp"`
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
	PasswordOTP     string `json:"password_otp"`
}

// UserProfileUpdateHandler updates the authenticated user's username, email, and/or password.
func UserProfileUpdateHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	session, err := e_sessions.GetOrCreateSession(w, r)
	if err != nil {
		logging.Errorf("[UserProfileUpdateHandler] session get failed: %v", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "session_error")
		return
	}

	userID, ok := session.Values["user_id"].(int)
	if !ok || userID == 0 {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, "not_authenticated")
		return
	}

	// CSRF validation
	csrfHeader := r.Header.Get("X-CSRF-Token")
	csrfSession, _ := session.Values["csrf_token"].(string)
	if csrfHeader == "" || csrfSession == "" || csrfHeader != csrfSession {
		httpresponse.RespondWithError(w, http.StatusForbidden, "csrf_token_invalid")
		return
	}

	var req profileUpdateRequest
	if err = json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid_request_body")
		return
	}

	// Require current password for any account identifier changes (username, email)
	if req.Username != "" || req.Email != "" {
		if req.CurrentPassword == "" {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "current_password_required")
			return
		}

		var hashedPassword string
		err = backend.DbConfidential.QueryRow(
			`SELECT password FROM restricted.users_restricted WHERE id = $1`, userID,
		).Scan(&hashedPassword)
		if err != nil {
			logging.Errorf("[UserProfileUpdateHandler] failed to fetch password hash for verification: %v", err)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "db_error")
			return
		}

		if err = bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(req.CurrentPassword)); err != nil {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "current_password_incorrect")
			return
		}
	}

	// Fetch current username for comparison
	var currentUsername string
	err = backend.Db.QueryRow(`SELECT username FROM system_users WHERE id = $1`, userID).Scan(&currentUsername)
	if err != nil {
		logging.Errorf("[UserProfileUpdateHandler] failed to fetch current username for user %d: %v", userID, err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "db_error")
		return
	}

	// Update username if provided and changed
	if req.Username != "" && req.Username != currentUsername {
		if len(strings.TrimSpace(req.Username)) == 0 {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "username_empty")
			return
		}

		var existingID int
		err = backend.Db.QueryRow(`SELECT id FROM system_users WHERE username = $1 AND id != $2`, req.Username, userID).Scan(&existingID)
		if err != nil && err != sql.ErrNoRows {
			logging.Errorf("[UserProfileUpdateHandler] username uniqueness check failed: %v", err)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "db_error")
			return
		}
		if err == nil {
			httpresponse.RespondWithError(w, http.StatusConflict, "username_exists")
			return
		}

		_, err = backend.Db.Exec(`UPDATE system_users SET username = $1, updated = NOW() WHERE id = $2`, req.Username, userID)
		if err != nil {
			logging.Errorf("[UserProfileUpdateHandler] failed to update username for user %d: %v", userID, err)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "db_error")
			return
		}

		session.Values["username"] = req.Username
		if saveErr := saveSession(w, r, session); saveErr != nil {
			logging.Errorf("[UserProfileUpdateHandler] failed to save session after username update: %v", saveErr)
		}
		logging.Infof("[UserProfileUpdateHandler] username updated for user %d", userID)
	}

	// Fetch current email for comparison
	var currentEmail string
	err = backend.DbConfidential.QueryRow(`SELECT email FROM restricted.users_restricted WHERE id = $1`, userID).Scan(&currentEmail)
	if err != nil {
		logging.Errorf("[UserProfileUpdateHandler] failed to fetch current email for user %d: %v", userID, err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "db_error")
		return
	}

	// Update email if provided and changed — requires OTP verification
	if req.Email != "" && req.Email != currentEmail {
		if !strings.Contains(req.Email, "@") || !strings.Contains(req.Email, ".") {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "email_invalid")
			return
		}

		// Email ownership verification is required in every environment.
		if req.EmailOTP == "" {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "email_otp_required")
			return
		}
		verification, verifyErr := otp.VerifyOTPForTarget(userID, otp.ProfileEmailChange, req.Email, req.EmailOTP)
		if verifyErr != nil {
			logging.Errorf("[UserProfileUpdateHandler] email OTP verify error: %v", verifyErr)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "otp_verify_error")
			return
		}
		if !verification.IsVerified() {
			httpresponse.RespondWithError(w, http.StatusUnauthorized, "email_otp_invalid")
			return
		}

		var existingID int
		err = backend.DbConfidential.QueryRow(`SELECT id FROM restricted.users_restricted WHERE email = $1 AND id != $2`, req.Email, userID).Scan(&existingID)
		if err != nil && err != sql.ErrNoRows {
			logging.Errorf("[UserProfileUpdateHandler] email uniqueness check failed: %v", err)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "db_error")
			return
		}
		if err == nil {
			httpresponse.RespondWithError(w, http.StatusConflict, "email_exists")
			return
		}

		_, err = backend.DbConfidential.Exec(`UPDATE restricted.users_restricted SET email = $1 WHERE id = $2`, req.Email, userID)
		if err != nil {
			logging.Errorf("[UserProfileUpdateHandler] failed to update email for user %d: %v", userID, err)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "db_error")
			return
		}
		logging.Infof("[UserProfileUpdateHandler] email updated for user %d", userID)
	}

	// Update password if new password is provided — requires OTP verification
	if req.NewPassword != "" {
		if req.CurrentPassword == "" {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "current_password_required")
			return
		}

		var hashedPassword string
		err = backend.DbConfidential.QueryRow(`SELECT password FROM restricted.users_restricted WHERE id = $1`, userID).Scan(&hashedPassword)
		if err != nil {
			logging.Errorf("[UserProfileUpdateHandler] failed to fetch password hash for user %d: %v", userID, err)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "db_error")
			return
		}

		if err = bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(req.CurrentPassword)); err != nil {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "current_password_incorrect")
			return
		}

		// Password-change verification is required in every environment.
		if req.PasswordOTP == "" {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "password_otp_required")
			return
		}
		verification, verifyErr := otp.VerifyOTP(userID, otp.ProfilePasswordChange, req.PasswordOTP)
		if verifyErr != nil {
			logging.Errorf("[UserProfileUpdateHandler] password OTP verify error: %v", verifyErr)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "otp_verify_error")
			return
		}
		if !verification.IsVerified() {
			httpresponse.RespondWithError(w, http.StatusUnauthorized, "password_otp_invalid")
			return
		}

		newHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
		if err != nil {
			logging.Errorf("[UserProfileUpdateHandler] failed to hash new password for user %d: %v", userID, err)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "password_hash_error")
			return
		}

		_, err = backend.DbConfidential.Exec(`UPDATE restricted.users_restricted SET password = $1 WHERE id = $2`, string(newHash), userID)
		if err != nil {
			logging.Errorf("[UserProfileUpdateHandler] failed to update password for user %d: %v", userID, err)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "db_error")
			return
		}
		logging.Infof("[UserProfileUpdateHandler] password updated for user %d", userID)
	}

	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "profile_updated",
	})
}

// --- OTP request endpoints for profile changes ---

type emailChangeOTPRequest struct {
	NewEmail        string `json:"new_email"`
	CurrentPassword string `json:"current_password"`
}

// RequestEmailChangeOTPHandler sends an OTP to the new email address for verification.
func RequestEmailChangeOTPHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	session, err := e_sessions.GetOrCreateSession(w, r)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "session_error")
		return
	}
	userID, ok := session.Values["user_id"].(int)
	if !ok || userID == 0 {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, "not_authenticated")
		return
	}

	// CSRF
	csrfHeader := r.Header.Get("X-CSRF-Token")
	csrfSession, _ := session.Values["csrf_token"].(string)
	if csrfHeader == "" || csrfSession == "" || csrfHeader != csrfSession {
		httpresponse.RespondWithError(w, http.StatusForbidden, "csrf_token_invalid")
		return
	}

	var req emailChangeOTPRequest
	if err = json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid_request_body")
		return
	}

	if req.NewEmail == "" || !strings.Contains(req.NewEmail, "@") {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "email_invalid")
		return
	}

	// Verify current password
	var hashedPassword string
	err = backend.DbConfidential.QueryRow(
		`SELECT password FROM restricted.users_restricted WHERE id = $1`, userID,
	).Scan(&hashedPassword)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "db_error")
		return
	}
	if err = bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(req.CurrentPassword)); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "current_password_incorrect")
		return
	}

	// Check email uniqueness
	var existingID int
	err = backend.DbConfidential.QueryRow(
		`SELECT id FROM restricted.users_restricted WHERE email = $1 AND id != $2`, req.NewEmail, userID,
	).Scan(&existingID)
	if err == nil {
		httpresponse.RespondWithError(w, http.StatusConflict, "email_exists")
		return
	}
	if err != sql.ErrNoRows {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "db_error")
		return
	}

	// Rate limit
	reservation, err := otp.ReserveSend(userID, otp.ProfileEmailChange)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "internal_error")
		return
	}
	if !reservation.Allowed {
		httpresponse.RespondWithError(w, http.StatusTooManyRequests, "too_many_otp_requests")
		return
	}

	// Create and send OTP to the NEW email
	code, err := otp.CreateOTP(userID, otp.ProfileEmailChange, req.NewEmail)
	if err != nil {
		logging.Errorf("[RequestEmailChangeOTP] OTP creation failed: %v", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "otp_creation_failed")
		return
	}

	if err = email.SendOTPEmail(req.NewEmail, otp.FormatCode(code), "email_change"); err != nil {
		logging.Errorf("[RequestEmailChangeOTP] email send failed: %v", err)
		if revokeErr := otp.RevokeOTP(userID, otp.ProfileEmailChange, code); revokeErr != nil {
			logging.Errorf("[RequestEmailChangeOTP] failed to revoke undelivered OTP: %v", revokeErr)
		}
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "email_send_failed")
		return
	}

	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]interface{}{
		"otp_sent":     true,
		"masked_email": maskEmail(req.NewEmail),
	})
}

type passwordChangeOTPRequest struct {
	CurrentPassword string `json:"current_password"`
}

// RequestPasswordChangeOTPHandler sends an OTP to the user's current email for password change verification.
func RequestPasswordChangeOTPHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	session, err := e_sessions.GetOrCreateSession(w, r)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "session_error")
		return
	}
	userID, ok := session.Values["user_id"].(int)
	if !ok || userID == 0 {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, "not_authenticated")
		return
	}

	// CSRF
	csrfHeader := r.Header.Get("X-CSRF-Token")
	csrfSession, _ := session.Values["csrf_token"].(string)
	if csrfHeader == "" || csrfSession == "" || csrfHeader != csrfSession {
		httpresponse.RespondWithError(w, http.StatusForbidden, "csrf_token_invalid")
		return
	}

	var req passwordChangeOTPRequest
	if err = json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid_request_body")
		return
	}

	// Verify current password
	var hashedPassword string
	err = backend.DbConfidential.QueryRow(
		`SELECT password FROM restricted.users_restricted WHERE id = $1`, userID,
	).Scan(&hashedPassword)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "db_error")
		return
	}
	if err = bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(req.CurrentPassword)); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "current_password_incorrect")
		return
	}

	// Get current email
	var userEmail string
	err = backend.DbConfidential.QueryRow(
		`SELECT email FROM restricted.users_restricted WHERE id = $1`, userID,
	).Scan(&userEmail)
	if err != nil || userEmail == "" {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "email_not_found")
		return
	}

	// Rate limit
	reservation, err := otp.ReserveSend(userID, otp.ProfilePasswordChange)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "internal_error")
		return
	}
	if !reservation.Allowed {
		httpresponse.RespondWithError(w, http.StatusTooManyRequests, "too_many_otp_requests")
		return
	}

	// Create and send OTP to CURRENT email
	code, err := otp.CreateOTP(userID, otp.ProfilePasswordChange, userEmail)
	if err != nil {
		logging.Errorf("[RequestPasswordChangeOTP] OTP creation failed: %v", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "otp_creation_failed")
		return
	}

	if err = email.SendOTPEmail(userEmail, otp.FormatCode(code), "password_change"); err != nil {
		logging.Errorf("[RequestPasswordChangeOTP] email send failed: %v", err)
		if revokeErr := otp.RevokeOTP(userID, otp.ProfilePasswordChange, code); revokeErr != nil {
			logging.Errorf("[RequestPasswordChangeOTP] failed to revoke undelivered OTP: %v", revokeErr)
		}
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "email_send_failed")
		return
	}

	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]interface{}{
		"otp_sent":     true,
		"masked_email": maskEmail(userEmail),
	})
}
