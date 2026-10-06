// permission_disposable_postgres_test.go
// Shared opt-in PostgreSQL cluster for the permission writer's parameter proof.
// Retains the test harness while startup grant tests use the shared policy fixture.
package backend

import (
	"database/sql"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

const writeRevocationClusterRoles = `CREATE ROLE guest_role LOGIN; CREATE ROLE basic_role LOGIN;
CREATE ROLE readonly_role LOGIN; CREATE ROLE confidential_role LOGIN; CREATE ROLE granting_editor NOLOGIN;`

type writeRevocationCluster struct {
	t      *testing.T
	socket string
	port   int
}

// startWriteRevocationCluster starts a disposable cluster whose initial
// superuser plays the administrator connection, and creates the runtime roles.
func startWriteRevocationCluster(t *testing.T) *writeRevocationCluster {
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

	cluster := &writeRevocationCluster{t: t, socket: socket, port: port}
	cluster.exec(cluster.open("test_owner", "postgres"), writeRevocationClusterRoles)

	t.Setenv("DB_GUEST_USER", "guest_role")
	t.Setenv("DB_BASIC_USER", "basic_role")
	t.Setenv("DB_READONLY_USER", "readonly_role")
	t.Setenv("DB_CONFIDENTIAL_USER", "confidential_role")
	t.Setenv("DB_ADMIN_USER", "test_owner")
	t.Setenv("DB_USER", "")
	return cluster
}

func (cluster *writeRevocationCluster) open(user, database string) *sql.DB {
	cluster.t.Helper()
	db, err := sql.Open("postgres", fmt.Sprintf("host=%s port=%d user=%s dbname=%s sslmode=disable",
		cluster.socket, cluster.port, user, database))
	if err != nil {
		cluster.t.Fatal(err)
	}
	cluster.t.Cleanup(func() { _ = db.Close() })
	return db
}

func (cluster *writeRevocationCluster) exec(db *sql.DB, statements string) {
	cluster.t.Helper()
	if _, err := db.Exec(statements); err != nil {
		cluster.t.Fatalf("%v\n%s", err, statements)
	}
}
