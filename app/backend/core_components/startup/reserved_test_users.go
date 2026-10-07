// reserved_test_users.go
// Reconciles development-only reserved login fixtures during application startup.
// Bridges public user/group rows and restricted credential rows within one administrator transaction.
// Exists to keep E2E credentials deterministic in dev while purging them from production-like runtimes.
package startup

import (
	"context"
	"database/sql"
	"easelect/backend/core_components/auth/credentials"
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

var reservedTestUserFixtures = []reservedTestUserFixture{
	{
		username:           credentials.TestUserLoginName,
		fullName:           "Reserved Dev Test User",
		email:              "test_user@dev.invalid",
		groupName:          "users",
		passwordEnv:        "TEST_USER_PASS",
		adminAccessAllowed: false,
	},
	{
		username:           credentials.TestAdministratorLoginName,
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
func ReconcileReservedTestUsers(adminDB *sql.DB, environmentType string) error {
	if isReservedTestUserReconcileDisabled() {
		log.Printf("[STARTUP] Reserved test user reconciliation disabled by RESERVED_TEST_USERS")
		return nil
	}
	if adminDB == nil {
		return errors.New("administrator database handle is nil")
	}
	fixtures := reservedTestUserFixtures
	dev := isReservedTestUserDevMode(environmentType)
	if dev {
		var err error
		fixtures, err = reservedTestUserFixturesForDevelopment()
		if err != nil {
			return err
		}
	} else if hasConfiguredDevAdminEnvironment() {
		return fmt.Errorf("%s and %s are permitted only when ENVIRONMENT_TYPE=dev", configuredDevAdminUsernameEnv, configuredDevAdminPasswordEnv)
	}
	tx, err := adminDB.BeginTx(context.Background(), nil)
	if err != nil {
		return errors.New("begin reserved account reconciliation failed")
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`SELECT pg_advisory_xact_lock(hashtextextended('reserved account reconciliation',0))`); err != nil {
		return errors.New("lock reserved account reconciliation failed")
	}
	if err = reconcileReservedTestUsers(tx, fixtures, dev); err != nil {
		var orphan *reservedAccountOrphan
		if errors.As(err, &orphan) {
			return err
		}
		return errors.New("reserved account reconciliation failed; no changes committed")
	}
	if err = tx.Commit(); err != nil {
		return errors.New("commit reserved account reconciliation failed")
	}
	log.Printf("[STARTUP] Reserved test accounts reconciled: %s", reservedTestUsernamesForLog(fixtures))
	return nil
}

func reconcileReservedTestUsers(tx *sql.Tx, fixtures []reservedTestUserFixture, development bool) error {
	for _, fixture := range fixtures {
		if development {
			if err := ensureReservedTestUser(tx, fixture); err != nil {
				return err
			}
		} else if err := purgeReservedTestUser(tx, fixture.username); err != nil {
			return err
		}
	}
	return nil
}

type reservedAccountOrphan struct{ id int64 }

func (err *reservedAccountOrphan) Error() string {
	return fmt.Sprintf("reserved test account orphan: user id %d; repair through the account API before development start", err.id)
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
		if strings.EqualFold(fixture.username, username) {
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
		email:               "configured_administrator@dev.invalid",
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
	return credentials.ValidateReservedLoginName(value) == nil
}

func isReservedTestUserDevMode(environmentType string) bool {
	return strings.EqualFold(strings.TrimSpace(environmentType), "dev")
}

func isReservedTestUserReconcileDisabled() bool {
	value := strings.TrimSpace(os.Getenv("RESERVED_TEST_USERS"))
	return strings.EqualFold(value, "disabled") || strings.EqualFold(value, "off")
}

func reservedTestUsernamesForLog(fixtures []reservedTestUserFixture) string {
	return fmt.Sprintf("%d accounts", len(fixtures))
}

func ensureReservedTestUser(tx *sql.Tx, fixture reservedTestUserFixture) error {
	if err := credentials.ValidateReservedLoginName(fixture.username); err != nil {
		return err
	}
	groupID, err := lookupReservedTestUserGroupID(tx, fixture.groupName)
	if err != nil {
		return err
	}
	userID, existed, err := ensureReservedTestUserPublicRow(tx, fixture)
	if err != nil {
		return err
	}
	if err = replaceReservedTestUserMembership(tx, userID, groupID); err != nil {
		return err
	}
	return ensureReservedTestUserCredentials(tx, userID, fixture, existed)
}

func lookupReservedTestUserGroupID(tx *sql.Tx, groupName string) (int64, error) {
	var id int64
	err := tx.QueryRow(`SELECT id FROM system_user_groups WHERE name=$1`, groupName).Scan(&id)
	if err == nil && groupName == "admins" && id != 1 {
		return 0, errors.New("canonical administrator group missing")
	}
	return id, err
}

func ensureReservedTestUserPublicRow(tx *sql.Tx, fixture reservedTestUserFixture) (int64, bool, error) {
	var userID int64
	var displayName string
	err := tx.QueryRow(`SELECT u.id,u.username FROM system_users u
        JOIN restricted.users_restricted ur ON ur.id=u.id
        WHERE ur.login_name = $1 FOR UPDATE OF u,ur`, fixture.username).Scan(&userID, &displayName)
	existed := err == nil
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return 0, false, err
	}
	if !existed {
		// A former public reserved name without credentials is ambiguous. Never adopt it.
		var orphanID int64
		orphanErr := tx.QueryRow(`SELECT u.id FROM system_users u WHERE lower(u.username)=lower($1)
            AND NOT EXISTS(SELECT 1 FROM restricted.users_restricted ur WHERE ur.id=u.id)`, fixture.username).Scan(&orphanID)
		if orphanErr == nil {
			return 0, false, &reservedAccountOrphan{id: orphanID}
		}
		if !errors.Is(orphanErr, sql.ErrNoRows) {
			return 0, false, orphanErr
		}
		displayName = fixture.username
		var mayEqual bool
		if err = tx.QueryRow(`SELECT coalesce((SELECT boolean_value FROM system_config WHERE key='display_name_may_equal_login_name'),true)`).Scan(&mayEqual); err != nil {
			return 0, false, err
		}
		if fixture.adminAccessAllowed || !mayEqual {
			prefix := "user"
			if fixture.adminAccessAllowed {
				prefix = "admin"
			}
			displayName, err = credentials.NextAccountDisplayName(context.Background(), tx, prefix, fixture.username)
			if err != nil {
				return 0, false, err
			}
		}
		err = tx.QueryRow(`INSERT INTO system_users(username,full_name,created,updated,enabled,privileged,admin_access_allowed)
            VALUES($1,$2,NOW(),NOW(),true,false,$3) RETURNING id`, displayName, fixture.fullName, fixture.adminAccessAllowed).Scan(&userID)
		return userID, false, err
	}
	if fixture.adminAccessAllowed && strings.EqualFold(strings.TrimSpace(displayName), fixture.username) {
		displayName, err = credentials.NextAccountDisplayName(context.Background(), tx, "admin", fixture.username)
		if err != nil {
			return 0, false, err
		}
	}
	// Existing ordinary fixtures keep both names even when the policy has tightened.
	_, err = tx.Exec(`UPDATE system_users SET
        full_name=CASE WHEN username IS DISTINCT FROM $2 AND lower(btrim(full_name))=lower(btrim(username)) THEN $2 ELSE full_name END,
        search_vector_simple=CASE WHEN username IS DISTINCT FROM $2 THEN NULL ELSE search_vector_simple END,
        username=$2, enabled=true,privileged=false,admin_access_allowed=$3,updated=NOW()
        WHERE id=$1`, userID, displayName, fixture.adminAccessAllowed)
	return userID, true, err
}

func replaceReservedTestUserMembership(tx *sql.Tx, userID, groupID int64) error {
	if _, err := tx.Exec(`DELETE FROM system_user_group_memberships WHERE user_id=$1 AND group_id<>$2`, userID, groupID); err != nil {
		return err
	}
	_, err := tx.Exec(`INSERT INTO system_user_group_memberships(user_id,group_id,created,updated)
        VALUES($1,$2,NOW(),NOW()) ON CONFLICT(user_id,group_id) DO NOTHING`, userID, groupID)
	return err
}

func ensureReservedTestUserCredentials(tx *sql.Tx, userID int64, fixture reservedTestUserFixture, existed bool) error {
	if fixture.preserveCredentials && existed {
		return nil
	}
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(reservedTestPassword(fixture.passwordEnv)), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	method, pinHash := "none", ""
	if pin := strings.TrimSpace(os.Getenv("LOGIN_OTP_CODE")); isReservedTestFixedPIN(pin) {
		hashed, hashErr := bcrypt.GenerateFromPassword([]byte(pin), bcrypt.DefaultCost)
		if hashErr != nil {
			return hashErr
		}
		method, pinHash = "fixed_pin", string(hashed)
	}
	if existed {
		_, err = tx.Exec(`UPDATE restricted.users_restricted SET password=$1,email=$2,login_verification_method=$3,
            fixed_pin_hash=NULLIF($4,''),totp_secret=NULL WHERE id=$5`, string(passwordHash), fixture.email, method, pinHash, userID)
	} else {
		if err = credentials.ValidateReservedLoginName(fixture.username); err != nil {
			return err
		}
		_, err = tx.Exec(`INSERT INTO restricted.users_restricted(id,password,email,login_verification_method,fixed_pin_hash,login_name)
            VALUES($1,$2,$3,$4,NULLIF($5,''),$6)`, userID, string(passwordHash), fixture.email, method, pinHash, fixture.username)
	}
	return err
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

func purgeReservedTestUser(tx *sql.Tx, loginName string) error {
	var userID int64
	err := tx.QueryRow(`SELECT u.id FROM system_users u JOIN restricted.users_restricted ur ON ur.id=u.id
        WHERE ur.login_name = $1 FOR UPDATE OF u,ur`, loginName).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, query := range []string{
		`UPDATE system_users SET enabled=false,privileged=false,admin_access_allowed=false,updated=NOW() WHERE id=$1`,
		`DELETE FROM system_user_group_memberships WHERE user_id=$1`,
		`DELETE FROM restricted.verification_codes WHERE user_id=$1`,
		`DELETE FROM restricted.users_restricted WHERE id=$1`,
		`DELETE FROM system_users WHERE id=$1`,
	} {
		if _, err = tx.Exec(query, userID); err != nil {
			return err
		}
	}
	return nil
}
