// administrator_creation_cluster_test.go
// Verifies operator administrator creation against a disposable cluster carrying the real bootstrap.
// Bridges Filterest's own public schema and seed with the shared administrator creation boundary.
// Exists so "the new account can actually administer the site" is proven rather than assumed.
package credentials

import (
	"context"
	"database/sql"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"easelect/backend/core_components/permissions"

	_ "github.com/lib/pq"
	"golang.org/x/crypto/bcrypt"
)

const (
	disposablePostgresBinDir = "/usr/lib/postgresql/16/bin/"
	createdAdministratorName = "recovery_operator_admin"
	createdAdministratorMail = "recovery.operator@example.com"
	createdAdministratorWord = "correct horse battery staple"
	createdAdministratorPIN  = "246810"
	testSiteName             = "Example Workspace"
)

// administratorCreationCluster boots an isolated PostgreSQL cluster holding Filterest's own public
// bootstrap schema and seed, so group membership, permissions and account constraints are the real ones.
func administratorCreationCluster(t *testing.T) *sql.DB {
	t.Helper()
	if os.Getenv("FILTEREST_TEST_DISPOSABLE_POSTGRES") != "1" {
		t.Skip("set FILTEREST_TEST_DISPOSABLE_POSTGRES=1 to run isolated PostgreSQL verification")
	}

	root := t.TempDir()
	socket := filepath.Join(root, "socket")
	if err := os.Mkdir(socket, 0o700); err != nil {
		t.Fatal(err)
	}
	data := filepath.Join(root, "db")
	run := func(name string, args ...string) {
		t.Helper()
		if output, err := exec.Command(disposablePostgresBinDir+name, args...).CombinedOutput(); err != nil {
			t.Fatalf("%s: %v: %s", name, err, output)
		}
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("find an unused port: %v", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	if err = listener.Close(); err != nil {
		t.Fatalf("release the port: %v", err)
	}

	run("initdb", "-D", data, "-A", "trust", "-U", "test_owner", "--no-locale", "--encoding=UTF8")
	t.Cleanup(func() {
		_, _ = exec.Command(disposablePostgresBinDir+"pg_ctl", "-D", data, "-m", "immediate", "-w", "stop").CombinedOutput()
	})
	run("pg_ctl", "-D", data, "-l", filepath.Join(root, "postgres.log"),
		"-o", fmt.Sprintf("-h '' -k '%s' -p %d", socket, port), "-w", "start")
	run("psql", "-h", socket, "-p", fmt.Sprint(port), "-U", "test_owner", "-d", "postgres",
		"-v", "ON_ERROR_STOP=1", "-q", "-c", "CREATE DATABASE filterest")

	bootstrapRoot := filepath.Join("..", "..", "..", "..", "server_tools", "public_bootstrap")
	for _, bootstrapFile := range []string{"schema.sql", "seed_data.sql"} {
		run("psql", "-h", socket, "-p", fmt.Sprint(port), "-U", "test_owner", "-d", "filterest",
			"-v", "ON_ERROR_STOP=1", "-q", "-f", filepath.Join(bootstrapRoot, bootstrapFile))
	}

	db, err := sql.Open("postgres",
		fmt.Sprintf("host=%s port=%d user=test_owner dbname=filterest sslmode=disable", socket, port))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	// A restored or rebuilt site already carries its own name; a brand new bootstrap does not.
	// The creation workflow refuses an unnamed target, so the fixture names the site like a real install.
	if _, err = db.Exec(
		`UPDATE system_config SET text_value = $1 WHERE key = 'site_name'`, testSiteName,
	); err != nil {
		t.Fatalf("name the test site: %v", err)
	}
	return db
}

// newAdministratorCreationInput builds one complete, valid request for the account under test.
func newAdministratorCreationInput(t *testing.T, editor *RecoveryEditor, username, email string) AdministratorCreationInput {
	t.Helper()
	identity, err := editor.ReadInstanceIdentity(context.Background())
	if err != nil {
		t.Fatalf("ReadInstanceIdentity() error = %v", err)
	}
	return AdministratorCreationInput{
		Username:           username,
		Email:              email,
		NewPassword:        createdAdministratorWord,
		VerificationMethod: VerificationFixedPIN,
		FixedPIN:           createdAdministratorPIN,
		OperatorReference:  "test_owner@disposable-cluster (pid 1)",
		TargetIdentity:     identity,
	}
}

func countAdministratorAccounts(t *testing.T, db *sql.DB) int {
	t.Helper()
	var accounts int
	if err := db.QueryRow(`SELECT COUNT(*) FROM system_users`).Scan(&accounts); err != nil {
		t.Fatalf("count accounts: %v", err)
	}
	return accounts
}

func TestCreateAdministratorWritesTheSameAccountShapeAsFirstRunPostgres(t *testing.T) {
	db := administratorCreationCluster(t)
	editor := NewRecoveryEditor(db)

	result, err := editor.CreateAdministrator(
		context.Background(),
		newAdministratorCreationInput(t, editor, createdAdministratorName, createdAdministratorMail),
	)
	if err != nil {
		t.Fatalf("CreateAdministrator() error = %v", err)
	}
	if result.UserID <= 1 || result.AuthenticationGeneration != 1 {
		t.Fatalf("creation result = %+v, want a real user id and the first authentication generation", result)
	}
	if !result.ClosedFirstRunBrowserForm {
		t.Fatal("the one-time browser setup form was left open after an administrator was created")
	}

	var (
		username, fullName, creationSpec string
		enabled, privileged, adminAccess bool
		mainGroupID, adminGroupID        int64
		adminGroupMember                 bool
	)
	if err = db.QueryRow(`
		SELECT u.username, u.full_name, u.creation_spec, u.enabled, u.privileged,
		       u.admin_access_allowed, u.main_group_id,
		       (SELECT id FROM system_user_groups WHERE name = 'admins'),
		       EXISTS (
		           SELECT 1 FROM system_user_group_memberships membership
		           JOIN system_user_groups g ON g.id = membership.group_id
		           WHERE membership.user_id = u.id AND g.name = 'admins'
		       )
		FROM system_users u WHERE u.id = $1
	`, result.UserID).Scan(
		&username, &fullName, &creationSpec, &enabled, &privileged,
		&adminAccess, &mainGroupID, &adminGroupID, &adminGroupMember,
	); err != nil {
		t.Fatalf("read the created account: %v", err)
	}
	if username != createdAdministratorName || fullName != createdAdministratorName {
		t.Fatalf("account name/full name = %q/%q", username, fullName)
	}
	if !enabled || privileged || !adminAccess || !adminGroupMember || mainGroupID != adminGroupID {
		t.Fatalf("account fields = enabled:%t privileged:%t admin_access:%t admins_member:%t main_group:%d/%d",
			enabled, privileged, adminAccess, adminGroupMember, mainGroupID, adminGroupID)
	}
	if strings.TrimSpace(creationSpec) == "" {
		t.Fatal("the created account carries no creation specification")
	}

	administrators, err := editor.ListEligibleAdministrators(context.Background())
	if err != nil {
		t.Fatalf("ListEligibleAdministrators() error = %v", err)
	}
	if len(administrators) != 1 || administrators[0].ID != result.UserID {
		t.Fatalf("eligible administrators = %+v, want only the created account", administrators)
	}
}

func TestCreatedAdministratorAuthenticatesAndHoldsAdministratorRightsPostgres(t *testing.T) {
	db := administratorCreationCluster(t)
	editor := NewRecoveryEditor(db)

	result, err := editor.CreateAdministrator(
		context.Background(),
		newAdministratorCreationInput(t, editor, createdAdministratorName, createdAdministratorMail),
	)
	if err != nil {
		t.Fatalf("CreateAdministrator() error = %v", err)
	}

	var passwordHash, pinHash, email, method string
	var generation int64
	if err = db.QueryRow(`
		SELECT password, COALESCE(fixed_pin_hash, ''), email, login_verification_method, authentication_generation
		FROM restricted.users_restricted WHERE id = $1
	`, result.UserID).Scan(&passwordHash, &pinHash, &email, &method, &generation); err != nil {
		t.Fatalf("read the created credentials: %v", err)
	}
	if method != string(VerificationFixedPIN) || email != createdAdministratorMail || generation != 1 {
		t.Fatalf("stored credentials = method:%q email:%q generation:%d", method, email, generation)
	}
	if bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(createdAdministratorWord)) != nil {
		t.Fatal("the stored password does not accept the password the operator entered")
	}
	if bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte("a different long password")) == nil {
		t.Fatal("the stored password accepted a password the operator never entered")
	}
	if bcrypt.CompareHashAndPassword([]byte(pinHash), []byte(createdAdministratorPIN)) != nil {
		t.Fatal("the stored fixed PIN does not accept the PIN the operator entered")
	}
	for _, storedSecret := range []string{passwordHash, pinHash} {
		if strings.Contains(storedSecret, createdAdministratorWord) || strings.Contains(storedSecret, createdAdministratorPIN) {
			t.Fatal("a secret was stored in a recoverable form")
		}
	}

	var administratorOnlyRoute string
	if err = db.QueryRow(`
		SELECT f.url_route_endpoint
		FROM system_functions f
		JOIN system_group_table_func_rights g ON g.function_id = f.id
		WHERE COALESCE(f.disabled, FALSE) IS FALSE
		GROUP BY f.url_route_endpoint
		HAVING array_agg(DISTINCT g.user_group_id)
		       = ARRAY[(SELECT id::integer FROM system_user_groups WHERE name = 'admins')]
		ORDER BY f.url_route_endpoint
		LIMIT 1
	`).Scan(&administratorOnlyRoute); err != nil {
		t.Fatalf("find an administrator-only route in the seeded permissions: %v", err)
	}

	allowed, err := permissions.CheckRouteTablePermission(
		db, administratorOnlyRoute, int(result.UserID),
		permissions.RouteTableScope{}, permissions.AccessControlRouteTableOptions(false),
	)
	if err != nil {
		t.Fatalf("permission check for the created administrator: %v", err)
	}
	if !allowed {
		t.Fatalf("the created administrator was refused the administrator-only route %s", administratorOnlyRoute)
	}

	var ordinaryUserID int64
	if err = db.QueryRow(`
		INSERT INTO system_users (username, full_name, created, updated, enabled, privileged, admin_access_allowed)
		VALUES ('ordinary_member', 'Ordinary Member', NOW(), NOW(), TRUE, FALSE, FALSE)
		RETURNING id
	`).Scan(&ordinaryUserID); err != nil {
		t.Fatalf("insert the comparison account: %v", err)
	}
	if _, err = db.Exec(`
		INSERT INTO system_user_group_memberships (user_id, group_id, created, updated)
		SELECT $1, id, NOW(), NOW() FROM system_user_groups WHERE name = 'users'
	`, ordinaryUserID); err != nil {
		t.Fatalf("add the comparison account to the ordinary group: %v", err)
	}
	allowed, err = permissions.CheckRouteTablePermission(
		db, administratorOnlyRoute, int(ordinaryUserID),
		permissions.RouteTableScope{}, permissions.AccessControlRouteTableOptions(false),
	)
	if err != nil {
		t.Fatalf("permission check for the ordinary account: %v", err)
	}
	if allowed {
		t.Fatalf("an ordinary account also reached %s, so the route proves nothing", administratorOnlyRoute)
	}
}

