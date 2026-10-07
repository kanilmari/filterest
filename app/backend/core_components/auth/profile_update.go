// profile_update.go
// Applies the signed-in account's allowed profile fields as one committed change.
// Bridges current-password/OTP proof, private names and the current cookie's generation.
// Exists to keep rejected name changes from partially saving another profile field.
package auth

import (
	"database/sql"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/auth/credentials"
	"easelect/backend/core_components/auth_generation"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/otp"
	sessions "easelect/backend/core_components/sessions"
	"encoding/json"
	"errors"
	"golang.org/x/crypto/bcrypt"
	"net/http"
	"strings"
)

type profileUpdateRequest struct {
	Username            string  `json:"username"`
	LoginName           *string `json:"login_name"`
	Email               string  `json:"email"`
	EmailOTP            string  `json:"email_otp"`
	CurrentPassword     string  `json:"current_password"`
	NewPassword         string  `json:"new_password"`
	PasswordOTP         string  `json:"password_otp"`
	Website             *string `json:"website"`
	BioSocialMedias     *string `json:"bio_social_medias"`
	SignOutOtherDevices bool    `json:"sign_out_other_devices"`
}

// UserProfileUpdateHandler commits only the current account’s allowed profile fields.
func UserProfileUpdateHandler(w http.ResponseWriter, r *http.Request) { updateOwnProfile(w, r, false) }

// SignOutOtherDevicesHandler always targets the cookie's account, never a submitted id.
func SignOutOtherDevicesHandler(w http.ResponseWriter, r *http.Request) { updateOwnProfile(w, r, true) }

func profileFailure(w http.ResponseWriter, status int, key string) {
	httpresponse.RespondWithRefusal(w, &httpresponse.Refusal{Status: status, LangKey: key, Message: key})
}

