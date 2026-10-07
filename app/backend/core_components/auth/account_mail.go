// account_mail.go
// Resolves authored account mail copy and reports post-commit delivery status.
// Bridges account mutations, fi/en language keys and the private mail transport.
// Exists so delivery failure never masquerades as a rolled-back account mutation.
package auth

import (
	"context"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/email"
)

var sendResetEmail = email.SendPasswordResetEmail

func accountMailText(ctx context.Context, key string) string {
	var text string
	// Prefer English for the common transport copy; keys also have reviewed Finnish translations.
	if backend.Db != nil {
		_ = backend.Db.QueryRowContext(ctx, `SELECT COALESCE(NULLIF(en,''),fi) FROM system_lang_keys WHERE lang_key=$1`, key).Scan(&text)
	}
	if text == "" {
		return key
	}
	return text
}

func accountNoticeStatus(ctx context.Context, address, loginName string, welcome bool) string {
	return email.SendAccountNotice(ctx, backend.Db, address, loginName, welcome)
}
