// registration_account.go
// Creates a public profile, private credentials and ordinary membership in one transaction.
// Bridges validated registration forms with the administrator database pool.
// Exists so failures and simultaneous name reservations never leave a half account.
package auth

import (
	"context"
	"database/sql"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/auth/credentials"
	"easelect/backend/core_components/httpresponse"
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"
)

// Bound indexed values before lookup as well as INSERT. This leaves room for
// lower-case expansion and btree tuple overhead, preventing oversized index keys
// from refusing only new identities. Non-indexed full names have no size limit.
const maxRegistrationIdentityBytes = 1024

func createRegisteredAccount(ctx context.Context, loginName, displayName, fullName, address, passwordHash, pinHash string, method loginVerificationMethod, enabled bool) (int, error) {
	if err := credentials.ValidateLoginName(loginName); err != nil {
		return 0, err
	}
	if strings.TrimSpace(displayName) == "" {
		return 0, &httpresponse.Refusal{Status: 400, LangKey: "username_empty", Message: "username_empty"}
	}
	// PostgreSQL text rejects NUL and malformed UTF-8, including in non-indexed
	// fields that would otherwise be stored only after duplicate success.
	for _, value := range []string{loginName, displayName, fullName, address} {
		if !utf8.ValidString(value) || strings.ContainsRune(value, 0) {
			return 0, &httpresponse.Refusal{Status: http.StatusBadRequest, LangKey: "registration_failed", Message: "registration_failed"}
		}
	}
	for _, value := range []string{loginName, displayName, address} {
		if len(value) > maxRegistrationIdentityBytes {
			return 0, &httpresponse.Refusal{Status: http.StatusBadRequest, LangKey: "registration_failed", Message: "registration_failed"}
		}
	}
	if backend.DbAdmin == nil {
		return 0, errors.New("administrator database unavailable")
	}
	tx, err := backend.DbAdmin.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	// Validate the name pair before any identity lookup. Use the constraint's
	// exact lower(btrim(...)) semantics, including the missing/NULL default.
	// Keep the setting stable through duplicate lookup and account creation;
	// the database trigger remains the final guard for every account writer.
	var namesMayEqual, namesEqual bool
	err = tx.QueryRowContext(ctx, `SELECT COALESCE((SELECT boolean_value FROM system_config
		WHERE key='display_name_may_equal_login_name' FOR SHARE), true),
		lower(btrim($1::text)) = lower(btrim($2::text))`, loginName, displayName).Scan(&namesMayEqual, &namesEqual)
	if err != nil {
		return 0, err
	}
	if !namesMayEqual && namesEqual {
		return 0, &httpresponse.Refusal{Status: http.StatusConflict, LangKey: "error_user_display_name_equals_login_name", Message: "error_user_display_name_equals_login_name"}
	}
	// A missing ordinary group must fail for both existing and new identities.
	// Retain it until commit so a concurrent removal cannot bypass this check.
	var groupID int
	err = tx.QueryRowContext(ctx, `SELECT id FROM system_user_groups WHERE name='users' FOR SHARE`).Scan(&groupID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, errors.New("ordinary user group missing")
		}
		return 0, err
	}
	// Finish every lookup before concealing a duplicate; a failed later lookup
	// must not become success merely because an earlier identity already exists.
	duplicateKey := ""
	for _, check := range []struct{ query, value, key string }{
		{`SELECT EXISTS(SELECT 1 FROM restricted.users_restricted WHERE lower(login_name)=lower($1))`, loginName, "login_name_exists"},
		{`SELECT EXISTS(SELECT 1 FROM system_users WHERE lower(username)=lower($1))`, displayName, "username_exists"},
		{`SELECT EXISTS(SELECT 1 FROM restricted.users_restricted WHERE lower(email)=lower($1))`, address, "email_exists"},
	} {
		var exists bool
		if err = tx.QueryRowContext(ctx, check.query, check.value).Scan(&exists); err != nil {
			return 0, err
		}
		if exists && duplicateKey == "" {
			duplicateKey = check.key
		}
	}
	if duplicateKey != "" {
		return 0, &httpresponse.Refusal{Status: http.StatusConflict, LangKey: duplicateKey, Message: duplicateKey}
	}
	var id int
	err = tx.QueryRowContext(ctx, `INSERT INTO system_users(username,full_name,created,updated,enabled,privileged) VALUES($1,$2,NOW(),NOW(),$3,false) RETURNING id`, displayName, fullName, enabled).Scan(&id)
	if err == nil {
		_, err = tx.ExecContext(ctx, `INSERT INTO restricted.users_restricted(id,password,email,login_name,login_verification_method,fixed_pin_hash) VALUES($1,$2,$3,$4,$5,NULLIF($6,''))`, id, passwordHash, address, loginName, string(method), pinHash)
	}
	if err == nil {
		_, err = tx.ExecContext(ctx, `INSERT INTO system_user_group_memberships(user_id,group_id,created,updated) VALUES($1,$2,NOW(),NOW())`, id, groupID)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		if refusal := httpresponse.AccountNameRefusal(err); refusal != nil {
			return 0, refusal
		}
		return 0, errors.New("account creation failed")
	}
	return id, nil
}