func updateOwnProfile(w http.ResponseWriter, r *http.Request, signOut bool) {
	session, err := sessions.GetOrCreateSession(w, r)
	if err != nil {
		profileFailure(w, 500, "session_error")
		return
	}
	id, ok := session.Values["user_id"].(int)
	if !ok || id <= 1 {
		profileFailure(w, 401, "not_authenticated")
		return
	}
	token, _ := session.Values["csrf_token"].(string)
	if token == "" || r.Header.Get("X-CSRF-Token") != token {
		profileFailure(w, 403, "csrf_token_invalid")
		return
	}
	var req profileUpdateRequest
	if json.NewDecoder(r.Body).Decode(&req) != nil {
		profileFailure(w, 400, "invalid_request_body")
		return
	}
	req.SignOutOtherDevices = req.SignOutOtherDevices || signOut
	if req.LoginName != nil {
		reservation, err := otp.ReserveSend(id, otp.ProfileLoginNameChange)
		if err != nil {
			profileFailure(w, 500, "internal_error")
			return
		}
		if !reservation.Allowed {
			profileFailure(w, 429, "login_name_change_rate_limited")
			return
		}
	}
	expected, ok := auth_generation.SessionValue(session)
	if !ok || backend.DbAdmin == nil {
		profileFailure(w, 401, "credentials_changed")
		return
	}
	tx, err := backend.DbAdmin.BeginTx(r.Context(), nil)
	if err != nil {
		profileFailure(w, 500, "db_error")
		return
	}
	defer tx.Rollback()
	// Lock in the same order as the account-name rule and all other account mutations.
	var enabled bool
	var username string
	err = tx.QueryRowContext(r.Context(), `SELECT enabled IS TRUE,COALESCE(username,'') FROM system_users WHERE id=$1 FOR UPDATE`, id).Scan(&enabled, &username)
	if err != nil || !enabled {
		profileFailure(w, 401, "credentials_changed")
		return
	}
	var hash, address, method string
	var generation int64
	err = tx.QueryRowContext(r.Context(), `SELECT password,COALESCE(email,''),login_verification_method,authentication_generation FROM restricted.users_restricted WHERE id=$1 FOR UPDATE`, id).Scan(&hash, &address, &method, &generation)
	if err != nil || generation != expected {
		profileFailure(w, 401, "credentials_changed")
		return
	}
	needsPassword := req.Username != "" || req.LoginName != nil || req.Email != "" || req.NewPassword != "" || req.SignOutOtherDevices
	if needsPassword {
		if req.CurrentPassword == "" {
			profileFailure(w, 400, "current_password_required")
			return
		}
		limited, checkErr := profilePasswordAttemptLimitReached(tx, id)
		if checkErr != nil {
			profileFailure(w, 500, "db_error")
			return
		}
		if limited {
			profileFailure(w, 429, "profile_password_rate_limited")
			return
		}
		if bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.CurrentPassword)) != nil {
			if err := commitProfilePasswordFailure(tx, id); err != nil {
				profileFailure(w, 500, "db_error")
				return
			}
			profileFailure(w, 400, "current_password_incorrect")
			return
		}
	}
	// Verify OTPs before changing any row. Their own service transaction is independent.
	if req.Email != "" && req.Email != address {
		if credentials.ValidateAdministratorEmail(req.Email) != nil {
			profileFailure(w, 400, "email_invalid")
			return
		}
		if req.EmailOTP == "" {
			profileFailure(w, 400, "email_otp_required")
			return
		}
		proof, err := otp.VerifyOTPForTarget(id, otp.ProfileEmailChange, req.Email, req.EmailOTP)
		if err != nil || !proof.IsVerified() {
			profileFailure(w, 401, "email_otp_invalid")
			return
		}
	}
	if req.NewPassword != "" {
		if credentials.ValidatePassword(req.NewPassword) != nil {
			profileFailure(w, 400, "new_password_invalid")
			return
		}
		if req.PasswordOTP == "" {
			profileFailure(w, 400, "password_otp_required")
			return
		}
		proof, err := otp.VerifyOTP(id, otp.ProfilePasswordChange, req.PasswordOTP)
		if err != nil || !proof.IsVerified() {
			profileFailure(w, 401, "password_otp_invalid")
			return
		}
	}
	// The fixed struct above is the allow-list; forged ids and administrator fields are ignored.
	if req.Username != "" && req.Username != username {
		if strings.TrimSpace(req.Username) == "" {
			profileFailure(w, 400, "username_empty")
			return
		}
		var exists bool
		if err = tx.QueryRowContext(r.Context(), `SELECT EXISTS(SELECT 1 FROM system_users WHERE lower(username)=lower($1) AND id<>$2)`, req.Username, id).Scan(&exists); err != nil {
			profileFailure(w, 500, "db_error")
			return
		}
		if exists {
			profileFailure(w, 409, "username_exists")
			return
		}
		_, err = tx.ExecContext(r.Context(), `UPDATE system_users SET username=$1,search_vector_simple=NULL,updated=NOW() WHERE id=$2`, req.Username, id)
	}
	if err == nil && (req.Website != nil || req.BioSocialMedias != nil) {
		_, err = tx.ExecContext(r.Context(), `UPDATE system_users SET website=COALESCE($1,website),bio_social_medias=COALESCE($2,bio_social_medias),updated=NOW() WHERE id=$3`, req.Website, req.BioSocialMedias, id)
	}
	rotate := false
	if err == nil && req.Email != "" && req.Email != address {
		var exists bool
		err = tx.QueryRowContext(r.Context(), `SELECT EXISTS(SELECT 1 FROM restricted.users_restricted WHERE lower(email)=lower($1) AND id<>$2)`, req.Email, id).Scan(&exists)
		if err == nil && exists {
			profileFailure(w, 409, "email_exists")
			return
		}
		if err == nil {
			_, err = tx.ExecContext(r.Context(), `UPDATE restricted.users_restricted SET email=$1 WHERE id=$2`, req.Email, id)
			address = req.Email
			rotate = method == string(verificationEmail)
		}
	}
	if err == nil && req.NewPassword != "" {
		var passwordHash []byte
		passwordHash, err = bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
		if err == nil {
			_, err = tx.ExecContext(r.Context(), `UPDATE restricted.users_restricted SET password=$1 WHERE id=$2`, string(passwordHash), id)
			rotate = true
		}
	}
	if err == nil && req.LoginName != nil {
		generation, err = credentials.ChangeLoginName(tx, int64(id), *req.LoginName)
	} else if err == nil && (rotate || req.SignOutOtherDevices) {
		generation, err = credentials.EndOtherSignIns(tx, int64(id))
	}
	if err == nil && req.SignOutOtherDevices {
		err = credentials.WriteAccountSecurityAudit(tx, int64(id), "sign_out_other_devices")
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		if refusal := httpresponse.AccountNameRefusal(err); refusal != nil {
			httpresponse.RespondWithRefusal(w, refusal)
		} else if errors.Is(err, sql.ErrNoRows) {
			profileFailure(w, 401, "credentials_changed")
		} else {
			profileFailure(w, 500, "db_error")
		}
		return
	}
	if generation != expected {
		if auth_generation.Set(session, generation) != nil || sessions.Save(w, r, session) != nil {
			profileFailure(w, 500, "session_error")
			return
		}
	}
	result := map[string]interface{}{"success": true, "message": "profile_updated"}
	if req.SignOutOtherDevices {
		result["message"] = "other_devices_signed_out"
	}
	if req.LoginName != nil {
		result["message"] = "login_name_changed"
		result["mail_status"] = accountNoticeStatus(r.Context(), address, *req.LoginName, false)
	}
	httpresponse.RespondWithJSON(w, 200, result)
}
