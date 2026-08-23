// credential_recovery_editor.go
// Recovers an existing active administrator's password and login verification method.
// Bridges trusted operator workflows with public administrator identity and restricted credentials.
// Exists so CLI and future authenticated recovery callers share one atomic credential mutation.
package credentials

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

// VerificationMethod is the persisted second-step sign-in method.
type VerificationMethod string

const (
	VerificationNone               VerificationMethod = "none"
	VerificationFixedPIN           VerificationMethod = "fixed_pin"
	VerificationTOTP               VerificationMethod = "totp"
	VerificationEmail              VerificationMethod = "email"
	MinimumRecoveryDatabaseVersion                    = "9.6.2"

	minimumPasswordLength = 12
	maximumPasswordLength = 128
)

var (
	// ErrAdministratorNotFound means the target is not an active login-ready administrator.
	ErrAdministratorNotFound = errors.New("eligible administrator not found")
	// ErrInvalidPassword means the submitted password violates the shared administrator policy.
	ErrInvalidPassword = errors.New("password must contain 12-128 characters, at most 72 UTF-8 bytes, and no control characters")
	// ErrInvalidFixedPIN means the submitted fixed PIN is not 4-8 ASCII digits.
	ErrInvalidFixedPIN = errors.New("fixed PIN must contain 4-8 digits")
	// ErrUnsupportedVerificationMethod means recovery cannot safely provision the selected factor.
	ErrUnsupportedVerificationMethod = errors.New("unsupported login verification method")
	// ErrEmailVerificationUnavailable means email sign-in cannot deliver a verification code safely.
	ErrEmailVerificationUnavailable = errors.New("email verification is not delivery-ready for this account")
	// ErrPasswordOnlyConfirmationRequired protects against silently removing a second sign-in step.
	ErrPasswordOnlyConfirmationRequired = errors.New("password-only sign-in requires explicit confirmation")
	// ErrCredentialSnapshotConflict means factor state changed after the operator reviewed it.
	ErrCredentialSnapshotConflict = errors.New("administrator credential state changed during recovery")
	// ErrRecoveryContextRequired protects the audit trail from unidentified mutations.
	ErrRecoveryContextRequired = errors.New("database, site, and project recovery identity are required")
	// ErrRecoveryDatabaseVersionUnsupported prevents use before the session-generation schema exists.
	ErrRecoveryDatabaseVersionUnsupported = errors.New("database version does not support administrator credential recovery")
)

// Administrator exposes only non-secret recovery eligibility and factor state.
type Administrator struct {
	ID                       int64
	Username                 string
	VerificationMethod       VerificationMethod
	Email                    string
	AuthenticationGeneration int64
}

// InstanceIdentity is the database-owned target information shown before a recovery mutation.
type InstanceIdentity struct {
	DatabaseName    string
	DatabaseVersion string
	SiteName        string
	CurrentProject  string
	InstanceKind    string
	InstanceRole    string
}

// RecoveryInput contains already-confirmed secrets and operator safety decisions.
type RecoveryInput struct {
	UserID                           int64
	NewPassword                      string
	VerificationMethod               VerificationMethod
	FixedPIN                         string
	EmailDeliveryReady               bool
	AllowPasswordOnly                bool
	PreserveCurrentVerification      bool
	ExpectedAuthenticationGeneration int64
	ExpectedVerificationMethod       VerificationMethod
	TargetIdentity                   InstanceIdentity
}

// RecoveryResult is non-secret evidence of the committed credential change.
type RecoveryResult struct {
	UserID                   int64
	Username                 string
	VerificationMethod       VerificationMethod
	AuthenticationGeneration int64
}

// RecoveryEditor owns credential validation, hashing, and the one-transaction write boundary.
type RecoveryEditor struct {
	db *sql.DB
}

// NewRecoveryEditor wires one privileged database connection into the shared recovery boundary.
// The connection must be able to read public administrator state and update restricted credentials.
func NewRecoveryEditor(db *sql.DB) *RecoveryEditor {
	return &RecoveryEditor{db: db}
}

