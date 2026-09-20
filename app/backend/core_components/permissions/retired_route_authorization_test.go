// retired_route_authorization_test.go
// Verifies that a grant left on a retired route cannot authorize its address.
// Bridges the permission check with what startup now leaves behind.
// Exists because startup stopped deleting stale grants, which was the only
// thing that had been closing this gap: a route retired in code keeps its row
// and its grants, and the address it used to serve is often still in service
// under a different handler. The permission screen reads the flag, so the
// access it showed and the access that existed had drifted apart.
package permissions

import (
	"database/sql"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	_ "github.com/lib/pq"
)

// retiredRouteDB starts an isolated PostgreSQL cluster holding one address that
// two rows claim: the handler that serves it now, and the one it replaced.
func retiredRouteDB(t *testing.T) *sql.DB {
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
	bin := "/usr/lib/postgresql/16/bin/"
	run := func(name string, args ...string) {
		t.Helper()
		if output, err := exec.Command(bin+name, args...).CombinedOutput(); err != nil {
			t.Fatalf("%s: %v: %s", name, err, output)
		}
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("find an unused port: %v", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	if err := listener.Close(); err != nil {
		t.Fatalf("release the port: %v", err)
	}

	run("initdb", "-D", data, "-A", "trust", "-U", "test_owner", "--no-locale", "--encoding=UTF8")
	t.Cleanup(func() {
		_, _ = exec.Command(bin+"pg_ctl", "-D", data, "-m", "immediate", "-w", "stop").CombinedOutput()
	})
	run("pg_ctl", "-D", data, "-l", filepath.Join(root, "postgres.log"),
		"-o", fmt.Sprintf("-h '' -k '%s' -p %d", socket, port), "-w", "start")

	db, err := sql.Open("postgres",
		fmt.Sprintf("host=%s port=%d user=test_owner dbname=postgres sslmode=disable", socket, port))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	// Group 7 was granted the handler that used to serve /api/reports and was
	// never granted the one serving it today. Group 8 holds the live grant.
	// Row 3 stands for an installation that never wrote the flag at all.
	if _, err := db.Exec(`
        CREATE TABLE system_db_tables(table_uid integer PRIMARY KEY, table_name text, schema_name text);
        CREATE TABLE system_functions(
            id integer PRIMARY KEY, name text, url_route_endpoint text,
            disabled boolean, specific_table_related boolean, ui_only boolean);
        CREATE TABLE system_group_table_func_rights(
            user_group_id integer, function_id integer,
            target_table_uid integer, target_schema_name text);
        CREATE TABLE system_user_group_memberships(user_id integer, group_id integer);
        INSERT INTO system_functions VALUES
            (1, 'reports.RetiredHandler', '/api/reports', true,  false, false),
            (2, 'reports.LiveHandler',    '/api/reports', false, false, false),
            (3, 'legacy.NeverFlagged',    '/api/legacy',  NULL,  false, false);
        INSERT INTO system_group_table_func_rights VALUES
            (7, 1, NULL, 'public'),
            (8, 2, NULL, 'public'),
            (9, 3, NULL, 'public');
        INSERT INTO system_user_group_memberships VALUES (70, 7), (80, 8), (90, 9);
    `); err != nil {
		t.Fatal(err)
	}
	return db
}

func allowed(t *testing.T, db *sql.DB, userID int, route string) bool {
	t.Helper()
	permitted, err := CheckRouteTablePermission(
		db, route, userID, RouteTableScope{}, AccessControlRouteTableOptions(false),
	)
	if err != nil {
		t.Fatalf("permission check for user %d on %s: %v", userID, route, err)
	}
	return permitted
}

func TestAGrantOnARetiredRouteDoesNotOpenItsAddressPostgres(t *testing.T) {
	db := retiredRouteDB(t)

	if allowed(t, db, 70, "/api/reports") {
		t.Fatal("a grant on the retired handler still opened the address it used to serve")
	}
	if !allowed(t, db, 80, "/api/reports") {
		t.Fatal("the grant on the handler actually serving the address was refused")
	}
}

func TestAnInstallationThatNeverWroteTheFlagKeepsItsAccessPostgres(t *testing.T) {
	db := retiredRouteDB(t)

	// The column is nullable. Reading an unset flag as "retired" would take
	// away working access from an installation that simply never wrote it.
	if !allowed(t, db, 90, "/api/legacy") {
		t.Fatal("an unset flag was treated as retired and removed working access")
	}
}
