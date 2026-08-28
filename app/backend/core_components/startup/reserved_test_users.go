// reserved_test_users.go
// Reconciles development-only reserved login fixtures during application startup.
// Bridges public user/group rows and restricted credential rows across the two DB handles.
// Exists to keep E2E credentials deterministic in dev while purging them from production-like runtimes.
package startup

import (
	"database/sql"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

const reservedTestDefaultPassword = "TestPassword123!"

type reservedTestUserFixture struct {
	username           string
	fullName           string
	email              string
	groupName          string
	passwordEnv        string
	adminAccessAllowed bool
}

type reservedTestUserExecutor interface {
	QueryRow(query string, args ...interface{}) reservedTestUserRow
	Exec(query string, args ...interface{}) (sql.Result, error)
}

type reservedTestUserRow interface {
	Scan(dest ...interface{}) error
}

type reservedTestUserSQLExecutor struct {
	db *sql.DB
}

var reservedTestUserFixtures = []reservedTestUserFixture{
	{
		username:           "test_user",
		fullName:           "Reserved Dev Test User",
		email:              "test_user@dev.invalid",
		groupName:          "users",
		passwordEnv:        "TEST_USER_PASS",
		adminAccessAllowed: false,
	},
	{
		username:           "test_admin",
		fullName:           "Reserved Dev Test Admin",
		email:              "test_admin@dev.invalid",
		groupName:          "admins",
		passwordEnv:        "TEST_ADMIN_PASS",
		adminAccessAllowed: true,
	},
}

// ReconcileReservedTestUsers enforces the reserved test-user policy for the
// current runtime. Explicit dev mode creates/repairs fixtures; every other mode
// removes those reserved accounts before the app starts serving requests.
func ReconcileReservedTestUsers(publicDB *sql.DB, confidentialDB *sql.DB, environmentType string) error {
	if publicDB == nil {
		return fmt.Errorf("public database handle is nil")
	}
	if confidentialDB == nil {
		return fmt.Errorf("confidential database handle is nil")
	}

	publicStore := reservedTestUserSQLExecutor{db: publicDB}
	confidentialStore := reservedTestUserSQLExecutor{db: confidentialDB}
	return reconcileReservedTestUsers(publicStore, confidentialStore, environmentType)
}

func reconcileReservedTestUsers(publicStore, confidentialStore reservedTestUserExecutor, environmentType string) error {
	if isReservedTestUserReconcileDisabled() {
		log.Printf("[STARTUP] Reserved test user reconciliation disabled by RESERVED_TEST_USERS")
		return nil
	}

	if isReservedTestUserDevMode(environmentType) {
		for _, fixture := range reservedTestUserFixtures {
			if err := ensureReservedTestUser(publicStore, confidentialStore, fixture); err != nil {
				return fmt.Errorf("ensure reserved dev user %q: %w", fixture.username, err)
			}
		}
		log.Printf("[STARTUP] Reserved dev test users reconciled: %s", reservedTestUsernamesForLog())
		return nil
	}

	for _, fixture := range reservedTestUserFixtures {
		if err := purgeReservedTestUser(publicStore, confidentialStore, fixture.username); err != nil {
			return fmt.Errorf("purge reserved test user %q: %w", fixture.username, err)
		}
	}
	log.Printf("[STARTUP] Reserved test users purged for production-like environment: %s", reservedTestUsernamesForLog())
	return nil
}

func (e reservedTestUserSQLExecutor) QueryRow(query string, args ...interface{}) reservedTestUserRow {
	return e.db.QueryRow(query, args...)
}

func (e reservedTestUserSQLExecutor) Exec(query string, args ...interface{}) (sql.Result, error) {
	return e.db.Exec(query, args...)
}

func isReservedTestUserDevMode(environmentType string) bool {
	return strings.EqualFold(strings.TrimSpace(environmentType), "dev")
}

func isReservedTestUserReconcileDisabled() bool {
	value := strings.TrimSpace(os.Getenv("RESERVED_TEST_USERS"))
	return strings.EqualFold(value, "disabled") || strings.EqualFold(value, "off")
}

func reservedTestUsernamesForLog() string {
	names := make([]string, 0, len(reservedTestUserFixtures))
	for _, fixture := range reservedTestUserFixtures {
		names = append(names, fixture.username)
	}
	return strings.Join(names, ", ")
}

func ensureReservedTestUser(publicStore, confidentialStore reservedTestUserExecutor, fixture reservedTestUserFixture) error {
	groupID, err := lookupReservedTestUserGroupID(publicStore, fixture.groupName)
	if err != nil {
		return err
	}

	userID, err := ensureReservedTestUserPublicRow(publicStore, fixture)
	if err != nil {
		return err
	}

	if err := replaceReservedTestUserMembership(publicStore, userID, groupID); err != nil {
		return err
	}

	if err := ensureReservedTestUserCredentials(confidentialStore, userID, fixture); err != nil {
		return err
	}

	return nil
}

func lookupReservedTestUserGroupID(publicStore reservedTestUserExecutor, groupName string) (int64, error) {
	var groupID int64
	err := publicStore.QueryRow(
		`SELECT id FROM system_user_groups WHERE name = $1`,
		groupName,
	).Scan(&groupID)
	if err != nil {
		return 0, fmt.Errorf("lookup group %q: %w", groupName, err)
	}
	return groupID, nil
}

func ensureReservedTestUserPublicRow(publicStore reservedTestUserExecutor, fixture reservedTestUserFixture) (int64, error) {
	var userID int64
	err := publicStore.QueryRow(
		`SELECT id FROM system_users WHERE username = $1`,
		fixture.username,
	).Scan(&userID)
	if err == nil {
		_, err = publicStore.Exec(`
			UPDATE system_users
			SET full_name = $2,
			    enabled = true,
			    privileged = false,
			    admin_access_allowed = $3,
			    updated = NOW()
			WHERE id = $1
		`, userID, fixture.fullName, fixture.adminAccessAllowed)
		if err != nil {
			return 0, fmt.Errorf("update public user row: %w", err)
		}
		return userID, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return 0, fmt.Errorf("lookup public user row: %w", err)
	}

	err = publicStore.QueryRow(`
		INSERT INTO system_users (
			username,
			full_name,
			created,
			updated,
			enabled,
			privileged,
			admin_access_allowed
		)
		VALUES ($1, $2, NOW(), NOW(), true, false, $3)
		RETURNING id
	`, fixture.username, fixture.fullName, fixture.adminAccessAllowed).Scan(&userID)
	if err != nil {
		return 0, fmt.Errorf("insert public user row: %w", err)
	}
	return userID, nil
}

func replaceReservedTestUserMembership(publicStore reservedTestUserExecutor, userID int64, groupID int64) error {
	if _, err := publicStore.Exec(
		`DELETE FROM system_user_group_memberships WHERE user_id = $1 AND group_id <> $2`,
		userID,
		groupID,
	); err != nil {
		return fmt.Errorf("remove stale group memberships: %w", err)
	}

	if _, err := publicStore.Exec(`
		INSERT INTO system_user_group_memberships (user_id, group_id, created, updated)
		SELECT $1, $2, NOW(), NOW()
		WHERE NOT EXISTS (
			SELECT 1
			FROM system_user_group_memberships
			WHERE user_id = $1 AND group_id = $2
		)
	`, userID, groupID); err != nil {
		return fmt.Errorf("ensure group membership: %w", err)
	}
	return nil
}

func ensureReservedTestUserCredentials(confidentialStore reservedTestUserExecutor, userID int64, fixture reservedTestUserFixture) error {
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(reservedTestPassword(fixture.passwordEnv)), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash reserved test password: %w", err)
	}
	verificationMethod := "none"
	fixedPINHash := ""
	if fixedPIN := strings.TrimSpace(os.Getenv("LOGIN_OTP_CODE")); isReservedTestFixedPIN(fixedPIN) {
		hashedPIN, hashErr := bcrypt.GenerateFromPassword([]byte(fixedPIN), bcrypt.DefaultCost)
		if hashErr != nil {
			return fmt.Errorf("hash reserved test fixed PIN: %w", hashErr)
		}
		verificationMethod = "fixed_pin"
		fixedPINHash = string(hashedPIN)
	}

	result, err := confidentialStore.Exec(
		`UPDATE restricted.users_restricted
		 SET password = $1, email = $2, login_verification_method = $3,
		     fixed_pin_hash = NULLIF($4, ''), totp_secret = NULL
		 WHERE id = $5`,
		string(hashedPassword),
		fixture.email,
		verificationMethod,
		fixedPINHash,
		userID,
	)
	if err != nil {
		return fmt.Errorf("update restricted credentials: %w", err)
	}
	updatedRows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("read restricted credential update result: %w", err)
	}
	if updatedRows > 0 {
		return nil
	}

	if _, err := confidentialStore.Exec(
		`INSERT INTO restricted.users_restricted (
			id, password, email, login_verification_method, fixed_pin_hash
		) VALUES ($1, $2, $3, $4, NULLIF($5, ''))`,
		userID,
		string(hashedPassword),
		fixture.email,
		verificationMethod,
		fixedPINHash,
	); err != nil {
		return fmt.Errorf("insert restricted credentials: %w", err)
	}
	return nil
}