// ReadInstanceIdentity returns non-secret database-owned identity for operator confirmation.
func (editor *RecoveryEditor) ReadInstanceIdentity(ctx context.Context) (InstanceIdentity, error) {
	var identity InstanceIdentity
	if editor == nil || editor.db == nil {
		return identity, errors.New("database is not initialized")
	}

	err := editor.db.QueryRowContext(ctx, `
		SELECT current_database(),
		       COALESCE((SELECT version FROM system_db_version ORDER BY id DESC LIMIT 1), ''),
		       COALESCE((SELECT NULLIF(BTRIM(text_value), '') FROM system_config WHERE key = 'site_name' LIMIT 1), ''),
		       COALESCE((SELECT NULLIF(BTRIM(folder_name), '') FROM system_table_folders WHERE is_current_project IS TRUE LIMIT 1), ''),
		       COALESCE((SELECT NULLIF(BTRIM(text_value), '') FROM system_config WHERE key = 'instance_kind' LIMIT 1), ''),
		       COALESCE((SELECT NULLIF(BTRIM(text_value), '') FROM system_config WHERE key = 'easelect_instance_role' LIMIT 1), '')
	`).Scan(
		&identity.DatabaseName,
		&identity.DatabaseVersion,
		&identity.SiteName,
		&identity.CurrentProject,
		&identity.InstanceKind,
		&identity.InstanceRole,
	)
	if err != nil {
		return identity, fmt.Errorf("read recovery target identity: %w", err)
	}
	return identity, nil
}

// ListEligibleAdministrators returns only enabled administrators with restricted credentials.
// No password hash, PIN hash, TOTP secret, or other secret material crosses this boundary.
func (editor *RecoveryEditor) ListEligibleAdministrators(ctx context.Context) ([]Administrator, error) {
	if editor == nil || editor.db == nil {
		return nil, errors.New("database is not initialized")
	}

	rows, err := editor.db.QueryContext(ctx, `
		SELECT u.id,
		       u.username,
		       ur.login_verification_method,
		       ur.email,
		       ur.authentication_generation
		FROM system_users u
		JOIN restricted.users_restricted ur ON ur.id = u.id
		WHERE u.enabled IS TRUE
		  AND u.admin_access_allowed IS TRUE
		  AND EXISTS (
		      SELECT 1
		      FROM system_user_group_memberships membership
		      JOIN system_user_groups user_group ON user_group.id = membership.group_id
		      WHERE membership.user_id = u.id
		        AND user_group.name = 'admins'
		  )
		ORDER BY LOWER(u.username), u.id
	`)
	if err != nil {
		return nil, fmt.Errorf("list eligible administrators: %w", err)
	}
	defer rows.Close()

	administrators := make([]Administrator, 0)
	for rows.Next() {
		var administrator Administrator
		var rawMethod string
		if err = rows.Scan(
			&administrator.ID,
			&administrator.Username,
			&rawMethod,
			&administrator.Email,
			&administrator.AuthenticationGeneration,
		); err != nil {
			return nil, fmt.Errorf("scan eligible administrator: %w", err)
		}
		administrator.VerificationMethod, err = ParseVerificationMethod(rawMethod)
		if err != nil {
			return nil, fmt.Errorf("administrator %d has invalid verification state: %w", administrator.ID, err)
		}
		administrators = append(administrators, administrator)
	}
	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate eligible administrators: %w", err)
	}
	return administrators, nil
}

