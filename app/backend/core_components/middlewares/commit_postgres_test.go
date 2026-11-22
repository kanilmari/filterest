// commit_postgres_test.go
// Proves against real PostgreSQL that a commit-time rejection never reaches the client as success.
// Uses a deferred unique constraint, which accepts the INSERT and refuses only at COMMIT.
// Runs in a disposable cluster with FILTEREST_TEST_DISPOSABLE_POSTGRES=1; never touches LNCD.
package middlewares

import (
	"database/sql"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	_ "github.com/lib/pq"
)

func commitDisposablePostgres(t *testing.T) *sql.DB {
	t.Helper()
	if os.Getenv("FILTEREST_TEST_DISPOSABLE_POSTGRES") != "1" {
		t.Skip("set FILTEREST_TEST_DISPOSABLE_POSTGRES=1 for isolated PostgreSQL checks")
	}
	bin := os.Getenv("PG_TEST_BIN")
	if bin == "" {
		bin = "/usr/lib/postgresql/16/bin"
	}
	if _, err := os.Stat(filepath.Join(bin, "initdb")); err != nil {
		t.Skip("PostgreSQL test binaries unavailable")
	}
	root, err := os.MkdirTemp("", "filterest-commit-response-")
	if err != nil {
		t.Fatal(err)
	}
	socket, data := filepath.Join(root, "socket"), filepath.Join(root, "db")
	// Registered before start, because pg_ctl can time out while the server
	// keeps starting. The directory is removed only once the server is known
	// to be down; otherwise it is kept and the test fails with its location.
	t.Cleanup(func() {
		if stopDisposablePostgres(t, bin, data) {
			os.RemoveAll(root)
		} else {
			t.Errorf("disposable PostgreSQL may still run; left %s in place", root)
		}
	})
	if err := os.Mkdir(socket, 0o700); err != nil {
		t.Fatal(err)
	}
	run := func(name string, args ...string) {
		t.Helper()
		if out, err := exec.Command(filepath.Join(bin, name), args...).CombinedOutput(); err != nil {
			log, _ := os.ReadFile(filepath.Join(root, "postgres.log"))
			t.Fatalf("disposable %s: %v: %s\n%s", name, err, out, log)
		}
	}
	run("initdb", "-D", data, "-A", "trust", "-U", "fixture_owner", "--no-locale", "--encoding=UTF8")
	run("pg_ctl", "-D", data, "-l", filepath.Join(root, "postgres.log"), "-o", "-h '' -k '"+socket+"' -p 15513", "-w", "start")
	db, err := sql.Open("postgres", "host="+socket+" port=15513 user=fixture_owner dbname=postgres sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if _, err := db.Exec(`
        CREATE TABLE public.commit_probe(
          id integer PRIMARY KEY,
          code text NOT NULL,
          CONSTRAINT commit_probe_code_unique UNIQUE (code) DEFERRABLE INITIALLY DEFERRED);
        INSERT INTO public.commit_probe VALUES (1, 'taken');`); err != nil {
		t.Fatal(err)
	}
	return db
}

// stopDisposablePostgres reports whether the server is down. pg_ctl status
// exits 3 when no server runs and 4 when there is no data directory yet.
func stopDisposablePostgres(t *testing.T, bin, data string) bool {
	t.Helper()
	pgCtl := filepath.Join(bin, "pg_ctl")
	statusCode := func() int {
		err := exec.Command(pgCtl, "-D", data, "status").Run()
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			return exit.ExitCode()
		}
		if err != nil {
			return -1
		}
		return 0
	}
	switch statusCode() {
	case 3, 4:
		return true
	case 0:
		if out, err := exec.Command(pgCtl, "-D", data, "-m", "immediate", "-w", "stop").CombinedOutput(); err != nil {
			t.Errorf("disposable PostgreSQL did not stop: %v: %s", err, out)
			return false
		}
		code := statusCode()
		return code == 3 || code == 4
	default:
		t.Error("pg_ctl status failed for the disposable PostgreSQL")
		return false
	}
}

func TestLazyTransactionPostgresCommitRejectionReplacesSuccess(t *testing.T) {
	db := commitDisposablePostgres(t)
	useCommitTestSessions(t)
	oldAdmin, oldDB := backend.DbAdmin, backend.Db
	backend.DbAdmin, backend.Db = db, db
	t.Cleanup(func() { backend.DbAdmin, backend.Db = oldAdmin, oldDB })

	for _, test := range []struct {
		name      string
		id        int
		code      string
		committed bool
	}{
		{name: "deferred unique violation", id: 2, code: "taken"},
		{name: "valid control row", id: 3, code: "free", committed: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			insertAccepted, attemptedCreated := false, false
			recorder := httptest.NewRecorder()
			WithLazyTransaction(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				tx, err := dbutils.RequireTxWithError(r.Context())
				if err != nil {
					t.Fatal(err)
				}
				// The deferred constraint lets the statement itself succeed.
				if _, err := tx.ExecContext(r.Context(), `INSERT INTO public.commit_probe VALUES ($1, $2)`, test.id, test.code); err != nil {
					t.Fatalf("INSERT must succeed until COMMIT: %v", err)
				}
				insertAccepted = true
				w.Header().Set("Location", "/commit-probe")
				http.SetCookie(w, &http.Cookie{Name: "saved", Value: "yes"})
				w.WriteHeader(http.StatusCreated)
				_, _ = w.Write([]byte("saved"))
				attemptedCreated = true
			})).ServeHTTP(recorder, commitTestRequest(http.MethodPost, "/api/commit-probe"))

			if !insertAccepted || !attemptedCreated {
				t.Fatal("handler did not reach its success response")
			}
			var rows int
			// The pool hands out a connection outside the finished request transaction.
			if err := db.QueryRow(`SELECT count(*) FROM public.commit_probe WHERE id = $1`, test.id).Scan(&rows); err != nil {
				t.Fatal(err)
			}
			if test.committed {
				if recorder.Code != http.StatusCreated || recorder.Body.String() != "saved" || rows != 1 {
					t.Fatalf("valid save: status=%d body=%q rows=%d", recorder.Code, recorder.Body.String(), rows)
				}
				return
			}
			if rows != 0 {
				t.Fatal("rejected row is visible after the request")
			}
			if !strings.Contains(recorder.Body.String(), "transaction commit failed") {
				t.Fatalf("the failure did not come from COMMIT: %q", recorder.Body.String())
			}
			assertNoBufferedSuccess(t, recorder)
		})
	}
}
