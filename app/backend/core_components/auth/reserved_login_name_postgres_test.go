// reserved_login_name_postgres_test.go
// Proves LT9 reserved fixtures are identified privately and reconciled atomically.
// Bridges the real startup entry point and the opt-in disposable PostgreSQL fixture.
// Covers ordinary-name policy changes, orphan safety and production purge rollback.
package auth_test

import (
	"context"
	"database/sql"
	"easelect/backend/core_components/auth"
	"easelect/backend/core_components/startup"
	"fmt"
	"os"
	"strings"
	"testing"
)

func fixtureAccountNames(t *testing.T, db *sql.DB, login string) (int64, string, string) {
	t.Helper()
	var id int64
	var display, full string
	if err := db.QueryRow(`SELECT u.id,u.username,u.full_name FROM system_users u JOIN restricted.users_restricted ur USING(id) WHERE lower(ur.login_name)=lower($1)`, login).Scan(&id, &display, &full); err != nil {
		t.Fatal(err)
	}
	return id, display, full
}

func TestReservedLoginNameLifecyclePostgres(t *testing.T) {
	db := reservedNamesDatabase(t)
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	t.Setenv("RESERVED_TEST_USERS", "")
	t.Setenv("FILTEREST_DEV_ADMIN_USERNAME", "")
	t.Setenv("FILTEREST_DEV_ADMIN_PASSWORD", "")
	if err := startup.ReconcileReservedTestUsers(db, "dev"); err != nil {
		t.Fatal(err)
	}
	adminID, adminDisplay, _ := fixtureAccountNames(t, db, "TEST_ADMIN")
	userID, userDisplay, userFull := fixtureAccountNames(t, db, "TEST_USER")
	if !strings.HasPrefix(adminDisplay, "admin_") || userDisplay != "test_user" {
		t.Fatal("reserved account names", adminDisplay, userDisplay)
	}
	if _, err := db.Exec(`UPDATE system_config SET boolean_value=false WHERE key='display_name_may_equal_login_name'`); err != nil {
		t.Fatal(err)
	}
	if err := startup.ReconcileReservedTestUsers(db, "dev"); err != nil {
		t.Fatal("existing equal pair was refused after policy tightening", err)
	}
	sameID, display, full := fixtureAccountNames(t, db, "test_user")
	if sameID != userID || display != userDisplay || full != userFull {
		t.Fatal("policy tightening renamed an existing ordinary fixture")
	}
	if _, err := db.Exec(`UPDATE system_users SET username='kept_reserved_display',full_name='Chosen full name' WHERE id=$1;
        `, userID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE system_config SET boolean_value=false WHERE key='display_name_may_equal_login_name'`); err != nil {
		t.Fatal(err)
	}
	if err := startup.ReconcileReservedTestUsers(db, "dev"); err != nil {
		t.Fatal(err)
	}
	sameID, display, full = fixtureAccountNames(t, db, "test_user")
	if sameID != userID || display != "kept_reserved_display" || full != "Chosen full name" || userFull == "" {
		t.Fatal("existing names were replaced")
	}
	if _, err := db.Exec(`UPDATE system_users SET username='chosen_reserved_admin' WHERE id=$1`, adminID); err != nil {
		t.Fatal(err)
	}
	if err := startup.ReconcileReservedTestUsers(db, "dev"); err != nil {
		t.Fatal(err)
	}
	sameAdminID, display, _ := fixtureAccountNames(t, db, "test_admin")
	if sameAdminID != adminID || display != "chosen_reserved_admin" {
		t.Fatal("lookup still depends on display name")
	}
	// The whole purge rolls back when deletion of its second account fails.
	if _, err := db.Exec(`CREATE FUNCTION public.test_reserved_delete_failure() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF OLD.id=` + int64String(adminID) + ` THEN RAISE EXCEPTION 'fixture failure'; END IF;RETURN OLD;END$$;
        CREATE TRIGGER test_reserved_delete_failure BEFORE DELETE ON system_users FOR EACH ROW EXECUTE FUNCTION public.test_reserved_delete_failure()`); err != nil {
		t.Fatal(err)
	}
	if err := startup.ReconcileReservedTestUsers(db, "prod"); err == nil {
		t.Fatal("forced purge failure succeeded")
	}
	fixtureAccountNames(t, db, "test_user")
	fixtureAccountNames(t, db, "test_admin")
	if _, err := db.Exec(`DROP TRIGGER test_reserved_delete_failure ON system_users;DROP FUNCTION public.test_reserved_delete_failure()`); err != nil {
		t.Fatal(err)
	}
	if err := startup.ReconcileReservedTestUsers(db, "prod"); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := db.QueryRow(`SELECT count(*) FROM restricted.users_restricted WHERE lower(login_name) IN ('test_user','test_admin')`).Scan(&count); err != nil || count != 0 {
		t.Fatal("production fixtures retained", err)
	}
	if err := startup.ReconcileReservedTestUsers(db, "dev"); err != nil {
		t.Fatal(err)
	}
	_, display, _ = fixtureAccountNames(t, db, "test_user")
	if !strings.HasPrefix(display, "user_") {
		t.Fatal("new strict ordinary fixture did not allocate", display)
	}
}

func int64String(value int64) string { return fmt.Sprintf("%d", value) }

func TestConfiguredDevelopmentAdministratorPreservesCredentialsPostgres(t *testing.T) {
	db := reservedNamesDatabase(t)
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	t.Setenv("RESERVED_TEST_USERS", "")
	t.Setenv("FILTEREST_DEV_ADMIN_USERNAME", "ordinary_login")
	t.Setenv("FILTEREST_DEV_ADMIN_PASSWORD", "must-not-replace-existing-password")
	t.Setenv("BASE_URL", "https://localhost:50132")
	if _, err := db.Exec(`UPDATE system_users SET full_name=username,search_vector_simple=to_tsvector(username) WHERE id=91002`); err != nil {
		t.Fatal(err)
	}
	var before, after string
	credentialSnapshot := `SELECT jsonb_build_array(password,login_name,authentication_generation)::text FROM restricted.users_restricted WHERE id=91002`
	if err := db.QueryRow(credentialSnapshot).Scan(&before); err != nil {
		t.Fatal(err)
	}
	if err := startup.ReconcileReservedTestUsers(db, "dev"); err != nil {
		t.Fatal(err)
	}
	id, display, full := fixtureAccountNames(t, db, "ordinary_login")
	if id != 91002 || !strings.HasPrefix(display, "admin_") || full != display {
		t.Fatal("configured administrator retained a private-name public copy")
	}
	if err := db.QueryRow(credentialSnapshot).Scan(&after); err != nil || after != before {
		t.Fatal("configured administrator credentials changed", err)
	}
	var cleared bool
	if err := db.QueryRow(`SELECT search_vector_simple IS NULL FROM system_users WHERE id=91002`).Scan(&cleared); err != nil || !cleared {
		t.Fatal("configured promotion retained a search copy", err)
	}
}

func TestReservedLoginNameOrphanAndCreationRollbackPostgres(t *testing.T) {
	db := reservedNamesDatabase(t)
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	t.Setenv("RESERVED_TEST_USERS", "")
	t.Setenv("FILTEREST_DEV_ADMIN_USERNAME", "")
	t.Setenv("FILTEREST_DEV_ADMIN_PASSWORD", "")
	if _, err := db.Exec(`INSERT INTO system_users(id,username,enabled) VALUES(91999,'test_user',true)`); err != nil {
		t.Fatal(err)
	}
	err := startup.ReconcileReservedTestUsers(db, "dev")
	if err == nil || !strings.Contains(err.Error(), "91999") || strings.Contains(err.Error(), "test_user") {
		t.Fatal("orphan refusal", err)
	}
	if err = startup.ReconcileReservedTestUsers(db, "prod"); err != nil {
		t.Fatal("production must tolerate orphan", err)
	}
	var retained bool
	if err = db.QueryRow(`SELECT EXISTS(SELECT 1 FROM system_users WHERE id=91999)`).Scan(&retained); err != nil || !retained {
		t.Fatal("purge adopted an orphan", err)
	}
	if _, err = db.Exec(`DELETE FROM system_users WHERE id=91999;
        CREATE FUNCTION public.test_reserved_creation_failure() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.login_name='test_admin' THEN RAISE EXCEPTION 'fixture failure'; END IF;RETURN NEW;END$$;
        CREATE TRIGGER test_reserved_creation_failure BEFORE INSERT ON restricted.users_restricted FOR EACH ROW EXECUTE FUNCTION public.test_reserved_creation_failure()`); err != nil {
		t.Fatal(err)
	}
	err = startup.ReconcileReservedTestUsers(db, "dev")
	if err == nil || strings.Contains(err.Error(), "test_admin") {
		t.Fatal("fixture failure was not value-free", err)
	}
	var count int
	if err = db.QueryRowContext(context.Background(), `SELECT count(*) FROM system_users WHERE username='test_user'`).Scan(&count); err != nil || count != 0 {
		t.Fatal("partial reconciliation committed", err)
	}
}

func reservedNamesDatabase(t *testing.T) *sql.DB {
	t.Helper()
	return auth.LoginNameDisposableClusterForTest(t)
}

func TestReservedCaseVariantsUntouchedPostgres(t *testing.T) {
	db := reservedNamesDatabase(t)
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	t.Setenv("RESERVED_TEST_USERS", "")
	t.Setenv("FILTEREST_DEV_ADMIN_USERNAME", "")
	t.Setenv("FILTEREST_DEV_ADMIN_PASSWORD", "")
	if _, err := db.Exec(`UPDATE system_users SET username='Test_User',full_name='Test_User' WHERE id=91002;
        UPDATE system_users SET username='TEST_ADMIN',full_name='TEST_ADMIN' WHERE id=91004;
        UPDATE restricted.users_restricted SET login_name='Test_User' WHERE id=91002;
        UPDATE restricted.users_restricted SET login_name='TEST_ADMIN' WHERE id=91004`); err != nil {
		t.Fatal(err)
	}
	snapshot := func() string {
		t.Helper()
		var value string
		if err := db.QueryRow(`SELECT jsonb_agg(jsonb_build_array(to_jsonb(u),to_jsonb(ur),
            (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM system_user_group_memberships m WHERE m.user_id=u.id)) ORDER BY u.id)::text
            FROM system_users u JOIN restricted.users_restricted ur USING(id) WHERE u.id IN (91002,91004)`).Scan(&value); err != nil {
			t.Fatal(err)
		}
		return value
	}
	before := snapshot()
	// The case-insensitive unique index prevents creating the exact fixture.
	// That conflict must roll back, never adopt/reset/promote the real account.
	if err := startup.ReconcileReservedTestUsers(db, "dev"); err == nil {
		t.Fatal("case variant was adopted as a development fixture")
	}
	if got := snapshot(); got != before {
		t.Fatal("development changed a differently cased real account")
	}
	if err := startup.ReconcileReservedTestUsers(db, "prod"); err != nil {
		t.Fatal(err)
	}
	if got := snapshot(); got != before {
		t.Fatal("production changed a differently cased real account")
	}
	preflight, err := os.ReadFile("../../../server_tools/scripts/login_name_dry_run.sql")
	if err != nil {
		t.Fatal(err)
	}
	rows, err := db.Query(string(preflight))
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	found := false
	for rows.Next() {
		var item, detail string
		if err := rows.Scan(&item, &detail); err != nil {
			t.Fatal(err)
		}
		if item == "reserved_name_case_variant_ids" {
			found = detail == "[91002, 91004]"
		}
	}
	if err := rows.Err(); err != nil || !found {
		t.Fatal("preflight missed case-variant ids", err)
	}
}

func TestConfiguredNumberedDevAdministratorAllocatesDistinctNamePostgres(t *testing.T) {
	db := reservedNamesDatabase(t)
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	t.Setenv("RESERVED_TEST_USERS", "")
	t.Setenv("FILTEREST_DEV_ADMIN_USERNAME", "admin_7")
	t.Setenv("FILTEREST_DEV_ADMIN_PASSWORD", "protected-dev-password")
	t.Setenv("BASE_URL", "https://localhost:8100")
	if err := startup.ReconcileReservedTestUsers(db, "dev"); err != nil {
		t.Fatal(err)
	}
	_, display, _ := fixtureAccountNames(t, db, "admin_7")
	if strings.EqualFold(display, "admin_7") || !strings.HasPrefix(display, "admin_") {
		t.Fatal("numbered names collided")
	}
	var address string
	if err := db.QueryRow(`SELECT email FROM restricted.users_restricted WHERE login_name='admin_7'`).Scan(&address); err != nil || strings.Contains(address, "admin_7") {
		t.Fatal("private name copied to email", err)
	}
}

func TestReservedAdministratorCaseVariantNotAdoptedPostgres(t *testing.T) {
	db := reservedNamesDatabase(t)
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	t.Setenv("RESERVED_TEST_USERS", "")
	t.Setenv("FILTEREST_DEV_ADMIN_USERNAME", "")
	t.Setenv("FILTEREST_DEV_ADMIN_PASSWORD", "")
	if _, err := db.Exec(`UPDATE system_users SET username='TEST_ADMIN',full_name='TEST_ADMIN' WHERE id=91004;
        UPDATE restricted.users_restricted SET login_name='TEST_ADMIN' WHERE id=91004`); err != nil {
		t.Fatal(err)
	}
	query := `SELECT jsonb_build_array(to_jsonb(u),to_jsonb(ur),
        (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM system_user_group_memberships m WHERE m.user_id=u.id))::text
        FROM system_users u JOIN restricted.users_restricted ur USING(id) WHERE u.id=91004`
	var before, after string
	if err := db.QueryRow(query).Scan(&before); err != nil {
		t.Fatal(err)
	}
	if err := startup.ReconcileReservedTestUsers(db, "dev"); err == nil {
		t.Fatal("uppercase administrator fixture was adopted")
	}
	if err := db.QueryRow(query).Scan(&after); err != nil || before != after {
		t.Fatal("real account was promoted or reset", err)
	}
	var count int
	if err := db.QueryRow(`SELECT count(*) FROM restricted.users_restricted WHERE login_name='test_user'`).Scan(&count); err != nil || count != 0 {
		t.Fatal("partial development reconciliation committed", err)
	}
}
