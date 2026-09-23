// administrator_creation_editor.go
// Creates one new administrator for an installation that has no usable administrator left.
// Bridges the operator recovery command with the shared administrator account definition and the audit log.
// Exists so the escape hatch for a rebuilt or restored site runs under the same gates as credential restore.
package credentials

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// FirstRunSetupConfigKey names the server-owned flag that keeps the one-time browser setup form open.
// It lives beside the shared administrator definition because every path that creates the first
// administrator — the browser form and the operator command — has to retire the same flag.
const FirstRunSetupConfigKey = "first_run"

// administratorCreationSpec records which supported workflow produced the account.
const administratorCreationSpec = "operator administrator creation command"

var (
	// ErrExistingAdministratorConfirmationRequired keeps administrator accounts from multiplying by habit.
	ErrExistingAdministratorConfirmationRequired = errors.New("creating another administrator while one already exists requires explicit confirmation")
	// ErrAdministratorCountChanged means the administrator population changed after the operator reviewed it.
	ErrAdministratorCountChanged = errors.New("the installation's administrator accounts changed during creation")
)

// AdministratorCreationInput carries the reviewed target, the confirmed secrets and the operator's decisions.
// It never carries an existing account identifier, because this workflow only ever adds an account.
type AdministratorCreationInput struct {
	Username                           string
	Email                              string
	NewPassword                        string
	VerificationMethod                 VerificationMethod
	FixedPIN                           string
	EmailDeliveryReady                 bool
	AllowPasswordOnly                  bool
	AcknowledgedExistingAdministrators bool
	ObservedAdministratorCount         int
	OperatorReference                  string
	TargetIdentity                     InstanceIdentity
}

// AdministratorCreationResult is non-secret evidence of the committed account.
type AdministratorCreationResult struct {
	UserID                    int64
	Username                  string
	Email                     string
	VerificationMethod        VerificationMethod
	AuthenticationGeneration  int64
	ExistingAdministrators    int
	ClosedFirstRunBrowserForm bool
}

