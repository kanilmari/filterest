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

	var username, website, bio string
	err = backend.Db.QueryRow(`SELECT COALESCE(username,''),COALESCE(website,''),COALESCE(bio_social_medias,'') FROM system_users WHERE id = $1`, userID).Scan(&username, &website, &bio)
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
		"user_id":           userID,
		"username":          username,
		"email":             email,
		"website":           website,
		"bio_social_medias": bio,
	})
}

// --- OTP request endpoints for profile changes ---

type emailChangeOTPRequest struct {
	NewEmail        string `json:"new_email"`
	CurrentPassword string `json:"current_password"`
}

// RequestEmailChangeOTPHandler sends an OTP to the new email address for verification.
func RequestEmailChangeOTPHandler(w http.ResponseWriter, r *http.Request) {

	session, err := e_sessions.GetOrCreateSession(w, r)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "session_error")
		return
	}
	userID, ok := session.Values["user_id"].(int)
	if !ok || userID <= 1 {
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

	session, err := e_sessions.GetOrCreateSession(w, r)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "session_error")
		return
	}
	userID, ok := session.Values["user_id"].(int)
	if !ok || userID <= 1 {
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