// TestRestoringTheCreatedAdministratorStillWorksPostgres exercises the restore path against real
// PostgreSQL, so the shared eligible-administrator definition stays valid SQL for listing and locking.
func TestRestoringTheCreatedAdministratorStillWorksPostgres(t *testing.T) {
	db := administratorCreationCluster(t)
	editor := NewRecoveryEditor(db)

	created, err := editor.CreateAdministrator(
		context.Background(),
		newAdministratorCreationInput(t, editor, createdAdministratorName, createdAdministratorMail),
	)
	if err != nil {
		t.Fatalf("CreateAdministrator() error = %v", err)
	}
	identity, err := editor.ReadInstanceIdentity(context.Background())
	if err != nil {
		t.Fatalf("ReadInstanceIdentity() error = %v", err)
	}

	const replacementPassword = "an entirely different long password"
	restored, err := editor.RecoverAdministrator(context.Background(), RecoveryInput{
		UserID:                           created.UserID,
		NewPassword:                      replacementPassword,
		PreserveCurrentVerification:      true,
		ExpectedAuthenticationGeneration: created.AuthenticationGeneration,
		ExpectedVerificationMethod:       created.VerificationMethod,
		TargetIdentity:                   identity,
	})
	if err != nil {
		t.Fatalf("RecoverAdministrator() error = %v", err)
	}
	if restored.UserID != created.UserID || restored.AuthenticationGeneration != created.AuthenticationGeneration+1 {
		t.Fatalf("restore result = %+v, want the same account at the next authentication generation", restored)
	}

	var passwordHash string
	if err = db.QueryRow(
		`SELECT password FROM restricted.users_restricted WHERE id = $1`, created.UserID,
	).Scan(&passwordHash); err != nil {
		t.Fatalf("read the restored credentials: %v", err)
	}
	if bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(replacementPassword)) != nil {
		t.Fatal("the restored password does not accept the replacement the operator entered")
	}
}

