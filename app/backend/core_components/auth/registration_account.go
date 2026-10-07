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
)

func createRegisteredAccount(ctx context.Context, loginName, displayName, fullName, address, passwordHash, pinHash string, method loginVerificationMethod, enabled bool) (int, error) {
	if err := credentials.ValidateLoginName(loginName); err != nil {
		return 0, err
	}
	if strings.TrimSpace(displayName) == "" {
		return 0, &httpresponse.Refusal{Status: 400, LangKey: "username_empty", Message: "username_empty"}
	}
	if backend.DbAdmin == nil {
		return 0, errors.New("administrator database unavailable")
	}
	tx, err := backend.DbAdmin.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	for _, check := range []struct{ query, value, key string }{
		{`SELECT EXISTS(SELECT 1 FROM restricted.users_restricted WHERE lower(login_name)=lower($1))`, loginName, "login_name_exists"},
		{`SELECT EXISTS(SELECT 1 FROM system_users WHERE lower(username)=lower($1))`, displayName, "username_exists"},
		{`SELECT EXISTS(SELECT 1 FROM restricted.users_restricted WHERE lower(email)=lower($1))`, address, "email_exists"},
	} {
		var exists bool
		if err = tx.QueryRowContext(ctx, check.query, check.value).Scan(&exists); err != nil {
			return 0, err
		}
		if exists {
			return 0, &httpresponse.Refusal{Status: http.StatusConflict, LangKey: check.key, Message: check.key}
		}
	}
	var id int
	err = tx.QueryRowContext(ctx, `INSERT INTO system_users(username,full_name,created,updated,enabled,privileged) VALUES($1,$2,NOW(),NOW(),$3,false) RETURNING id`, displayName, fullName, enabled).Scan(&id)
	if err == nil {
		_, err = tx.ExecContext(ctx, `INSERT INTO restricted.users_restricted(id,password,email,login_name,login_verification_method,fixed_pin_hash) VALUES($1,$2,$3,$4,$5,NULLIF($6,''))`, id, passwordHash, address, loginName, string(method), pinHash)
	}
	if err == nil {
		var groupID int
		err = tx.QueryRowContext(ctx, `SELECT id FROM system_user_groups WHERE name='users'`).Scan(&groupID)
		if err == nil {
			_, err = tx.ExecContext(ctx, `INSERT INTO system_user_group_memberships(user_id,group_id,created,updated) VALUES($1,$2,NOW(),NOW())`, id, groupID)
		}
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		if refusal := httpresponse.AccountNameRefusal(err); refusal != nil {
			return 0, refusal
		}
		if errors.Is(err, sql.ErrNoRows) {
			return 0, errors.New("ordinary user group missing")
		}
		return 0, errors.New("account creation failed")
	}
	return id, nil
}