func isReservedTestFixedPIN(value string) bool {
	if len(value) < 4 || len(value) > 8 {
		return false
	}
	return strings.Trim(value, "0123456789") == ""
}

func reservedTestPassword(envName string) string {
	password := strings.TrimSpace(os.Getenv(envName))
	if password != "" {
		return password
	}
	return reservedTestDefaultPassword
}

func purgeReservedTestUser(publicStore, confidentialStore reservedTestUserExecutor, username string) error {
	var userID int64
	err := publicStore.QueryRow(
		`SELECT id FROM system_users WHERE username = $1`,
		username,
	).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("lookup public user row: %w", err)
	}

	if _, err = publicStore.Exec(`
		UPDATE system_users
		SET enabled = false,
		    privileged = false,
		    admin_access_allowed = false,
		    updated = NOW()
		WHERE id = $1
	`, userID); err != nil {
		return fmt.Errorf("disable public user row before purge: %w", err)
	}

	if _, err = publicStore.Exec(
		`DELETE FROM system_user_group_memberships WHERE user_id = $1`,
		userID,
	); err != nil {
		return fmt.Errorf("delete group memberships: %w", err)
	}

	if _, err = confidentialStore.Exec(
		`DELETE FROM restricted.users_restricted WHERE id = $1`,
		userID,
	); err != nil {
		return fmt.Errorf("delete restricted credentials: %w", err)
	}

	if _, err = publicStore.Exec(
		`DELETE FROM system_users WHERE id = $1`,
		userID,
	); err != nil {
		return fmt.Errorf("delete public user row: %w", err)
	}

	return nil
}
