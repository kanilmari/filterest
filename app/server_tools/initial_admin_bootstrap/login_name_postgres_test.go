// login_name_postgres_test.go
// Verifies initial-administrator private lookup and allocation against the shipped bootstrap.
// Bridges CLI configuration, shared account creation and the owner-only credential handoff.
// Holds LT8's default, explicit override and id-only conflict behavior to real PostgreSQL.
package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func bootstrapLoginNameDatabase(t *testing.T) *sql.DB {
	t.Helper()
	if os.Getenv("FILTEREST_TEST_DISPOSABLE_POSTGRES") != "1" {
		t.Skip("set FILTEREST_TEST_DISPOSABLE_POSTGRES=1 for LT8 bootstrap proof")
	}
	bin := os.Getenv("PG_TEST_BIN")
	if bin == "" {
		bin = "/usr/lib/postgresql/16/bin"
	}
	root := t.TempDir()
	socket, data := filepath.Join(root, "socket"), filepath.Join(root, "pgdata")
	if err := os.Mkdir(socket, 0700); err != nil {
		t.Fatal(err)
	}
	run := func(name string, args ...string) {
		t.Helper()
		if out, err := exec.Command(filepath.Join(bin, name), args...).CombinedOutput(); err != nil {
			t.Fatalf("%s: %v %s", name, err, out)
		}
	}
	run("initdb", "-D", data, "-A", "trust", "-U", "test_owner", "--no-locale", "--encoding=UTF8")
	t.Cleanup(func() {
		_, _ = exec.Command(filepath.Join(bin, "pg_ctl"), "-D", data, "-m", "immediate", "-w", "stop").CombinedOutput()
	})
	run("pg_ctl", "-D", data, "-l", filepath.Join(root, "postgres.log"), "-o", fmt.Sprintf("-h '' -k '%s' -p 55132", socket), "-w", "start")
	db, err := sql.Open("postgres", fmt.Sprintf("host=%s port=55132 user=test_owner dbname=postgres sslmode=disable", socket))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	for _, name := range []string{"schema.sql", "seed_data.sql"} {
		body, err := os.ReadFile(filepath.Join("..", "public_bootstrap", name))
		if err != nil {
			t.Fatal(err)
		}
		if _, err = db.Exec(string(body)); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
	}
	return db
}

func TestInitialAdministratorLoginNamesPostgres(t *testing.T) {
	for _, explicit := range []bool{false, true} {
		t.Run(fmt.Sprintf("LT8 explicit=%v", explicit), func(t *testing.T) {
			db := bootstrapLoginNameDatabase(t)
			t.Setenv("FILTEREST_SITE_SLUG", "Northwind")
			t.Setenv("SITE_SLUG", "ignored")
			t.Setenv("FILTEREST_DB_PASSWORD", "not-used-by-disposable-db")
			t.Setenv("LOGIN_OTP_CODE", "246810")
			args := []string{"--email", "bootstrap@example.invalid"}
			wantLogin := "admin_northwind"
			if explicit {
				// LT10 exercises the operator flow with a fresh private canary;
				// the default-name case still pins LT8's site-slug suggestion.
				wantLogin = "a" + strings.ToLower(rand.Text())
				args = append(args, "--login-name", wantLogin)
			}
			cfg, err := parseConfig(args)
			if err != nil {
				t.Fatal(err)
			}
			result, err := ensureInitialAdmin(context.Background(), db, cfg)
			if err != nil || result.status != "created" || result.username != "admin_1" || result.loginName != wantLogin {
				t.Fatalf("bootstrap result=%+v err=%v", result, err)
			}
			var login, hash string
			var closed bool
			if err = db.QueryRow(`SELECT login_name,password FROM restricted.users_restricted WHERE id=$1`, result.userID).Scan(&login, &hash); err != nil || login != wantLogin || bcrypt.CompareHashAndPassword([]byte(hash), []byte(result.password)) != nil {
				t.Fatal("restricted credential readback", err)
			}
			if err = db.QueryRow(`SELECT boolean_value=false FROM system_config WHERE key='first_run'`).Scan(&closed); err != nil || !closed {
				t.Fatal("setup not closed", err)
			}
			var output bytes.Buffer
			writeBootstrapStatus(&output, "handoff", result)
			if strings.Contains(output.String(), login) {
				t.Fatal("private name in bootstrap status")
			}
			file := filepath.Join(t.TempDir(), "credentials.txt")
			if err = writeCredentialHandoff(file, result); err != nil {
				t.Fatal(err)
			}
			body, err := os.ReadFile(file)
			if err != nil || !bytes.Contains(body, []byte(login)) || !bytes.Contains(body, []byte(result.username)) {
				t.Fatal("handoff must contain both names", err)
			}
			if _, err = db.Exec(`UPDATE system_users SET enabled=false WHERE id=$1`, result.userID); err != nil {
				t.Fatal(err)
			}
			_, err = ensureInitialAdmin(context.Background(), db, cfg)
			if err == nil || !strings.Contains(err.Error(), fmt.Sprint(result.userID)) || strings.Contains(err.Error(), login) {
				t.Fatal("private lookup / id-only conflict", err)
			}
		})
	}
}