// RecoverAdministrator validates and hashes new credential material before changing one active admin.
// Password and factor state are locked, rechecked, and updated in the same database transaction.
func (editor *RecoveryEditor) RecoverAdministrator(ctx context.Context, input RecoveryInput) (RecoveryResult, error) {
	var result RecoveryResult
	if editor == nil || editor.db == nil {
		return result, errors.New("database is not initialized")
	}
	if input.UserID <= 1 {
		return result, ErrAdministratorNotFound
	}
	if input.ExpectedAuthenticationGeneration < 1 {
		return result, ErrCredentialSnapshotConflict
	}
	if _, err := ParseVerificationMethod(string(input.ExpectedVerificationMethod)); err != nil {
		return result, ErrCredentialSnapshotConflict
	}
	if strings.TrimSpace(input.TargetIdentity.DatabaseName) == "" ||
		strings.TrimSpace(input.TargetIdentity.SiteName) == "" ||
		strings.TrimSpace(input.TargetIdentity.CurrentProject) == "" {
		return result, ErrRecoveryContextRequired
	}
	if !DatabaseVersionAtLeast(input.TargetIdentity.DatabaseVersion, MinimumRecoveryDatabaseVersion) {
		return result, ErrRecoveryDatabaseVersionUnsupported
	}
	if err := ValidatePassword(input.NewPassword); err != nil {
		return result, err
	}

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(input.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		return result, fmt.Errorf("hash recovery password: %w", err)
	}

	var fixedPINHash string
	if !input.PreserveCurrentVerification && input.VerificationMethod == VerificationFixedPIN {
		if err = ValidateFixedPIN(input.FixedPIN); err != nil {
			return result, err
		}
		hash, hashErr := bcrypt.GenerateFromPassword([]byte(input.FixedPIN), bcrypt.DefaultCost)
		if hashErr != nil {
			return result, fmt.Errorf("hash recovery fixed PIN: %w", hashErr)
		}
		fixedPINHash = string(hash)
	}

	tx, err := editor.db.BeginTx(ctx, nil)
	if err != nil {
		return result, fmt.Errorf("begin credential recovery transaction: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	administrator, err := lockEligibleAdministrator(ctx, tx, input.UserID)
	if err != nil {
		return result, err
	}
	if administrator.AuthenticationGeneration != input.ExpectedAuthenticationGeneration ||
		administrator.VerificationMethod != input.ExpectedVerificationMethod {
		return result, ErrCredentialSnapshotConflict
	}
	selectedMethod, err := validateRecoveryFactorChoice(input, administrator)
	if err != nil {
		return result, err
	}

	newAuthenticationGeneration, err := updateRestrictedCredentials(
		ctx,
		tx,
		input.UserID,
		string(passwordHash),
		selectedMethod,
		fixedPINHash,
		input.PreserveCurrentVerification,
	)
	if err != nil {
		return result, err
	}
	if err = deletePendingVerificationCodes(ctx, tx, input.UserID); err != nil {
		return result, err
	}
	if err = writeRecoveryAudit(
		ctx,
		tx,
		administrator,
		selectedMethod,
		newAuthenticationGeneration,
		input.TargetIdentity,
	); err != nil {
		return result, err
	}

	if err = tx.Commit(); err != nil {
		return result, fmt.Errorf("commit credential recovery transaction: %w", err)
	}
	committed = true

	return RecoveryResult{
		UserID:                   administrator.ID,
		Username:                 administrator.Username,
		VerificationMethod:       selectedMethod,
		AuthenticationGeneration: newAuthenticationGeneration,
	}, nil
}

// writeRecoveryAudit records only the target identity, factor transition, and generation transition.
// It stays inside the credential transaction so missing audit evidence prevents the security change.
func writeRecoveryAudit(
	ctx context.Context,
	tx *sql.Tx,
	administrator Administrator,
	newVerificationMethod VerificationMethod,
	authenticationGeneration int64,
	targetIdentity InstanceIdentity,
) error {
	details, err := json.Marshal(map[string]interface{}{
		"target_user_id":               administrator.ID,
		"target_username":              administrator.Username,
		"previous_verification_method": administrator.VerificationMethod,
		"new_verification_method":      newVerificationMethod,
		"old_generation":               administrator.AuthenticationGeneration,
		"new_generation":               authenticationGeneration,
		"site_name":                    targetIdentity.SiteName,
		"current_project":              targetIdentity.CurrentProject,
		"database_name":                targetIdentity.DatabaseName,
		"instance_kind":                targetIdentity.InstanceKind,
		"instance_role":                targetIdentity.InstanceRole,
		"source":                       "interactive_cli",
	})
	if err != nil {
		return fmt.Errorf("build credential recovery audit details: %w", err)
	}

	_, err = tx.ExecContext(ctx, `
		INSERT INTO system_audit_log (
			user_id,
			username,
			handler_name,
			http_method,
			url_path,
			table_name,
			operation_type,
			success,
			details
		)
		VALUES (
			NULL,
			NULL,
			'operator.admin_credential_recovery',
			'CLI',
			'operator://recover-admin',
			'system_users',
			'auth',
			TRUE,
			$1::jsonb
		)
	`, string(details))
	if err != nil {
		return fmt.Errorf("write credential recovery audit: %w", err)
	}
	return nil
}

// lockEligibleAdministrator rechecks eligibility and captures the authoritative factor snapshot.
// The row lock prevents the selected account from changing underneath the recovery transaction.
func lockEligibleAdministrator(ctx context.Context, tx *sql.Tx, userID int64) (Administrator, error) {
	var administrator Administrator
	var rawMethod string
	err := tx.QueryRowContext(ctx, `
		SELECT u.id,
		       u.username,
		       ur.login_verification_method,
		       ur.email,
		       ur.authentication_generation
		FROM system_users u
		JOIN restricted.users_restricted ur ON ur.id = u.id
		WHERE u.id = $1
		  AND u.enabled IS TRUE
		  AND u.admin_access_allowed IS TRUE
		  AND EXISTS (
		      SELECT 1
		      FROM system_user_group_memberships membership
		      JOIN system_user_groups user_group ON user_group.id = membership.group_id
		      WHERE membership.user_id = u.id
		        AND user_group.name = 'admins'
		  )
		FOR UPDATE OF u, ur
	`, userID).Scan(
		&administrator.ID,
		&administrator.Username,
		&rawMethod,
		&administrator.Email,
		&administrator.AuthenticationGeneration,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return administrator, ErrAdministratorNotFound
	}
	if err != nil {
		return administrator, fmt.Errorf("lock eligible administrator: %w", err)
	}
	administrator.VerificationMethod, err = ParseVerificationMethod(rawMethod)
	if err != nil {
		return administrator, fmt.Errorf("administrator %d has invalid verification state: %w", userID, err)
	}
	return administrator, nil
}

// validateRecoveryFactorChoice enforces readiness and downgrade gates against locked account state.
// Preserve is a factor choice too, so it cannot bypass email or password-only protections.
func validateRecoveryFactorChoice(input RecoveryInput, administrator Administrator) (VerificationMethod, error) {
	if input.PreserveCurrentVerification {
		if strings.TrimSpace(input.FixedPIN) != "" {
			return "", ErrInvalidFixedPIN
		}
		switch administrator.VerificationMethod {
		case VerificationEmail:
			if !input.EmailDeliveryReady || !EmailAddressLooksDeliverable(administrator.Email) {
				return "", ErrEmailVerificationUnavailable
			}
		case VerificationNone:
			if !input.AllowPasswordOnly {
				return "", ErrPasswordOnlyConfirmationRequired
			}
		case VerificationFixedPIN, VerificationTOTP:
		default:
			return "", ErrUnsupportedVerificationMethod
		}
		return administrator.VerificationMethod, nil
	}

	method, err := ParseVerificationMethod(string(input.VerificationMethod))
	if err != nil || method == VerificationTOTP {
		return "", ErrUnsupportedVerificationMethod
	}
	switch method {
	case VerificationFixedPIN:
		if err = ValidateFixedPIN(input.FixedPIN); err != nil {
			return "", err
		}
	case VerificationEmail:
		if !input.EmailDeliveryReady || !EmailAddressLooksDeliverable(administrator.Email) {
			return "", ErrEmailVerificationUnavailable
		}
	case VerificationNone:
		if !input.AllowPasswordOnly {
			return "", ErrPasswordOnlyConfirmationRequired
		}
	}
	return method, nil
}

// deletePendingVerificationCodes removes every still-stored challenge after credentials rotate.
// Successfully consumed challenges are already deleted by OTP verification, so remaining rows are pending or expired.
func deletePendingVerificationCodes(ctx context.Context, tx *sql.Tx, userID int64) error {
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM restricted.verification_codes
		WHERE user_id = $1
		  AND used IS FALSE
	`, userID); err != nil {
		return fmt.Errorf("delete pending administrator verification codes: %w", err)
	}
	return nil
}

// updateRestrictedCredentials changes password/factor state and increments session generation together.
// Returning the new generation supplies both audit evidence and immediate operator readback.
func updateRestrictedCredentials(
	ctx context.Context,
	tx *sql.Tx,
	userID int64,
	passwordHash string,
	method VerificationMethod,
	fixedPINHash string,
	preserveCurrentVerification bool,
) (int64, error) {
	var newAuthenticationGeneration int64
	var err error
	if preserveCurrentVerification {
		err = tx.QueryRowContext(ctx, `
			UPDATE restricted.users_restricted
			SET password = $1,
			    authentication_generation = authentication_generation + 1
			WHERE id = $2
			RETURNING authentication_generation
		`, passwordHash, userID).Scan(&newAuthenticationGeneration)
	} else {
		var fixedPINValue interface{}
		if method == VerificationFixedPIN {
			fixedPINValue = fixedPINHash
		}
		err = tx.QueryRowContext(ctx, `
			UPDATE restricted.users_restricted
			SET password = $1,
			    login_verification_method = $2,
			    fixed_pin_hash = $3,
			    totp_secret = NULL,
			    authentication_generation = authentication_generation + 1
			WHERE id = $4
			RETURNING authentication_generation
		`, passwordHash, string(method), fixedPINValue, userID).Scan(&newAuthenticationGeneration)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrAdministratorNotFound
	}
	if err != nil {
		return 0, fmt.Errorf("update restricted administrator credentials: %w", err)
	}
	if newAuthenticationGeneration < 2 {
		return 0, errors.New("invalid authentication generation returned after credential recovery")
	}
	return newAuthenticationGeneration, nil
}
