// administrator_account_creator.go
// Creates one login-ready administrator: public identity, admins membership and restricted credentials.
// Bridges the browser first-run form and the operator recovery command through one account definition.
// Exists so "what an administrator is" is decided once instead of drifting between creation paths.
package credentials

import (
	"context"
	"database/sql"
	"easelect/backend/core_components/httpresponse"
	"errors"
	"fmt"
	"net/mail"
	"regexp"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

// administratorUsernamePattern keeps trusted reserved system names within the shared ASCII shape.
// Ordinary administrator login names use ValidateLoginName instead of a parallel policy.
var administratorUsernamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]*$`)

var (
	// ErrInvalidAdministratorUsername means the requested account name is outside the shared name shape.
	ErrInvalidAdministratorUsername = errors.New("administrator username must contain 3-64 characters, start with a letter or digit, and continue with letters, digits, underscore, dot or hyphen")
	// ErrInvalidAdministratorEmail means the requested address is not exactly one valid mailbox.
	ErrInvalidAdministratorEmail = errors.New("administrator email must be exactly one valid address")
	// ErrAdministratorUsernameTaken protects an existing account from being adopted or overwritten.
	ErrAdministratorUsernameTaken = errors.New("administrator username is already in use")
	// ErrAdministratorEmailTaken protects an existing account's address from being reused.
	ErrAdministratorEmailTaken = errors.New("administrator email is already in use")
	// ErrAdministratorGroupMissing means this installation has no 'admins' group for the account to join.
	ErrAdministratorGroupMissing = errors.New("the 'admins' user group is missing from this installation")
)

// AdministratorAccountInput carries the private login name, public display name and its already-chosen secrets.
// This boundary owns the account shape, the shared credential policy and the stored form of each factor.
type AdministratorAccountInput struct {
	LoginName          string
	DisplayName        string
	FullName           string
	Email              string
	Password           string
	VerificationMethod VerificationMethod
	FixedPIN           string
	TOTPSecret         string
	CreationSpec       string
}

// ValidateAdministratorUsername delegates to the shared private login-name policy for administrators.
// Both the first-run browser form and the operator command reject a name this rejects.
func ValidateAdministratorUsername(username string) error {
	if err := ValidateLoginName(username); err != nil {
		if IsReservedLoginName(username) {
			return err
		}
		return ErrInvalidAdministratorUsername
	}
	return nil
}

// ValidateAdministratorEmail accepts exactly one syntactically valid mailbox with no display name.
// Deliverability is a separate decision, because only email verification depends on it.
func ValidateAdministratorEmail(email string) error {
	parsedAddress, err := mail.ParseAddress(email)
	if err != nil || !strings.EqualFold(parsedAddress.Address, email) {
		return ErrInvalidAdministratorEmail
	}
	return nil
}

// CreateAdministratorAccount writes the public user row, the admins membership and the restricted
// credentials of one new administrator inside the caller's transaction, so a half-built account is
// never committed. It refuses an existing account name or address and never updates an existing row.
func CreateAdministratorAccount(ctx context.Context, tx *sql.Tx, input AdministratorAccountInput) (int64, error) {
	if tx == nil {
		return 0, errors.New("administrator creation requires an open transaction")
	}
	loginName := strings.TrimSpace(input.LoginName)
	displayName := strings.TrimSpace(input.DisplayName)
	email := strings.TrimSpace(input.Email)
	if err := ValidateAdministratorUsername(loginName); err != nil {
		return 0, err
	}
	if err := ValidateAdministratorEmail(email); err != nil {
		return 0, err
	}
	if err := ValidatePassword(input.Password); err != nil {
		return 0, err
	}
	method, fixedPINHash, totpSecret, err := prepareAdministratorLoginFactor(input)
	if err != nil {
		return 0, err
	}
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
	if err != nil {
		return 0, fmt.Errorf("hash administrator password: %w", err)
	}

	fullName := strings.TrimSpace(input.FullName)
	if fullName == "" {
		fullName = displayName
	}
	creationSpec := strings.TrimSpace(input.CreationSpec)
	if creationSpec == "" {
		return 0, errors.New("administrator creation requires a creation specification")
	}

	if displayName == "" {
		displayName, err = NextAccountDisplayName(ctx, tx, "admin", loginName)
		if err != nil {
			return 0, err
		}
	}
	if strings.EqualFold(displayName, loginName) {
		return 0, nameRefusal(409, "error_admin_display_name_equals_login_name")
	}
	if fullName == "" {
		fullName = displayName
	}
	if err = refuseExistingAdministratorIdentity(ctx, tx, loginName, displayName, email); err != nil {
		return 0, err
	}

	var adminGroupID int64
	if err = tx.QueryRowContext(ctx,
		`SELECT id FROM system_user_groups WHERE id=1 AND name = 'admins'`,
	).Scan(&adminGroupID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, ErrAdministratorGroupMissing
		}
		return 0, fmt.Errorf("look up the administrator group: %w", err)
	}

	var userID int64
	if err = tx.QueryRowContext(ctx, `
		INSERT INTO system_users (
			username, full_name, created, updated, enabled, privileged,
			main_group_id, creation_spec, admin_access_allowed
		)
		VALUES ($1, $2, NOW(), NOW(), TRUE, FALSE, $3, $4, TRUE)
		RETURNING id
	`, displayName, fullName, adminGroupID, creationSpec).Scan(&userID); err != nil {
		if refusal := httpresponse.AccountNameRefusal(err); refusal != nil {
			return 0, refusal
		}
		return 0, errors.New("insert administrator identity failed")
	}

	if _, err = tx.ExecContext(ctx, `
		INSERT INTO system_user_group_memberships (user_id, group_id, created, updated, creation_spec)
		VALUES ($1, $2, NOW(), NOW(), $3)
	`, userID, adminGroupID, creationSpec); err != nil {
		return 0, fmt.Errorf("insert administrator group membership: %w", err)
	}

	if _, err = tx.ExecContext(ctx, `
		INSERT INTO restricted.users_restricted (
			id, password, email, login_verification_method, fixed_pin_hash, totp_secret, login_name
		)
		VALUES ($1, $2, $3, $4, NULLIF($5, ''), NULLIF($6, ''), $7)
	`, userID, string(passwordHash), email, string(method), fixedPINHash, totpSecret, loginName); err != nil {
		if refusal := httpresponse.AccountNameRefusal(err); refusal != nil {
			return 0, refusal
		}
		return 0, errors.New("insert administrator credentials failed")
	}
	return userID, nil
}

// prepareAdministratorLoginFactor validates the selected sign-in factor and returns its stored form.
// It keeps the persisted factor shape consistent with the restricted credentials table's own constraint.
func prepareAdministratorLoginFactor(input AdministratorAccountInput) (VerificationMethod, string, string, error) {
	method, err := ParseVerificationMethod(string(input.VerificationMethod))
	if err != nil {
		return "", "", "", err
	}
	switch method {
	case VerificationFixedPIN:
		if err = ValidateFixedPIN(input.FixedPIN); err != nil {
			return "", "", "", err
		}
		hash, hashErr := bcrypt.GenerateFromPassword([]byte(input.FixedPIN), bcrypt.DefaultCost)
		if hashErr != nil {
			return "", "", "", fmt.Errorf("hash administrator fixed PIN: %w", hashErr)
		}
		return method, string(hash), "", nil
	case VerificationTOTP:
		totpSecret := strings.TrimSpace(input.TOTPSecret)
		if totpSecret == "" {
			return "", "", "", ErrUnsupportedVerificationMethod
		}
		return method, "", totpSecret, nil
	default:
		if strings.TrimSpace(input.FixedPIN) != "" {
			return "", "", "", ErrInvalidFixedPIN
		}
		return method, "", "", nil
	}
}

// refuseExistingAdministratorIdentity fails closed on a name or address another account already holds.
// The comparison is case-insensitive so a near-duplicate cannot quietly shadow an existing operator.
func refuseExistingAdministratorIdentity(ctx context.Context, tx *sql.Tx, loginName, displayName, email string) error {
	for _, check := range []struct {
		query, value string
		refusal      error
	}{
		{`SELECT 1 FROM restricted.users_restricted WHERE lower(login_name)=lower($1) LIMIT 1`, loginName, ErrAdministratorUsernameTaken},
		{`SELECT 1 FROM system_users WHERE lower(username)=lower($1) LIMIT 1`, displayName, nameRefusal(409, "username_exists")},
		{`SELECT 1 FROM restricted.users_restricted WHERE lower(email)=lower($1) LIMIT 1`, email, ErrAdministratorEmailTaken},
	} {
		var existing int
		err := tx.QueryRowContext(ctx, check.query, check.value).Scan(&existing)
		if err == nil {
			return check.refusal
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("check administrator identity: %w", err)
		}
	}
	return nil
}
