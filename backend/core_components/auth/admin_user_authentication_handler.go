// admin_user_authentication_handler.go
// Lists non-secret user authentication state and provisions administrator access.
// Bridges the administrator API, public user/group rows, and restricted login factors.
// Exists to replace unsafe multi-step or direct-database administrator provisioning.
package auth

import (
	"database/sql"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/logging"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
)

var errAdminAuthenticationUserNotFound = errors.New("user authentication record not found")

type adminUserAuthenticationRecord struct {
	UserID             int64  `json:"user_id"`
	Username           string `json:"username"`
	Enabled            bool   `json:"enabled"`
	AdminGroupMember   bool   `json:"admin_group_member"`
	AdminAccessAllowed bool   `json:"admin_access_allowed"`
	VerificationMethod string `json:"verification_method"`
}

type adminUserAuthenticationRequest struct {
	UserID             int64  `json:"user_id"`
	VerificationMethod string `json:"verification_method"`
	FixedPIN           string `json:"fixed_pin"`
}

// AdminUserAuthenticationHandler lists method-only authentication state on GET
// and atomically provisions one enabled administrator with a selected factor on POST.
func AdminUserAuthenticationHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		listAdminUserAuthentication(w, r)
	case http.MethodPost:
		provisionAdminUserAuthentication(w, r)
	default:
		w.Header().Set("Allow", "GET, POST")
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func listAdminUserAuthentication(w http.ResponseWriter, r *http.Request) {
	db := backend.DbAdmin
	if db == nil {
		db = backend.Db
	}
	if db == nil {
		httpresponse.RespondWithError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}

	rows, err := db.QueryContext(r.Context(), `
		SELECT u.id,
		       u.username,
		       COALESCE(u.enabled, FALSE),
		       EXISTS (
		           SELECT 1
		           FROM system_user_group_memberships membership
		           JOIN system_user_groups user_group ON user_group.id = membership.group_id
		           WHERE membership.user_id = u.id
		             AND user_group.name = 'admins'
		       ),
		       COALESCE(u.admin_access_allowed, FALSE),
		       ur.login_verification_method
		FROM system_users u
		JOIN restricted.users_restricted ur ON ur.id = u.id
		WHERE u.id > 1
		ORDER BY lower(u.username), u.id
	`)
	if err != nil {
		logging.Errorf("[AdminUserAuthenticationHandler] list query failed: %v", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "user_authentication_list_failed")
		return
	}
	defer rows.Close()

	records := make([]adminUserAuthenticationRecord, 0)
	for rows.Next() {
		var record adminUserAuthenticationRecord
		var rawMethod string
		if err = rows.Scan(
			&record.UserID,
			&record.Username,
			&record.Enabled,
			&record.AdminGroupMember,
			&record.AdminAccessAllowed,
			&rawMethod,
		); err != nil {
			logging.Errorf("[AdminUserAuthenticationHandler] list row scan failed: %v", err)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "user_authentication_list_failed")
			return
		}
		method, parseErr := parseLoginVerificationMethod(rawMethod)
		if parseErr != nil {
			logging.Errorf("[AdminUserAuthenticationHandler] invalid stored factor for user %d", record.UserID)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "verification_method_unavailable")
			return
		}
		record.VerificationMethod = string(method)
		records = append(records, record)
	}
	if err = rows.Err(); err != nil {
		logging.Errorf("[AdminUserAuthenticationHandler] list iteration failed: %v", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "user_authentication_list_failed")
		return
	}

	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]interface{}{"users": records})
}

