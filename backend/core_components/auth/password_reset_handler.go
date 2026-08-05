// password_reset_handler.go
// Handles the unauthenticated login-surface password reset flow via OTP.
// Bridges pre-login session state, the reusable OTP/email pipeline, and password updates.
// Exists so forgot-password recovery can reuse the same verification stack as login/profile changes.

package auth

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/email"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/logging"
	"easelect/backend/core_components/otp"
	e_sessions "easelect/backend/core_components/sessions"

	"github.com/gorilla/sessions"
	"golang.org/x/crypto/bcrypt"
)

const passwordResetPurpose = "password_reset"

type passwordResetOTPRequest struct {
	Identifier string `json:"identifier"`
	CSRFToken  string `json:"csrf_token"`
}

type passwordResetConfirmRequest struct {
	OTPCode     string `json:"otp_code"`
	NewPassword string `json:"new_password"`
	CSRFToken   string `json:"csrf_token"`
}

func setPendingPasswordResetState(session *sessions.Session, userID int) {
	session.Values["password_reset_pending_user_id"] = userID
}

func clearPendingPasswordResetState(session *sessions.Session) {
	delete(session.Values, "password_reset_pending_user_id")
}

func RequestPasswordResetOTPHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	session, err := e_sessions.GetOrCreateSession(w, r)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "session_error")
		return
	}

	var req passwordResetOTPRequest
	if err = json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid_request_body")
		return
	}

	sessionToken, _ := session.Values["csrf_token"].(string)
	if req.CSRFToken == "" || sessionToken == "" || req.CSRFToken != sessionToken {
		httpresponse.RespondWithError(w, http.StatusForbidden, "csrf_token_invalid")
		return
	}

	identifier := strings.TrimSpace(req.Identifier)
	if identifier == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "identifier_required")
		return
	}

	userID, userEmail, found, err := lookupPasswordResetUser(identifier)
	if err != nil {
		logging.Errorf("[RequestPasswordResetOTPHandler] lookup failed: %v", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "internal_error")
		return
	}

	clearPendingPasswordResetState(session)

	if found {
		reservation, limitErr := otp.ReserveSend(userID, otp.ProfilePasswordReset)
		if limitErr != nil {
			logging.Errorf("[RequestPasswordResetOTPHandler] rate limit check failed: %v", limitErr)
		} else if reservation.Allowed {
			code, createErr := otp.CreateOTP(userID, otp.ProfilePasswordReset, userEmail)
			if createErr != nil {
				logging.Errorf("[RequestPasswordResetOTPHandler] OTP creation failed: %v", createErr)
			} else if sendErr := email.SendOTPEmail(userEmail, otp.FormatCode(code), passwordResetPurpose); sendErr != nil {
				logging.Errorf("[RequestPasswordResetOTPHandler] email send failed: %v", sendErr)
				if revokeErr := otp.RevokeOTP(userID, otp.ProfilePasswordReset, code); revokeErr != nil {
					logging.Errorf("[RequestPasswordResetOTPHandler] failed to revoke undelivered OTP: %v", revokeErr)
				}
			} else {
				setPendingPasswordResetState(session, userID)
			}
		}
	}

	if err = saveSession(w, r, session); err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "session_error")
		return
	}

	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]interface{}{
		"password_reset_requested": true,
	})
}

func ResetPasswordWithOTPHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	session, err := e_sessions.GetOrCreateSession(w, r)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "session_error")
		return
	}

	var req passwordResetConfirmRequest
	if err = json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid_request_body")
		return
	}

	sessionToken, _ := session.Values["csrf_token"].(string)
	if req.CSRFToken == "" || sessionToken == "" || req.CSRFToken != sessionToken {
		httpresponse.RespondWithError(w, http.StatusForbidden, "csrf_token_invalid")
		return
	}

	userID, ok := session.Values["password_reset_pending_user_id"].(int)
	if !ok || userID == 0 {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, "no_pending_password_reset")
		return
	}
	if strings.TrimSpace(req.NewPassword) == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "new_password_required")
		return
	}

	verification, verifyErr := otp.VerifyOTP(userID, otp.ProfilePasswordReset, req.OTPCode)
	if verifyErr != nil {
		logging.Errorf("[ResetPasswordWithOTPHandler] OTP verify failed: %v", verifyErr)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "otp_verify_error")
		return
	}
	if !verification.IsVerified() {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, "wrong_otp")
		return
	}

	newHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "password_hash_error")
		return
	}

	if _, err = backend.DbConfidential.Exec(
		`UPDATE restricted.users_restricted SET password = $1 WHERE id = $2`,
		string(newHash), userID,
	); err != nil {
		logging.Errorf("[ResetPasswordWithOTPHandler] password update failed: %v", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "db_error")
		return
	}

	clearPendingPasswordResetState(session)
	if err = saveSession(w, r, session); err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "session_error")
		return
	}

	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]interface{}{
		"password_reset": true,
	})
}

func lookupPasswordResetUser(identifier string) (int, string, bool, error) {
	cleanIdentifier := strings.TrimSpace(identifier)
	if cleanIdentifier == "" {
		return 0, "", false, nil
	}

	if strings.Contains(cleanIdentifier, "@") {
		var userID int
		err := backend.DbConfidential.QueryRow(
			`SELECT id FROM restricted.users_restricted WHERE LOWER(email) = LOWER($1)`,
			cleanIdentifier,
		).Scan(&userID)
		if err == sql.ErrNoRows {
			return 0, "", false, nil
		}
		if err != nil {
			return 0, "", false, err
		}

		if !isEnabledUser(userID) {
			return 0, "", false, nil
		}
		return userID, cleanIdentifier, true, nil
	}

	var userID int
	err := backend.Db.QueryRow(
		`SELECT id FROM system_users WHERE LOWER(username) = LOWER($1) AND enabled = true`,
		cleanIdentifier,
	).Scan(&userID)
	if err == sql.ErrNoRows {
		return 0, "", false, nil
	}
	if err != nil {
		return 0, "", false, err
	}

	var userEmail string
	err = backend.DbConfidential.QueryRow(
		`SELECT email FROM restricted.users_restricted WHERE id = $1`,
		userID,
	).Scan(&userEmail)
	if err == sql.ErrNoRows || strings.TrimSpace(userEmail) == "" {
		return 0, "", false, nil
	}
	if err != nil {
		return 0, "", false, err
	}

	return userID, userEmail, true, nil
}

func isEnabledUser(userID int) bool {
	var enabled bool
	err := backend.Db.QueryRow(
		`SELECT enabled FROM system_users WHERE id = $1`,
		userID,
	).Scan(&enabled)
	return err == nil && enabled
}
