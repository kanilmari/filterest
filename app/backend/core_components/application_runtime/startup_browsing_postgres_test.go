// startup_browsing_postgres_test.go
// Runs the shipped bootstrap and every required startup step on isolated PostgreSQL.
// Custom limited roles begin without coarse grants; real HTTP readers prove browsing.
// Malformed relationships survive discovery and appear in the final policy audit.
package application_runtime

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	reads "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	"easelect/backend/core_components/middlewares"
	"easelect/backend/core_components/router"
	"easelect/backend/core_components/runtime_grants"
	esessions "easelect/backend/core_components/sessions"
	"github.com/gorilla/sessions"
	"github.com/lib/pq"
)

func bootstrapStartupFixture(t *testing.T) (*sql.DB, runtime_grants.RoleConfiguration) {
	t.Helper()
	if os.Getenv("FILTEREST_TEST_DISPOSABLE_POSTGRES") != "1" {
		t.Skip("sandbox: PostgreSQL disabled; set FILTEREST_TEST_DISPOSABLE_POSTGRES=1 outside the sandbox")
	}
	root := t.TempDir()
	socket := filepath.Join(root, "socket")
	if err := os.Mkdir(socket, 0700); err != nil {
		t.Fatal(err)
	}
	bin := "/usr/lib/postgresql/16/bin/"
	data := filepath.Join(root, "db")
	run := func(name string, args ...string) {
		t.Helper()
		if output, err := exec.Command(bin+name, args...).CombinedOutput(); err != nil {
			t.Fatalf("%s: %v: %s", name, err, output)
		}
	}
	run("initdb", "-D", data, "-A", "trust", "-U", "fixture_owner", "--no-locale", "--encoding=UTF8")
	run("pg_ctl", "-D", data, "-l", filepath.Join(root, "postgres.log"), "-o", "-h '' -k '"+socket+"' -p 15463", "-w", "start")
	t.Cleanup(func() {
		output, err := exec.Command(bin+"pg_ctl", "-D", data, "-m", "immediate", "-w", "stop").CombinedOutput()
		if err != nil {
			t.Errorf("stop: %v %s", err, output)
		}
	})
	connect := func(role string) *sql.DB {
		t.Helper()
		db, err := sql.Open("postgres", "host="+socket+" port=15463 user='"+role+"' dbname=postgres sslmode=disable")
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { db.Close() })
		if err := db.Ping(); err != nil {
			t.Fatal(err)
		}
		return db
	}
	owner := connect("fixture_owner")
	config := runtime_grants.RoleConfiguration{Names: map[string]string{}, ProtectedNames: []string{"fixture_owner"}}
	t.Setenv("DB_ADMIN_USER", "fixture_owner")
	t.Setenv("DB_USER", "")
	t.Setenv("ENABLE_SQL_MIGRATIONS", "1")
	t.Setenv("FILTEREST_APPLY_PERMISSION_CLEANUP", "")
	t.Setenv("FILTEREST_DEV_ADMIN_USERNAME", "")
	t.Setenv("FILTEREST_DEV_ADMIN_PASSWORD", "")
	for label, key := range map[string]string{"basic": "DB_BASIC_USER", "guest": "DB_GUEST_USER", "readonly": "DB_READONLY_USER", "confidential": "DB_CONFIDENTIAL_USER"} {
		name := `boot ` + label + ` "custom"`
		config.Names[label] = name
		t.Setenv(key, name)
		if _, err := owner.Exec("CREATE ROLE " + pq.QuoteIdentifier(name) + " LOGIN"); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range []string{"schema.sql", "seed_data.sql"} {
		bytes, err := os.ReadFile(filepath.Join("..", "..", "..", "server_tools", "public_bootstrap", name))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := owner.Exec(string(bytes)); err != nil {
			t.Fatal(name, err)
		}
	}
	// Imported schema/seed can contain narrowly scoped legacy role grants. None
	// of the configured custom roles exist in those fragments; start with none.
	for _, name := range config.Names {
		if _, err := owner.Exec("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM " + pq.QuoteIdentifier(name)); err != nil {
			t.Fatal(err)
		}
	}
	previous := []*sql.DB{backend.Db, backend.DbAdmin, backend.DbLifecycle, backend.DbBasic, backend.DbGuest, backend.DbReaderOnly, backend.DbConfidential}
	backend.Db, backend.DbAdmin, backend.DbLifecycle = owner, owner, connect("fixture_owner")
	backend.DbLifecycle.SetMaxOpenConns(2)
	backend.DbBasic, backend.DbGuest, backend.DbReaderOnly, backend.DbConfidential = connect(config.Names["basic"]), connect(config.Names["guest"]), connect(config.Names["readonly"]), connect(config.Names["confidential"])
	oldStore := esessions.Store
	esessions.Store = sessions.NewCookieStore([]byte("startup-bootstrap-proof"))
	t.Cleanup(func() {
		backend.Db, backend.DbAdmin, backend.DbLifecycle, backend.DbBasic, backend.DbGuest, backend.DbReaderOnly, backend.DbConfidential = previous[0], previous[1], previous[2], previous[3], previous[4], previous[5], previous[6]
		esessions.Store = oldStore
	})
	// The production startup registers its routes on the default mux, which allows each pattern once per process.
	previousMux := http.DefaultServeMux
	http.DefaultServeMux = http.NewServeMux()
	t.Cleanup(func() { http.DefaultServeMux = previousMux })
	router.RegisterRoutes("", t.TempDir())
	return owner, config
}

