// permissions_cleanup_test.go
// Verifies that startup reports stale permissions instead of deleting them.
// Bridges the cleanup rules with an administrator's own permission settings.
// Exists because a grant deleted during a restart is gone with no record of
// what it was, and the loss hides itself: administrator access is restored
// immediately afterwards, so only other groups notice, later.
package backend

import (
	"database/sql"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	_ "github.com/lib/pq"
)

// cleanupDisposableDB starts an isolated PostgreSQL cluster holding just enough
// of the permission tables to exercise every cleanup rule.
func cleanupDisposableDB(t *testing.T) *sql.DB {
	t.Helper()
	if os.Getenv("FILTEREST_TEST_DISPOSABLE_POSTGRES") != "1" {
		t.Skip("set FILTEREST_TEST_DISPOSABLE_POSTGRES=1 to run isolated PostgreSQL verification")
	}
	root, err := os.MkdirTemp("", "filterest-permission-cleanup-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(root) })

	socket := filepath.Join(root, "socket")
	if err := os.Mkdir(socket, 0700); err != nil {
		t.Fatal(err)
	}
	data := filepath.Join(root, "db")
	bin := "/usr/lib/postgresql/16/bin/"
	run := func(name string, args ...string) {
		t.Helper()
		if output, err := exec.Command(bin+name, args...).CombinedOutput(); err != nil {
			t.Fatalf("%s: %v: %s", name, err, output)
		}
	}
	run("initdb", "-D", data, "-A", "trust", "-U", "test_owner", "--no-locale", "--encoding=UTF8")
	t.Cleanup(func() {
		_, _ = exec.Command(bin+"pg_ctl", "-D", data, "-m", "immediate", "-w", "stop").CombinedOutput()
	})
	run("pg_ctl", "-D", data, "-l", filepath.Join(root, "postgres.log"),
		"-o", "-h '' -k '"+socket+"' -p 15462", "-w", "start")

	db, err := sql.Open("postgres",
		fmt.Sprintf("host=%s port=15462 user=test_owner dbname=postgres sslmode=disable", socket))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	// One live route, one disabled route standing for a renamed handler, and a
	// grant on each. The disabled one is what a restart used to erase.
	if _, err := db.Exec(`
        CREATE TABLE system_db_tables(table_uid integer PRIMARY KEY, table_name text, schema_name text);
        CREATE TABLE system_functions(id integer PRIMARY KEY, name text, disabled boolean, specific_table_related boolean);
        CREATE TABLE system_group_table_func_rights(user_group_id integer, function_id integer, target_table_uid integer, target_schema_name text);
        INSERT INTO system_functions VALUES
            (1, 'router.LiveHandler', false, false),
            (2, 'router.RenamedAwayHandler', true, false);
        INSERT INTO system_group_table_func_rights VALUES
            (2, 1, NULL, 'public'),
            (2, 2, NULL, 'public');
    `); err != nil {
		t.Fatal(err)
	}
	return db
}

func grantCount(t *testing.T, db *sql.DB) int {
	t.Helper()
	var total int
	if err := db.QueryRow(`SELECT COUNT(*) FROM system_group_table_func_rights`).Scan(&total); err != nil {
		t.Fatal(err)
	}
	return total
}

func TestReportingCleanupLeavesAnAdministratorsGrantsAlonePostgres(t *testing.T) {
	db := cleanupDisposableDB(t)

	err := CleanGroupTableFuncRights(db, PermissionCleanupOptions{
		RemoveMissingTables: true,
		RemoveDisabledFuncs: true,
		RemoveMismatchedUID: true,
		ReportOnly:          true,
	})
	if err != nil {
		t.Fatalf("reporting cleanup returned an error: %v", err)
	}
	if total := grantCount(t, db); total != 2 {
		t.Fatalf("reporting cleanup removed grants: %d remain, want 2", total)
	}
}

func TestApprovedCleanupRemovesTheGrantOfARouteThatIsGonePostgres(t *testing.T) {
	db := cleanupDisposableDB(t)

	err := CleanGroupTableFuncRights(db, PermissionCleanupOptions{
		RemoveMissingTables: true,
		RemoveDisabledFuncs: true,
		RemoveMismatchedUID: true,
	})
	if err != nil {
		t.Fatalf("approved cleanup returned an error: %v", err)
	}
	// Only the grant whose route is disabled goes; the live route keeps its own.
	if total := grantCount(t, db); total != 1 {
		t.Fatalf("approved cleanup removed the wrong rows: %d remain, want 1", total)
	}
	var remaining int
	if err := db.QueryRow(`SELECT function_id FROM system_group_table_func_rights`).Scan(&remaining); err != nil {
		t.Fatal(err)
	}
	if remaining != 1 {
		t.Fatalf("the surviving grant belongs to function %d, want the live route", remaining)
	}
}
