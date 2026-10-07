// password_reset_handler.go
// Handles the unauthenticated login-surface password reset flow via OTP.
// Bridges pre-login session state, the reusable OTP/email pipeline, and password updates.
// Exists so forgot-password recovery can reuse the same verification stack as login/profile changes.

package auth

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/auth/credentials"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/logging"
	"easelect/backend/core_components/otp"
	e_sessions "easelect/backend/core_components/sessions"

	"github.com/gorilla/sessions"
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

func setPendingPasswordResetState(session *sessions.Session, userID int, generation int64) error {
	clearPendingPasswordResetState(session)
	value, err := e_sessions.SealPasswordResetPending(userID, generation)
	if err != nil {
		return err
	}
	session.Values["password_reset_pending"] = value
	return nil
}

func clearPendingPasswordResetState(session *sessions.Session) {
	delete(session.Values, "password_reset_pending")
	delete(session.Values, "password_reset_pending_user_id")
	delete(session.Values, "password_reset_pending_authentication_generation")
}

func RequestPasswordResetOTPHandler(w http.ResponseWriter, r *http.Request) {

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

	userID, userEmail, generation, found, err := lookupPasswordResetUser(identifier)
	if err != nil {
		logging.Errorf("[password-reset] lookup failed")
		httpresponse.RespondWithError(w, 500, "internal_error")
		return
	}
	if err = setPendingPasswordResetState(session, userID, generation); err != nil {
		httpresponse.RespondWithError(w, 500, "session_error")
		return
	}
	if err = e_sessions.Save(w, r, session); err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "session_error")
		return
	}

	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]interface{}{
		"password_reset_requested": true,
	})
	// Flush the acknowledgement before the background transport can start.
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}
	if found {
		go deliverPasswordReset(userID, userEmail)
	}

}

func ResetPasswordWithOTPHandler(w http.ResponseWriter, r *http.Request) {

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

	pending, _ := session.Values["password_reset_pending"].(string)
	userID, expectedGeneration := e_sessions.OpenPasswordResetPending(pending)
	if strings.TrimSpace(req.NewPassword) == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "new_password_required")
		return
	}

	verification, verifyErr := otp.VerifyOTP(userID, otp.ProfilePasswordReset, req.OTPCode)
	if verifyErr != nil {
		logging.Errorf("[ResetPasswordWithOTPHandler] OTP verify failed: %v", verifyErr)
		httpresponse.RespondWithError(w, http.StatusUnauthorized, "wrong_otp")
		return
	}
	if !verification.IsVerified() || userID <= 1 || expectedGeneration < 1 {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, "wrong_otp")
		return
	}

	if _, err = credentials.ChangePassword(r.Context(), backend.DbConfidential, userID, req.NewPassword, expectedGeneration); err != nil {
		logging.Errorf("[ResetPasswordWithOTPHandler] password update failed: %v", err)
		if errors.Is(err, credentials.ErrCredentialStateChanged) {
			clearPendingPasswordResetState(session)
			_ = e_sessions.Save(w, r, session)
			httpresponse.RespondWithError(w, http.StatusUnauthorized, "wrong_otp")
			return
		}
		if errors.Is(err, credentials.ErrInvalidPassword) {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "new_password_invalid")
			return
		}
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "db_error")
		return
	}

	clearPendingPasswordResetState(session)
	if err = e_sessions.Save(w, r, session); err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "session_error")
		return
	}

	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]interface{}{
		"password_reset": true,
	})
}

func lookupPasswordResetUser(identifier string) (int, string, int64, bool, error) {
	var id int
	var address string
	var generation int64
	clean := strings.TrimSpace(identifier)
	if clean == "" {
		return 0, "", 0, false, nil
	}
	column := "ur.login_name"
	if strings.Contains(clean, "@") {
		column = "ur.email"
	}
	err := backend.DbConfidential.QueryRow(`SELECT u.id,COALESCE(ur.email,''),ur.authentication_generation FROM restricted.users_restricted ur JOIN system_users u ON u.id=ur.id WHERE lower(`+column+`)=lower($1) AND u.enabled IS TRUE`, clean).Scan(&id, &address, &generation)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, "", 0, false, nil
	}
	if err != nil {
		return 0, "", 0, false, err
	}
	if strings.TrimSpace(address) == "" {
		return 0, "", 0, false, nil
	}
	return id, address, generation, true, nil
}

func deliverPasswordReset(id int, address string) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	reservation, err := otp.ReserveSend(id, otp.ProfilePasswordReset)
	if err != nil || !reservation.Allowed {
		return
	}
	code, err := otp.CreateOTP(id, otp.ProfilePasswordReset, address)
	if err != nil {
		logging.Errorf("[password-reset] code creation failed")
		return
	}
	var loginName string
	err = backend.DbConfidential.QueryRowContext(ctx, `SELECT login_name FROM restricted.users_restricted WHERE id=$1`, id).Scan(&loginName)
	if err == nil {
		err = sendResetEmail(address, otp.FormatCode(code), loginName, accountMailText(ctx, "password_reset"), accountMailText(ctx, "login_name"), accountMailText(ctx, "otp"))
	}
	if err != nil {
		logging.Errorf("[password-reset] mail delivery failed")
		_ = otp.RevokeOTP(id, otp.ProfilePasswordReset, code)
	}
}
