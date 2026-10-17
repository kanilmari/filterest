// first_run_readonly_postgres_test.go
// Proves public first-run rendering and its name suggestion never write database rows.
// Connects the real handler and WO41 migration on the opt-in disposable PostgreSQL fixture.
// Read-only connections reject writes; whole-database row fingerprints catch side effects.
package auth

import (
	"database/sql"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFirstRunGETReadOnlyPostgres(t *testing.T) {
	resetFirstRunLimits(t)
	db := loginNameDisposableCluster(t)
	migration, err := os.ReadFile(filepath.Join("..", "..", "..", "server_tools", "migrations",
		"20261015000016_seed_first_run_setup_code.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(string(migration)); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`UPDATE system_users SET admin_access_allowed=false,username='demoted_fixture_display' WHERE id=91001;
		DELETE FROM system_user_group_memberships WHERE user_id=91001 AND group_id=1;
		UPDATE system_config SET boolean_value=true WHERE key='first_run'`); err != nil {
		t.Fatal(err)
	}
	t.Setenv("FILTEREST_SITE_SLUG", "Northwind")
	var volatility string
	if err = db.QueryRow(`SELECT provolatile::text FROM pg_proc
		WHERE oid='public.app_next_admin_display_name(text,text[])'::regprocedure`).Scan(&volatility); err != nil || volatility != "s" {
		t.Fatalf("suggestion must be STABLE: volatility=%q err=%v", volatility, err)
	}

	// Every handler query uses this one connection, including DbAdmin. The real
	// session store is a signed cookie, so there is no server-side session exception.
	db.SetMaxOpenConns(1)
	if _, err = db.Exec(`SET default_transaction_read_only=on`); err != nil {
		t.Fatal(err)
	}
	before := firstRunDatabaseRows(t, db)
	for _, prefix := range []string{"admin", "auto", "user"} {
		var suggestion string
		if err = db.QueryRow(`SELECT public.app_next_admin_display_name($1,ARRAY[$2]::text[])`,
			prefix, prefix+"_1").Scan(&suggestion); err != nil {
			t.Fatalf("suggestion cannot INSERT/UPDATE in a read-only transaction: %v", err)
		}
		if !strings.HasPrefix(suggestion, prefix+"_") || suggestion == prefix+"_1" {
			t.Fatalf("suggestion ignored its prefix or exclusions: %q", suggestion)
		}
	}
	var cookie *http.Cookie
	for visit := 0; visit < 3; visit++ {
		request := httptest.NewRequest(http.MethodGet, "/first-run", nil)
		request.RemoteAddr = "192.0.2.219:1234"
		if visit == 1 {
			request.AddCookie(cookie)
		}
		response := httptest.NewRecorder()
		FirstRunAdminHandler(response, request)
		if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `value="admin_1"`) ||
			!strings.Contains(response.Body.String(), `name="setup_code"`) {
			t.Fatalf("read-only GET did not render the real form: status=%d", response.Code)
		}
		assertFirstRunCodeNotEchoed(t, response, firstRunAccess.proof)
		cookie = latestPostgresCookie(t, response)
	}
	after := firstRunDatabaseRows(t, db)
	if len(before) != len(after) {
		t.Fatal("GET changed the database table inventory")
	}
	for table, fingerprint := range before {
		if after[table] != fingerprint {
			t.Fatalf("GET or suggestion changed rows in %s", table)
		}
	}
}

func firstRunDatabaseRows(t *testing.T, db *sql.DB) map[string]string {
	t.Helper()
	rows, err := db.Query(`SELECT format('%I.%I',n.nspname,c.relname)
		FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
		WHERE c.relkind IN ('r','p') AND n.nspname NOT LIKE 'pg_%'
		AND n.nspname <> 'information_schema' ORDER BY 1`)
	if err != nil {
		t.Fatal(err)
	}
	var tables []string
	for rows.Next() {
		var table string
		if err = rows.Scan(&table); err != nil {
			t.Fatal(err)
		}
		tables = append(tables, table)
	}
	if err = rows.Err(); err != nil {
		t.Fatal(err)
	}
	rows.Close() // Release the only connection before reading table contents.
	result := make(map[string]string, len(tables))
	for _, table := range tables {
		var fingerprint string
		query := fmt.Sprintf(`SELECT md5(COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text)::text,'[]')) FROM %s r`, table)
		if err = db.QueryRow(query).Scan(&fingerprint); err != nil {
			t.Fatalf("snapshot %s: %v", table, err)
		}
		result[table] = fingerprint
	}
	return result
}
