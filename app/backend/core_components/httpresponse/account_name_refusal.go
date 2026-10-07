// account_name_refusal.go
// Maps account-name database failures to translated, value-free refusals.
// Bridges every account writer and PostgreSQL's named constraints.
// Exists so a database detail containing a private name never reaches a response or log.
package httpresponse

import (
	"errors"
	"github.com/lib/pq"
	"net/http"
)

// AccountNameRefusal recognizes only the reviewed account-name constraints.
func AccountNameRefusal(err error) *Refusal {
	var refusal *Refusal
	if errors.As(err, &refusal) {
		return refusal
	}
	var databaseError *pq.Error
	if !errors.As(err, &databaseError) {
		return nil
	}
	key := ""
	switch {
	case databaseError.Code == "23514" && databaseError.Constraint == "administrator_names_differ":
		key = "error_admin_display_name_equals_login_name"
	case databaseError.Code == "23514" && databaseError.Constraint == "user_names_differ":
		key = "error_user_display_name_equals_login_name"
	case databaseError.Code == "23505" && (databaseError.Constraint == "uq_system_users_username_lower" || databaseError.Constraint == "system_users_username_key" || databaseError.Constraint == "unique_username"):
		key = "username_exists"
	case databaseError.Code == "23505" && databaseError.Constraint == "uq_users_restricted_login_name_lower":
		key = "login_name_exists"
	case databaseError.Code == "23505" && (databaseError.Constraint == "users_restricted_email_key" || databaseError.Constraint == "uq_users_restricted_email"):
		key = "email_exists"
	}
	if key == "" {
		return nil
	}
	return &Refusal{Status: http.StatusConflict, LangKey: key, Message: key}
}