// connectFixtureRole opens the fixture cluster as another login role through the owner's socket and port.
func connectFixtureRole(t *testing.T, owner *sql.DB, role string) *sql.DB {
	t.Helper()
	var socket string
	var port int
	if err := owner.QueryRow(`SELECT current_setting('unix_socket_directories'),current_setting('port')::int`).Scan(&socket, &port); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("postgres", fmt.Sprintf("host=%s port=%d user='%s' dbname=postgres sslmode=disable", socket, port, role))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func runBootstrapStartup(t *testing.T) {
	t.Helper()
	root, err := filepath.Abs("../../..")
	if err != nil {
		t.Fatal(err)
	}
	err = runtime_grants.WithStartupBarrier(context.Background(), backend.DbLifecycle, func() error { return runRequiredStartup(requiredStartupSteps(root, Options{}, "production")) })
	if err != nil {
		t.Fatal("full required startup refused", err)
	}
}

func TestFreshBootstrapBasicAndGuestBrowseArticleSearchPostgres(t *testing.T) {
	owner, config := bootstrapStartupFixture(t)
	if _, err := owner.Exec(`INSERT INTO system_users(id,username,enabled,main_group_id) VALUES(501,'bootstrap_reader',true,2); INSERT INTO system_user_group_memberships(user_id,group_id) VALUES(501,2)`); err != nil {
		t.Fatal(err)
	}
	// These roles have no metadata privilege before the production startup entry.
	for _, label := range []string{"basic", "guest"} {
		var read bool
		if err := owner.QueryRow(`SELECT has_table_privilege($1,'system_config','SELECT')`, config.Names[label]).Scan(&read); err != nil || read {
			t.Fatal("fixture contains coarse reads", label, read, err)
		}
	}
	runBootstrapStartup(t)
	for _, label := range []string{"basic", "guest"} {
		uid := 501
		if label == "guest" {
			uid = 1
		}
		for _, query := range []string{"", "&view_key=card", "&view_key=article_view&id=1", "&search=1"} {
			req := httptest.NewRequest("GET", "/api/get-results?dataset=palvelukatalogi"+query, nil)
			req = req.WithContext(dbutils.SetRequestActorContext(req.Context(), dbutils.NewRequestActorContext(uid, label)))
			session, err := esessions.Load(req)
			if err != nil {
				t.Fatal(err)
			}
			session.Values["user_id"] = uid
			session.Values["user_role"] = label
			response := httptest.NewRecorder()
			middlewares.WithStartupRequestBarrier(middlewares.WithLazyTransaction(http.HandlerFunc(reads.GetResultsHandlerWrapper))).ServeHTTP(response, req)
			if response.Code != 200 || !strings.Contains(response.Body.String(), `"data"`) {
				t.Fatalf("%s browsing %s failed: %d %s", label, query, response.Code, response.Body.String())
			}
			var payload struct {
				Data []json.RawMessage `json:"data"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil || len(payload.Data) == 0 {
				t.Fatalf("%s browse/article/search returned no starter row for %s: %v %s", label, query, err, response.Body.String())
			}
		}
		// Audit every declared metadata object actually present in the bootstrap,
		// and refuse write privileges on the new read-only contracts.
		for _, name := range []string{"system_config", "system_column_details", "system_table_views", "system_foreign_key_relations_1_m", "system_foreign_key_relations_m_m", "system_db_tables"} {
			var write bool
			if err := owner.QueryRow(`SELECT has_table_privilege($1,$2,'INSERT,UPDATE,DELETE')`, config.Names[label], name).Scan(&write); err != nil || write {
				t.Fatal("metadata write granted", label, name, err)
			}
		}
	}
}

func TestFullStartupPreservesNullAndInvalidRelationshipColumnsPostgres(t *testing.T) {
	owner, config := bootstrapStartupFixture(t)
	// All referenced dataset identities are valid. Nullable/missing columns are
	// the only fault, so this catches the discovery failure before reconciliation.
	var one, many int64
	if err := owner.QueryRow(`INSERT INTO system_foreign_key_relations_1_m(source_table_uid,target_table_uid,source_column_name,target_column_name) VALUES(7,10,NULL,'id') RETURNING id`).Scan(&one); err != nil {
		t.Fatal(err)
	}
	if err := owner.QueryRow(`INSERT INTO system_foreign_key_relations_m_m(bridging_table_uid,table_a_uid,table_b_uid,bridging_col_a,bridging_col_b,table_a_column,table_b_column) VALUES(7,8,10,'missing_legacy_column',NULL,'id','id') RETURNING id`).Scan(&many); err != nil {
		t.Fatal(err)
	}
	runBootstrapStartup(t)
	for name, id := range map[string]int64{"system_foreign_key_relations_1_m": one, "system_foreign_key_relations_m_m": many} {
		var count int
		if err := owner.QueryRow("SELECT count(*) FROM "+pq.QuoteIdentifier(name)+" WHERE id=$1", id).Scan(&count); err != nil || count != 1 {
			t.Fatal("startup lost malformed row", name, count, err)
		}
	}
	// The audit refuses identities that may write, so it runs as a separate read-only login.
	const auditRole = "startup independent audit"
	for _, statement := range []string{"CREATE ROLE " + pq.QuoteIdentifier(auditRole) + " LOGIN", `REVOKE CREATE ON SCHEMA public FROM PUBLIC`,
		"GRANT SELECT ON ALL TABLES IN SCHEMA public TO " + pq.QuoteIdentifier(auditRole)} {
		if _, err := owner.Exec(statement); err != nil {
			t.Fatal(statement, err)
		}
	}
	findings, err := runtime_grants.AuditRuntimeGrants(context.Background(), connectFixtureRole(t, owner, auditRole), config)
	if err != nil {
		t.Fatal(err)
	}
	for name, id := range map[string]int64{"system_foreign_key_relations_1_m": one, "system_foreign_key_relations_m_m": many} {
		found := false
		for _, f := range findings {
			if strings.Contains(f.Object, name) && strings.Contains(f.Reason, fmt.Sprintf("id %d:", id)) && f.Finding == "blocker" {
				found = true
			}
		}
		if !found {
			t.Fatalf("audit omitted preserved %s row %d", name, id)
		}
	}
}
