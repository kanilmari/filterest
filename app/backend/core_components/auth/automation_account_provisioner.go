// automation_account_provisioner.go
// Provisions the one dedicated Filterest API automation administrator.
// Bridges a trusted system-manager request with public identity and restricted credentials.
// Exists so operators can bootstrap repeatable API access without self-registration or direct SQL.
package auth

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"easelect/backend/core_components/auth/credentials"

	"golang.org/x/crypto/bcrypt"
)

const (
	// AutomationAccountUsername is deliberately fixed so the system-manager
	// boundary cannot become a general-purpose public administrator creator.
	AutomationAccountUsername = "filterest_agent"
	automationAccountFullName = "Filterest API Automation Agent"
	automationAccountEmail    = "filterest_agent@automation.invalid"
	automationCreationSpec    = "System manager API automation account"
)

var (
	// ErrAutomationAccountConflict protects a pre-existing human or ambiguous
	// identity from being silently adopted as the automation administrator.
	ErrAutomationAccountConflict = errors.New("automation account identity conflicts with an existing user")
	// ErrAutomationAccountUnavailable means the database cannot expose the
	// account state required by the current Filterest credential contract.
	ErrAutomationAccountUnavailable = errors.New("automation account is unavailable")
)

// AutomationAccountRecord is non-secret readback evidence for one provisioned account.
type AutomationAccountRecord struct {
	Exists                   bool   `json:"exists"`
	Ready                    bool   `json:"ready"`
	Created                  bool   `json:"created,omitempty"`
	UserID                   int64  `json:"user_id,omitempty"`
	Username                 string `json:"username"`
	Enabled                  bool   `json:"enabled"`
	AdminGroupMember         bool   `json:"admin_group_member"`
	AdminAccessAllowed       bool   `json:"admin_access_allowed"`
	Privileged               bool   `json:"privileged"`
	VerificationMethod       string `json:"verification_method,omitempty"`
	AuthenticationGeneration int64  `json:"authentication_generation,omitempty"`
}

// AutomationAccountProvisioner owns validation, hashing, and the atomic account write.
type AutomationAccountProvisioner struct {
	db *sql.DB
}

// NewAutomationAccountProvisioner wires one privileged database connection into the bootstrap boundary.
// The connection must be able to mutate public users and restricted credentials in one transaction.
func NewAutomationAccountProvisioner(db *sql.DB) *AutomationAccountProvisioner {
	return &AutomationAccountProvisioner{db: db}
}

// Status returns only non-secret readiness state for the fixed automation identity.
func (provisioner *AutomationAccountProvisioner) Status(ctx context.Context) (AutomationAccountRecord, error) {
	record := AutomationAccountRecord{Username: AutomationAccountUsername}
	if provisioner == nil || provisioner.db == nil {
		return record, ErrAutomationAccountUnavailable
	}

	rows, err := provisioner.db.QueryContext(ctx, `
		SELECT u.id,
		       u.username,
		       COALESCE(u.enabled, FALSE),
		       COALESCE(u.admin_access_allowed, FALSE),
		       COALESCE(u.privileged, FALSE),
		       COALESCE(u.creation_spec, ''),
		       EXISTS (
		           SELECT 1
		           FROM system_user_group_memberships membership
		           JOIN system_user_groups user_group ON user_group.id = membership.group_id
		           WHERE membership.user_id = u.id
		             AND user_group.name = 'admins'
		       ),
		       COALESCE(credentials.login_verification_method, ''),
		       COALESCE(credentials.authentication_generation, 0)
		FROM system_users u
		LEFT JOIN restricted.users_restricted credentials ON credentials.id = u.id
		WHERE lower(u.username) = lower($1)
		ORDER BY u.id
	`, AutomationAccountUsername)
	if err != nil {
		return record, fmt.Errorf("read automation account status: %w", err)
	}
	defer rows.Close()

	var creationSpec string
	matchCount := 0
	for rows.Next() {
		matchCount++
		if matchCount > 1 {
			return record, ErrAutomationAccountConflict
		}
		if err = rows.Scan(
			&record.UserID,
			&record.Username,
			&record.Enabled,
			&record.AdminAccessAllowed,
			&record.Privileged,
			&creationSpec,
			&record.AdminGroupMember,
			&record.VerificationMethod,
			&record.AuthenticationGeneration,
		); err != nil {
			return record, fmt.Errorf("scan automation account status: %w", err)
		}
	}
	if err = rows.Err(); err != nil {
		return record, fmt.Errorf("iterate automation account status: %w", err)
	}
	if matchCount == 0 {
		return record, nil
	}
	if creationSpec != automationCreationSpec || record.Username != AutomationAccountUsername {
		return AutomationAccountRecord{Username: AutomationAccountUsername}, ErrAutomationAccountConflict
	}

	record.Exists = true
	record.Ready = record.Enabled && record.AdminGroupMember && record.AdminAccessAllowed &&
		!record.Privileged && record.VerificationMethod == string(credentials.VerificationNone) &&
		record.AuthenticationGeneration >= 1
	return record, nil
}