func TestCreateAdministratorRefusesADuplicateAndLeavesTheExistingAccountAlonePostgres(t *testing.T) {
	db := administratorCreationCluster(t)
	editor := NewRecoveryEditor(db)

	first, err := editor.CreateAdministrator(
		context.Background(),
		newAdministratorCreationInput(t, editor, createdAdministratorName, createdAdministratorMail),
	)
	if err != nil {
		t.Fatalf("CreateAdministrator() error = %v", err)
	}
	var originalHash string
	var originalGeneration int64
	if err = db.QueryRow(`
		SELECT password, authentication_generation FROM restricted.users_restricted WHERE id = $1
	`, first.UserID).Scan(&originalHash, &originalGeneration); err != nil {
		t.Fatalf("read the first account's credentials: %v", err)
	}
	accountsBefore := countAdministratorAccounts(t, db)

	duplicateName := newAdministratorCreationInput(t, editor, createdAdministratorName, "another.operator@example.com")
	duplicateName.ObservedAdministratorCount = 1
	duplicateName.AcknowledgedExistingAdministrators = true
	duplicateName.NewPassword = "a different long password"
	if _, err = editor.CreateAdministrator(context.Background(), duplicateName); err != ErrAdministratorUsernameTaken {
		t.Fatalf("duplicate account name error = %v, want ErrAdministratorUsernameTaken", err)
	}

	duplicateUpperCase := newAdministratorCreationInput(t, editor, strings.ToUpper(createdAdministratorName), "third.operator@example.com")
	duplicateUpperCase.ObservedAdministratorCount = 1
	duplicateUpperCase.AcknowledgedExistingAdministrators = true
	if _, err = editor.CreateAdministrator(context.Background(), duplicateUpperCase); err != ErrAdministratorUsernameTaken {
		t.Fatalf("case-different duplicate name error = %v, want ErrAdministratorUsernameTaken", err)
	}

	duplicateEmail := newAdministratorCreationInput(t, editor, "second_operator_admin", createdAdministratorMail)
	duplicateEmail.ObservedAdministratorCount = 1
	duplicateEmail.AcknowledgedExistingAdministrators = true
	if _, err = editor.CreateAdministrator(context.Background(), duplicateEmail); err != ErrAdministratorEmailTaken {
		t.Fatalf("duplicate email error = %v, want ErrAdministratorEmailTaken", err)
	}

	if accountsAfter := countAdministratorAccounts(t, db); accountsAfter != accountsBefore {
		t.Fatalf("account count = %d, want the refused attempts to add nothing (%d)", accountsAfter, accountsBefore)
	}
	var currentHash string
	var currentGeneration int64
	if err = db.QueryRow(`
		SELECT password, authentication_generation FROM restricted.users_restricted WHERE id = $1
	`, first.UserID).Scan(&currentHash, &currentGeneration); err != nil {
		t.Fatalf("re-read the first account's credentials: %v", err)
	}
	if currentHash != originalHash || currentGeneration != originalGeneration {
		t.Fatal("a refused creation attempt changed the existing administrator's credentials")
	}
}

