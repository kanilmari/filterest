// login_name_change.go
// Validates private sign-in names and rotates the account's other sign-ins atomically.
// Bridges profile, administrator and operator callers through their own transaction.
// Exists so reserved accounts, uniqueness, audit evidence and generation changes share one rule.
package credentials

import (
	"database/sql"
	"easelect/backend/core_components/httpresponse"
	"errors"
	"net/http"
	"os"
	"regexp"
	"strings"
)

const AutomationLoginName = "filterest_agent"
const TestUserLoginName = "test_user"
const TestAdministratorLoginName = "test_admin"

var reservedLoginPattern = regexp.MustCompile(`(?i)^(admin|auto)_[0-9]+$`)

// ReservedLoginNames is also the source for startup's special-account fixtures.
func ReservedLoginNames() []string {
	names := []string{AutomationLoginName, TestUserLoginName, TestAdministratorLoginName}
	if strings.TrimSpace(os.Getenv("ENVIRONMENT_TYPE")) == "dev" {
		if name := strings.TrimSpace(os.Getenv("FILTEREST_DEV_ADMIN_USERNAME")); name != "" {
			names = append(names, name)
		}
	}
	return names
}

func IsReservedLoginName(name string) bool {
	for _, reserved := range ReservedLoginNames() {
		if strings.EqualFold(name, reserved) {
			return true
		}
	}
	return reservedLoginPattern.MatchString(name)
}

func nameRefusal(status int, key string) error {
	return &httpresponse.Refusal{Status: status, LangKey: key, Message: key}
}

// ValidateLoginName never includes the submitted value in its error.
func ValidateLoginName(name string) error {
	if len(name) < 3 || len(name) > 64 || !administratorUsernamePattern.MatchString(name) {
		return nameRefusal(http.StatusBadRequest, "login_name_invalid")
	}
	if IsReservedLoginName(name) {
		return nameRefusal(http.StatusConflict, "login_name_reserved")
	}
	return nil
}

// EndOtherSignIns increments the generation in the caller's transaction.
// An empty survivor ends every sign-in. Otherwise that sign-in can recover an old
// cookie written back by an in-flight request; the caller re-stamps after commit.
func EndOtherSignIns(tx *sql.Tx, userID int64, survivingSignInID string) (int64, error) {
	if tx == nil || userID <= 1 {
		return 0, ErrCredentialStateChanged
	}
	var generation int64
	err := tx.QueryRow(`UPDATE restricted.users_restricted
		SET authentication_generation = authentication_generation + 1,
		    surviving_sign_in_id = NULLIF($2, ''),
		    surviving_sign_in_generation = CASE WHEN NULLIF($2, '') IS NOT NULL
		        THEN authentication_generation + 1 ELSE NULL END
		WHERE id = $1 RETURNING authentication_generation`, userID, survivingSignInID).Scan(&generation)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrCredentialStateChanged
	}
	if err != nil {
		return 0, err
	}
	if _, err = tx.Exec(`DELETE FROM restricted.verification_codes WHERE user_id=$1`, userID); err != nil {
		return 0, err
	}
	return generation, nil
}

// ChangeLoginName does not commit and returns only non-secret generation evidence.
func ChangeLoginName(tx *sql.Tx, userID int64, newName, survivingSignInID string) (int64, error) {
	if tx == nil || userID <= 1 {
		return 0, ErrAdministratorNotFound
	}
	if err := ValidateLoginName(newName); err != nil {
		return 0, err
	}
	var oldName, creationSpec string
	var apiOnly bool
	// Public first: the name-protection triggers use the same lock order.
	err := tx.QueryRow(`SELECT ur.login_name, ur.api_only, COALESCE(u.creation_spec,'') FROM system_users u JOIN restricted.users_restricted ur ON ur.id=u.id WHERE u.id=$1 FOR UPDATE OF u,ur`, userID).Scan(&oldName, &apiOnly, &creationSpec)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nameRefusal(http.StatusNotFound, "user_not_found")
	}
	if err != nil {
		return 0, err
	}
	fixed := false
	for _, reserved := range ReservedLoginNames() {
		fixed = fixed || strings.EqualFold(oldName, reserved)
	}
	if apiOnly || creationSpec == "System manager API automation account" || fixed {
		return 0, nameRefusal(http.StatusConflict, "login_name_fixed")
	}
	var taken bool
	if err = tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM restricted.users_restricted WHERE lower(login_name)=lower($1) AND id<>$2)`, newName, userID).Scan(&taken); err != nil {
		return 0, err
	}
	if taken {
		return 0, nameRefusal(http.StatusConflict, "login_name_exists")
	}
	if _, err = tx.Exec(`UPDATE restricted.users_restricted SET login_name=$1 WHERE id=$2`, newName, userID); err != nil {
		if refusal := httpresponse.AccountNameRefusal(err); refusal != nil {
			return 0, refusal
		}
		return 0, errors.New("login-name update failed")
	}
	generation, err := EndOtherSignIns(tx, userID, survivingSignInID)
	if err != nil {
		return 0, err
	}
	if err = WriteAccountSecurityAudit(tx, userID, "login_name_change"); err != nil {
		return 0, err
	}
	return generation, nil
}

// WriteAccountSecurityAudit records only the id and the action, inside the mutation transaction.
func WriteAccountSecurityAudit(tx *sql.Tx, userID int64, action string) error {
	_, err := tx.Exec(`INSERT INTO system_audit_log(user_id,username,handler_name,http_method,url_path,table_name,operation_type,success,details) VALUES($1::bigint,NULL,'account.security','ACTION','account://security','system_users','auth',true,jsonb_build_object('target_user_id',$1::bigint,'action',$2::text))`, userID, action)
	return err
}