func provisionAdminUserAuthentication(w http.ResponseWriter, r *http.Request) {
	request, method, fixedPINHash, err := decodeAdminUserAuthenticationRequest(r)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	tx, err := dbutils.RequireTxWithError(r.Context())
	if err != nil {
		logging.Errorf("[AdminUserAuthenticationHandler] transaction unavailable: %v", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction_unavailable")
		return
	}

	record, err := applyAdminUserAuthenticationProvisioning(tx, request.UserID, method, fixedPINHash)
	if errors.Is(err, errAdminAuthenticationUserNotFound) {
		httpresponse.RespondWithError(w, http.StatusNotFound, "user_not_found")
		return
	}
	if err != nil {
		logging.Errorf("[AdminUserAuthenticationHandler] provisioning failed for user %d: %v", request.UserID, err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "user_authentication_update_failed")
		return
	}

	httpresponse.RespondWithJSON(w, http.StatusOK, record)
}

func decodeAdminUserAuthenticationRequest(r *http.Request) (adminUserAuthenticationRequest, loginVerificationMethod, string, error) {
	var request adminUserAuthenticationRequest
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return request, "", "", errors.New("invalid_request_body")
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return request, "", "", errors.New("invalid_request_body")
	}
	if request.UserID <= 1 {
		return request, "", "", errors.New("invalid_user_id")
	}

	method, err := parseLoginVerificationMethod(request.VerificationMethod)
	if err != nil || method == verificationTOTP {
		return request, "", "", errors.New("unsupported_verification_method")
	}

	fixedPIN := request.FixedPIN
	if method != verificationFixedPIN {
		if strings.TrimSpace(fixedPIN) != "" {
			return request, "", "", errors.New("fixed_pin_not_allowed")
		}
		if method == verificationEmail && !registrationEmailVerificationAvailable() {
			return request, "", "", errors.New("email_verification_unavailable")
		}
		return request, method, "", nil
	}

	fixedPINHash, err := hashFixedPIN(fixedPIN)
	if err != nil {
		return request, "", "", errors.New("fixed_pin_invalid")
	}
	return request, method, fixedPINHash, nil
}

// applyAdminUserAuthenticationProvisioning mutates public access and restricted
// factor state through one transaction so partial administrator grants roll back.
func applyAdminUserAuthenticationProvisioning(
	tx *sql.Tx,
	userID int64,
	method loginVerificationMethod,
	fixedPINHash string,
) (adminUserAuthenticationRecord, error) {
	var record adminUserAuthenticationRecord
	record.UserID = userID
	record.VerificationMethod = string(method)

	if err := tx.QueryRow(`
		SELECT u.username
		FROM system_users u
		JOIN restricted.users_restricted ur ON ur.id = u.id
		WHERE u.id = $1
		FOR UPDATE OF u, ur
	`, userID).Scan(&record.Username); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return record, errAdminAuthenticationUserNotFound
		}
		return record, err
	}

	var adminGroupID int64
	if err := tx.QueryRow(`SELECT id FROM system_user_groups WHERE name = 'admins'`).Scan(&adminGroupID); err != nil {
		return record, err
	}

	result, err := tx.Exec(`
		UPDATE system_users
		SET enabled = TRUE,
		    admin_access_allowed = TRUE,
		    updated = NOW()
		WHERE id = $1
	`, userID)
	if err != nil {
		return record, err
	}
	if affected, rowsErr := result.RowsAffected(); rowsErr != nil || affected != 1 {
		if rowsErr != nil {
			return record, rowsErr
		}
		return record, errAdminAuthenticationUserNotFound
	}

	if _, err = tx.Exec(`
		INSERT INTO system_user_group_memberships (
			user_id, group_id, created, updated, creation_spec
		)
		VALUES ($1, $2, NOW(), NOW(), $3)
		ON CONFLICT (user_id, group_id) DO UPDATE
		SET updated = NOW()
	`, userID, adminGroupID, "Administrator authentication provisioning API"); err != nil {
		return record, err
	}

	var fixedPINValue interface{}
	if method == verificationFixedPIN {
		fixedPINValue = fixedPINHash
	}
	result, err = tx.Exec(`
		UPDATE restricted.users_restricted
		SET login_verification_method = $1,
		    fixed_pin_hash = $2,
		    totp_secret = NULL
		WHERE id = $3
	`, string(method), fixedPINValue, userID)
	if err != nil {
		return record, err
	}
	if affected, rowsErr := result.RowsAffected(); rowsErr != nil || affected != 1 {
		if rowsErr != nil {
			return record, rowsErr
		}
		return record, errAdminAuthenticationUserNotFound
	}

	record.Enabled = true
	record.AdminGroupMember = true
	record.AdminAccessAllowed = true
	return record, nil
}