// Provision creates or rotates the fixed automation administrator in one transaction.
// Password hashes, group membership, account flags, session generation, and audit evidence
// commit together; callers receive only the resulting non-secret readiness record.
func (provisioner *AutomationAccountProvisioner) Provision(ctx context.Context, password string) (AutomationAccountRecord, error) {
	record := AutomationAccountRecord{Username: AutomationAccountUsername}
	if provisioner == nil || provisioner.db == nil {
		return record, ErrAutomationAccountUnavailable
	}
	if err := credentials.ValidatePassword(password); err != nil {
		return record, err
	}
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return record, fmt.Errorf("hash automation account password: %w", err)
	}

	tx, err := provisioner.db.BeginTx(ctx, nil)
	if err != nil {
		return record, fmt.Errorf("begin automation account transaction: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	userID, exists, err := lockAutomationAccountIdentity(ctx, tx)
	if err != nil {
		return record, err
	}
	adminGroupID, err := lookupAutomationAdminGroup(ctx, tx)
	if err != nil {
		return record, err
	}
	if exists {
		if err = updateAutomationPublicIdentity(ctx, tx, userID, adminGroupID); err != nil {
			return record, err
		}
	} else {
		userID, err = insertAutomationPublicIdentity(ctx, tx, adminGroupID)
		if err != nil {
			return record, err
		}
	}
	if err = replaceAutomationAccountMembership(ctx, tx, userID, adminGroupID); err != nil {
		return record, err
	}
	authenticationGeneration, err := replaceAutomationCredentials(ctx, tx, userID, string(passwordHash))
	if err != nil {
		return record, err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM restricted.verification_codes WHERE user_id = $1`, userID); err != nil {
		return record, fmt.Errorf("clear automation account verification codes: %w", err)
	}
	if err = writeAutomationAccountAudit(ctx, tx, userID, !exists, authenticationGeneration); err != nil {
		return record, err
	}
	if err = tx.Commit(); err != nil {
		return record, fmt.Errorf("commit automation account transaction: %w", err)
	}
	committed = true

	return AutomationAccountRecord{
		Exists:                   true,
		Ready:                    true,
		Created:                  !exists,
		UserID:                   userID,
		Username:                 AutomationAccountUsername,
		Enabled:                  true,
		AdminGroupMember:         true,
		AdminAccessAllowed:       true,
		Privileged:               false,
		VerificationMethod:       string(credentials.VerificationNone),
		AuthenticationGeneration: authenticationGeneration,
	}, nil
}

func lockAutomationAccountIdentity(ctx context.Context, tx *sql.Tx) (int64, bool, error) {
	// A row lock cannot serialize two first-time creates because no identity row
	// exists yet. The transaction-scoped advisory lock closes that race without
	// adding schema solely for this fixed system identity.
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, AutomationAccountUsername); err != nil {
		return 0, false, fmt.Errorf("lock automation account namespace: %w", err)
	}
	rows, err := tx.QueryContext(ctx, `
		SELECT id, username, COALESCE(creation_spec, '')
		FROM system_users
		WHERE lower(username) = lower($1)
		ORDER BY id
		FOR UPDATE
	`, AutomationAccountUsername)
	if err != nil {
		return 0, false, fmt.Errorf("lock automation account identity: %w", err)
	}
	defer rows.Close()

	var userID int64
	matchCount := 0
	for rows.Next() {
		var username string
		var creationSpec string
		matchCount++
		if matchCount > 1 {
			return 0, false, ErrAutomationAccountConflict
		}
		if err = rows.Scan(&userID, &username, &creationSpec); err != nil {
			return 0, false, fmt.Errorf("scan automation account identity: %w", err)
		}
		if username != AutomationAccountUsername || creationSpec != automationCreationSpec {
			return 0, false, ErrAutomationAccountConflict
		}
	}
	if err = rows.Err(); err != nil {
		return 0, false, fmt.Errorf("iterate automation account identity: %w", err)
	}
	return userID, matchCount == 1, nil
}

func lookupAutomationAdminGroup(ctx context.Context, tx *sql.Tx) (int64, error) {
	var groupID int64
	if err := tx.QueryRowContext(ctx, `SELECT id FROM system_user_groups WHERE name = 'admins'`).Scan(&groupID); err != nil {
		return 0, fmt.Errorf("lookup automation administrator group: %w", err)
	}
	return groupID, nil
}

func insertAutomationPublicIdentity(ctx context.Context, tx *sql.Tx, adminGroupID int64) (int64, error) {
	var userID int64
	err := tx.QueryRowContext(ctx, `
		INSERT INTO system_users (
			username, full_name, created, updated, enabled, privileged,
			main_group_id, creation_spec, admin_access_allowed
		)
		VALUES ($1, $2, NOW(), NOW(), TRUE, FALSE, $3, $4, TRUE)
		RETURNING id
	`, AutomationAccountUsername, automationAccountFullName, adminGroupID, automationCreationSpec).Scan(&userID)
	if err != nil {
		return 0, fmt.Errorf("insert automation public identity: %w", err)
	}
	return userID, nil
}

func updateAutomationPublicIdentity(ctx context.Context, tx *sql.Tx, userID, adminGroupID int64) error {
	result, err := tx.ExecContext(ctx, `
		UPDATE system_users
		SET username = $2,
		    full_name = $3,
		    enabled = TRUE,
		    privileged = FALSE,
		    main_group_id = $4,
		    admin_access_allowed = TRUE,
		    updated = NOW()
		WHERE id = $1
		  AND creation_spec = $5
	`, userID, AutomationAccountUsername, automationAccountFullName, adminGroupID, automationCreationSpec)
	if err != nil {
		return fmt.Errorf("update automation public identity: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("read automation public identity update: %w", err)
	}
	if affected != 1 {
		return ErrAutomationAccountConflict
	}
	return nil
}

func replaceAutomationAccountMembership(ctx context.Context, tx *sql.Tx, userID, adminGroupID int64) error {
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM system_user_group_memberships
		WHERE user_id = $1 AND group_id <> $2
	`, userID, adminGroupID); err != nil {
		return fmt.Errorf("remove stale automation account groups: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO system_user_group_memberships (user_id, group_id, created, updated, creation_spec)
		SELECT $1, $2, NOW(), NOW(), $3
		WHERE NOT EXISTS (
			SELECT 1 FROM system_user_group_memberships
			WHERE user_id = $1 AND group_id = $2
		)
	`, userID, adminGroupID, automationCreationSpec); err != nil {
		return fmt.Errorf("ensure automation administrator membership: %w", err)
	}
	return nil
}

func replaceAutomationCredentials(ctx context.Context, tx *sql.Tx, userID int64, passwordHash string) (int64, error) {
	var generation int64
	err := tx.QueryRowContext(ctx, `
		UPDATE restricted.users_restricted
		SET password = $2,
		    email = $3,
		    login_verification_method = $4,
		    fixed_pin_hash = NULL,
		    totp_secret = NULL,
		    authentication_generation = GREATEST(authentication_generation, 1) + 1
		WHERE id = $1
		RETURNING authentication_generation
	`, userID, passwordHash, automationAccountEmail, string(credentials.VerificationNone)).Scan(&generation)
	if err == nil {
		return generation, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return 0, fmt.Errorf("rotate automation restricted credentials: %w", err)
	}
	err = tx.QueryRowContext(ctx, `
		INSERT INTO restricted.users_restricted (
			id, password, email, login_verification_method,
			fixed_pin_hash, totp_secret, authentication_generation
		)
		VALUES ($1, $2, $3, $4, NULL, NULL, 1)
		RETURNING authentication_generation
	`, userID, passwordHash, automationAccountEmail, string(credentials.VerificationNone)).Scan(&generation)
	if err != nil {
		return 0, fmt.Errorf("insert automation restricted credentials: %w", err)
	}
	return generation, nil
}

func writeAutomationAccountAudit(ctx context.Context, tx *sql.Tx, userID int64, created bool, generation int64) error {
	action := "rotated"
	if created {
		action = "created"
	}
	details, err := json.Marshal(map[string]interface{}{
		"target_user_id":            userID,
		"target_username":           AutomationAccountUsername,
		"credential_action":         action,
		"authentication_generation": generation,
		"verification_method":       credentials.VerificationNone,
		"admin_group_member":        true,
		"admin_access_allowed":      true,
		"source":                    "system_manager_api",
	})
	if err != nil {
		return fmt.Errorf("build automation account audit: %w", err)
	}
	if strings.Contains(string(details), "password") {
		return errors.New("automation account audit contains a forbidden credential field")
	}
	if _, err = tx.ExecContext(ctx, `
		INSERT INTO system_audit_log (
			user_id, username, handler_name, http_method, url_path,
			table_name, operation_type, success, details
		)
		VALUES (
			NULL, NULL, 'router.systemAutomationAccountHandler', 'POST',
			'/system/automation-account', 'system_users', 'auth', TRUE, $1::jsonb
		)
	`, string(details)); err != nil {
		return fmt.Errorf("write automation account audit: %w", err)
	}
	return nil
}
