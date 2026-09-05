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
	"net"
	"net/url"
	"os"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

const reservedTestDefaultPassword = "TestPassword123!"

type reservedTestUserFixture struct {
	username            string
	fullName            string
	email               string
	groupName           string
	passwordEnv         string
	adminAccessAllowed  bool
	preserveCredentials bool
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

const (
	configuredDevAdminUsernameEnv = "FILTEREST_DEV_ADMIN_USERNAME"
	configuredDevAdminPasswordEnv = "FILTEREST_DEV_ADMIN_PASSWORD"
)

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
		fixtures, err := reservedTestUserFixturesForDevelopment()
		if err != nil {
			return err
		}
		for _, fixture := range fixtures {
			if err := ensureReservedTestUser(publicStore, confidentialStore, fixture); err != nil {
				return fmt.Errorf("ensure reserved dev user %q: %w", fixture.username, err)
			}
		}
		log.Printf("[STARTUP] Reserved dev test users reconciled: %s", reservedTestUsernamesForLog(fixtures))
		return nil
	}

	// A named development administrator is intentionally a loopback-only
	// convenience. Refuse to start rather than silently ignore copied local
	// credentials in a production-like runtime.
	if hasConfiguredDevAdminEnvironment() {
		return fmt.Errorf("%s and %s are permitted only when ENVIRONMENT_TYPE=dev", configuredDevAdminUsernameEnv, configuredDevAdminPasswordEnv)
	}

	for _, fixture := range reservedTestUserFixtures {
		if err := purgeReservedTestUser(publicStore, confidentialStore, fixture.username); err != nil {
			return fmt.Errorf("purge reserved test user %q: %w", fixture.username, err)
		}
	}
	log.Printf("[STARTUP] Reserved test users purged for production-like environment: %s", reservedTestUsernamesForLog(reservedTestUserFixtures))
	return nil
}

func hasConfiguredDevAdminEnvironment() bool {
	return strings.TrimSpace(os.Getenv(configuredDevAdminUsernameEnv)) != "" ||
		strings.TrimSpace(os.Getenv(configuredDevAdminPasswordEnv)) != ""
}

// reservedTestUserFixturesForDevelopment adds one operator-named local admin
// only when both its username and protected password are explicitly configured.
// Existing credentials are preserved so assigning the admin group never resets
// a human's already working local password.
func reservedTestUserFixturesForDevelopment() ([]reservedTestUserFixture, error) {
	fixtures := append([]reservedTestUserFixture{}, reservedTestUserFixtures...)
	username := strings.TrimSpace(os.Getenv(configuredDevAdminUsernameEnv))
	if username == "" {
		return fixtures, nil
	}
	if !isValidConfiguredDevAdminUsername(username) {
		return nil, fmt.Errorf("%s must be 3-64 characters and use only letters, digits, dot, dash, or underscore", configuredDevAdminUsernameEnv)
	}
	for _, fixture := range fixtures {
		if fixture.username == username {
			return nil, fmt.Errorf("%s must differ from the built-in reserved test users", configuredDevAdminUsernameEnv)
		}
	}
	if strings.TrimSpace(os.Getenv(configuredDevAdminPasswordEnv)) == "" {
		return nil, fmt.Errorf("%s is required when %s is configured", configuredDevAdminPasswordEnv, configuredDevAdminUsernameEnv)
	}
	if !isLoopbackConfiguredDevAdminTarget(os.Getenv("BASE_URL")) {
		return nil, fmt.Errorf("%s is permitted only when BASE_URL is an HTTPS loopback origin", configuredDevAdminUsernameEnv)
	}
	fixtures = append(fixtures, reservedTestUserFixture{
		username:            username,
		fullName:            "Configured Dev Administrator",
		email:               username + "@dev.invalid",
		groupName:           "admins",
		passwordEnv:         configuredDevAdminPasswordEnv,
		adminAccessAllowed:  true,
		preserveCredentials: true,
	})
	return fixtures, nil
}

func isLoopbackConfiguredDevAdminTarget(rawBaseURL string) bool {
	parsed, err := url.Parse(strings.TrimSpace(rawBaseURL))
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil {
		return false
	}
	if parsed.Path != "" && parsed.Path != "/" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return false
	}
	hostname := strings.TrimSuffix(strings.ToLower(parsed.Hostname()), ".")
	if hostname == "localhost" || strings.HasSuffix(hostname, ".localhost") {
		return true
	}
	address := net.ParseIP(hostname)
	return address != nil && address.IsLoopback()
}

func isValidConfiguredDevAdminUsername(value string) bool {
	if len(value) < 3 || len(value) > 64 {
		return false
	}
	for index, character := range value {
		isLetter := character >= 'a' && character <= 'z' || character >= 'A' && character <= 'Z'
		isDigit := character >= '0' && character <= '9'
		if !isLetter && !isDigit && (index == 0 || character != '.' && character != '-' && character != '_') {
			return false
		}
	}
	return true
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

func reservedTestUsernamesForLog(fixtures []reservedTestUserFixture) string {
	names := make([]string, 0, len(fixtures))
	for _, fixture := range fixtures {
		names = append(names, fixture.username)
	}
	return strings.Join(names, ", ")
}

func ensureReservedTestUser(publicStore, confidentialStore reservedTestUserExecutor, fixture reservedTestUserFixture) error {
	groupID, err := lookupReservedTestUserGroupID(publicStore, fixture.groupName)
	if err != nil {
		return err
	}

	userID, existed, err := ensureReservedTestUserPublicRow(publicStore, fixture)
	if err != nil {
		return err
	}

	if err := replaceReservedTestUserMembership(publicStore, userID, groupID); err != nil {
		return err
	}

	if err := ensureReservedTestUserCredentials(confidentialStore, userID, fixture, existed); err != nil {
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

func ensureReservedTestUserPublicRow(publicStore reservedTestUserExecutor, fixture reservedTestUserFixture) (int64, bool, error) {
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
			return 0, false, fmt.Errorf("update public user row: %w", err)
		}
		return userID, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return 0, false, fmt.Errorf("lookup public user row: %w", err)
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
		return 0, false, fmt.Errorf("insert public user row: %w", err)
	}
	return userID, false, nil
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

func ensureReservedTestUserCredentials(confidentialStore reservedTestUserExecutor, userID int64, fixture reservedTestUserFixture, publicUserExisted bool) error {
	if fixture.preserveCredentials && publicUserExisted {
		var credentialUserID int64
		err := confidentialStore.QueryRow(
			`SELECT id FROM restricted.users_restricted WHERE id = $1`,
			userID,
		).Scan(&credentialUserID)
		if err == nil {
			return nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("inspect existing restricted credentials: %w", err)
		}
	}
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