// CreateAdministrator adds one login-ready administrator under the same target, factor and audit gates
// as credential restore. Account creation, the first-run form state and the audit entry share one
// transaction, so an unrecorded or half-built administrator can never reach the database.
func (editor *RecoveryEditor) CreateAdministrator(
	ctx context.Context,
	input AdministratorCreationInput,
) (AdministratorCreationResult, error) {
	var result AdministratorCreationResult
	if editor == nil || editor.db == nil {
		return result, errors.New("database is not initialized")
	}
	if err := validateAdministratorCreationTarget(input); err != nil {
		return result, err
	}
	method, err := validateAdministratorCreationFactor(input)
	if err != nil {
		return result, err
	}

	tx, err := editor.db.BeginTx(ctx, nil)
	if err != nil {
		return result, fmt.Errorf("begin administrator creation transaction: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	existingAdministrators, err := countEligibleAdministrators(ctx, tx)
	if err != nil {
		return result, err
	}
	if existingAdministrators != input.ObservedAdministratorCount {
		return result, ErrAdministratorCountChanged
	}
	if existingAdministrators > 0 && !input.AcknowledgedExistingAdministrators {
		return result, ErrExistingAdministratorConfirmationRequired
	}

	userID, err := CreateAdministratorAccount(ctx, tx, AdministratorAccountInput{
		Username:           input.Username,
		Email:              input.Email,
		Password:           input.NewPassword,
		VerificationMethod: method,
		FixedPIN:           input.FixedPIN,
		CreationSpec:       administratorCreationSpec,
	})
	if err != nil {
		return result, err
	}

	var authenticationGeneration int64
	if err = tx.QueryRowContext(ctx, `
		SELECT authentication_generation
		FROM restricted.users_restricted
		WHERE id = $1
	`, userID).Scan(&authenticationGeneration); err != nil {
		return result, fmt.Errorf("read the new administrator's authentication generation: %w", err)
	}
	if authenticationGeneration < 1 {
		return result, errors.New("invalid authentication generation after administrator creation")
	}

	closedFirstRunForm, err := closeFirstRunBrowserSetup(ctx, tx)
	if err != nil {
		return result, err
	}

	result = AdministratorCreationResult{
		UserID:                    userID,
		Username:                  strings.TrimSpace(input.Username),
		Email:                     strings.TrimSpace(input.Email),
		VerificationMethod:        method,
		AuthenticationGeneration:  authenticationGeneration,
		ExistingAdministrators:    existingAdministrators,
		ClosedFirstRunBrowserForm: closedFirstRunForm,
	}
	if err = writeAdministratorCreationAudit(ctx, tx, result, input); err != nil {
		return AdministratorCreationResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return AdministratorCreationResult{}, fmt.Errorf("commit administrator creation transaction: %w", err)
	}
	committed = true
	return result, nil
}

// validateAdministratorCreationTarget repeats the restore workflow's identity and version gates.
// An unidentified or too-old database must not receive a new administrator either.
func validateAdministratorCreationTarget(input AdministratorCreationInput) error {
	if strings.TrimSpace(input.TargetIdentity.DatabaseName) == "" ||
		strings.TrimSpace(input.TargetIdentity.SiteName) == "" ||
		strings.TrimSpace(input.TargetIdentity.CurrentProject) == "" {
		return ErrRecoveryContextRequired
	}
	if !DatabaseVersionAtLeast(input.TargetIdentity.DatabaseVersion, MinimumRecoveryDatabaseVersion) {
		return ErrRecoveryDatabaseVersionUnsupported
	}
	if strings.TrimSpace(input.OperatorReference) == "" {
		return errors.New("an operator reference is required for administrator creation evidence")
	}
	if err := ValidateAdministratorUsername(strings.TrimSpace(input.Username)); err != nil {
		return err
	}
	if err := ValidateAdministratorEmail(strings.TrimSpace(input.Email)); err != nil {
		return err
	}
	return ValidatePassword(input.NewPassword)
}

// validateAdministratorCreationFactor applies the restore workflow's readiness and downgrade gates.
// New TOTP enrollment stays outside this command, exactly as it does for credential restore.
func validateAdministratorCreationFactor(input AdministratorCreationInput) (VerificationMethod, error) {
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
		if !input.EmailDeliveryReady || !EmailAddressLooksDeliverable(input.Email) {
			return "", ErrEmailVerificationUnavailable
		}
	case VerificationNone:
		if !input.AllowPasswordOnly {
			return "", ErrPasswordOnlyConfirmationRequired
		}
	}
	return method, nil
}

// countEligibleAdministrators counts the same login-ready administrators the operator was shown.
// Counting inside the transaction is what makes the reviewed snapshot binding.
func countEligibleAdministrators(ctx context.Context, tx *sql.Tx) (int, error) {
	var existingAdministrators int
	err := tx.QueryRowContext(ctx, `SELECT COUNT(*)`+eligibleAdministratorSource).Scan(&existingAdministrators)
	if err != nil {
		return 0, fmt.Errorf("count eligible administrators: %w", err)
	}
	return existingAdministrators, nil
}

// closeFirstRunBrowserSetup retires the one-time public setup form once an administrator exists.
// Leaving it armed would let the form reopen later if this account were ever disabled.
func closeFirstRunBrowserSetup(ctx context.Context, tx *sql.Tx) (bool, error) {
	outcome, err := tx.ExecContext(ctx, `
		UPDATE system_config
		SET boolean_value = FALSE,
		    json_value = jsonb_set(COALESCE(json_value, '{}'::jsonb), '{value}', 'false'::jsonb, TRUE),
		    updated = NOW()
		WHERE key = $1 AND boolean_value IS TRUE
	`, FirstRunSetupConfigKey)
	if err != nil {
		return false, fmt.Errorf("close the first-run browser setup form: %w", err)
	}
	changedRows, err := outcome.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("read the first-run browser setup form result: %w", err)
	}
	return changedRows > 0, nil
}

// writeAdministratorCreationAudit records the target, the new account and the operator, and no secret.
// It stays inside the creation transaction so a missing audit entry prevents the account.
func writeAdministratorCreationAudit(
	ctx context.Context,
	tx *sql.Tx,
	result AdministratorCreationResult,
	input AdministratorCreationInput,
) error {
	details, err := json.Marshal(map[string]interface{}{
		"created_user_id":              result.UserID,
		"created_username":             result.Username,
		"created_email":                result.Email,
		"new_verification_method":      result.VerificationMethod,
		"new_generation":               result.AuthenticationGeneration,
		"existing_administrator_count": result.ExistingAdministrators,
		"closed_first_run_form":        result.ClosedFirstRunBrowserForm,
		"operator_reference":           strings.TrimSpace(input.OperatorReference),
		"site_name":                    input.TargetIdentity.SiteName,
		"current_project":              input.TargetIdentity.CurrentProject,
		"database_name":                input.TargetIdentity.DatabaseName,
		"instance_kind":                input.TargetIdentity.InstanceKind,
		"instance_role":                input.TargetIdentity.InstanceRole,
		"source":                       "interactive_cli",
	})
	if err != nil {
		return fmt.Errorf("build administrator creation audit details: %w", err)
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
			'operator://create-admin',
			'system_users',
			'auth',
			TRUE,
			$1::jsonb
		)
	`, string(details))
	if err != nil {
		return fmt.Errorf("write administrator creation audit: %w", err)
	}
	return nil
}