func TestCreateAdministratorRequiresConfirmationWhileAnAdministratorExistsPostgres(t *testing.T) {
	db := administratorCreationCluster(t)
	editor := NewRecoveryEditor(db)

	if _, err := editor.CreateAdministrator(
		context.Background(),
		newAdministratorCreationInput(t, editor, createdAdministratorName, createdAdministratorMail),
	); err != nil {
		t.Fatalf("CreateAdministrator() error = %v", err)
	}
	accountsBefore := countAdministratorAccounts(t, db)

	unconfirmed := newAdministratorCreationInput(t, editor, "second_operator_admin", "second.operator@example.com")
	unconfirmed.ObservedAdministratorCount = 1
	if _, err := editor.CreateAdministrator(context.Background(), unconfirmed); err != ErrExistingAdministratorConfirmationRequired {
		t.Fatalf("unconfirmed second administrator error = %v, want ErrExistingAdministratorConfirmationRequired", err)
	}
	if accounts := countAdministratorAccounts(t, db); accounts != accountsBefore {
		t.Fatalf("account count = %d, want no account from the unconfirmed attempt (%d)", accounts, accountsBefore)
	}

	stale := newAdministratorCreationInput(t, editor, "second_operator_admin", "second.operator@example.com")
	stale.ObservedAdministratorCount = 0
	stale.AcknowledgedExistingAdministrators = true
	if _, err := editor.CreateAdministrator(context.Background(), stale); err != ErrAdministratorCountChanged {
		t.Fatalf("stale administrator snapshot error = %v, want ErrAdministratorCountChanged", err)
	}

	confirmed := newAdministratorCreationInput(t, editor, "second_operator_admin", "second.operator@example.com")
	confirmed.ObservedAdministratorCount = 1
	confirmed.AcknowledgedExistingAdministrators = true
	second, err := editor.CreateAdministrator(context.Background(), confirmed)
	if err != nil {
		t.Fatalf("confirmed second administrator error = %v", err)
	}
	if second.ExistingAdministrators != 1 || second.ClosedFirstRunBrowserForm {
		t.Fatalf("second creation result = %+v, want one prior administrator and no first-run change", second)
	}

	var auditEntries int
	var details string
	if err = db.QueryRow(`
		SELECT COUNT(*), COALESCE(MAX(details::text), '')
		FROM system_audit_log
		WHERE handler_name = 'operator.admin_credential_recovery'
		  AND url_path = 'operator://create-admin'
	`).Scan(&auditEntries, &details); err != nil {
		t.Fatalf("read the creation audit entries: %v", err)
	}
	if auditEntries != 2 {
		t.Fatalf("creation audit entries = %d, want one per committed account", auditEntries)
	}
	for _, expected := range []string{"created_username", "operator_reference", "existing_administrator_count", testSiteName} {
		if !strings.Contains(details, expected) {
			t.Fatalf("audit details missing %q: %s", expected, details)
		}
	}
	for _, secret := range []string{createdAdministratorWord, createdAdministratorPIN} {
		if strings.Contains(details, secret) {
			t.Fatalf("audit details recorded the secret %q", secret)
		}
	}
}
