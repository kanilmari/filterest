// translation_scope_postgres_test.go
// Reproduces translation visibility after startup against the real public schema.
// Connects bootstrap storage foreign keys, source population and the HTTP reader.
// Uses an opt-in disposable cluster and only a scratch copy of pre-login sources.
package startup

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/lang"
	"easelect/backend/core_components/lang_key_naming"
	"easelect/backend/core_components/runtimepaths"
	e_sessions "easelect/backend/core_components/sessions"
	"easelect/backend/core_components/system_table_tools"
	"easelect/backend/pipeline/access_control"
	"github.com/gorilla/sessions"
	_ "github.com/lib/pq"
)

func translationBootstrapDB(t *testing.T) *sql.DB {
	t.Helper()
	if os.Getenv("FILTEREST_TEST_DISPOSABLE_POSTGRES") != "1" {
		t.Skip("set FILTEREST_TEST_DISPOSABLE_POSTGRES=1 for the real bootstrap/source-scanner proof")
	}
	bin := os.Getenv("PG_TEST_BIN")
	if bin == "" {
		bin = "/usr/lib/postgresql/16/bin"
	}
	root := t.TempDir()
	socket, data := filepath.Join(root, "socket"), filepath.Join(root, "db")
	if err := os.Mkdir(socket, 0700); err != nil {
		t.Fatal(err)
	}
	run := func(name string, args ...string) {
		t.Helper()
		if output, err := exec.Command(filepath.Join(bin, name), args...).CombinedOutput(); err != nil {
			t.Fatalf("%s: %v %s", name, err, output)
		}
	}
	run("initdb", "-D", data, "-A", "trust", "-U", "fixture_owner", "--no-locale", "--encoding=UTF8")
	// Register shutdown before starting, including a partially failed start.
	t.Cleanup(func() {
		if output, err := exec.Command(filepath.Join(bin, "pg_ctl"), "-D", data, "-m", "immediate", "-w", "stop").CombinedOutput(); err != nil && !strings.Contains(string(output), "Is server running?") {
			t.Errorf("stop disposable PostgreSQL: %v %s", err, output)
		}
	})
	run("pg_ctl", "-D", data, "-l", filepath.Join(root, "postgres.log"), "-o", "-h '' -k '"+socket+"' -p 15599", "-w", "start")
	db, err := sql.Open("postgres", fmt.Sprintf("host=%s port=15599 user=fixture_owner dbname=postgres sslmode=disable", socket))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	for _, file := range []string{"schema.sql", "seed_data.sql"} {
		raw, err := os.ReadFile(filepath.Join("..", "..", "..", "server_tools", "public_bootstrap", file))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(string(raw)); err != nil {
			t.Fatalf("bootstrap %s: %v", file, err)
		}
	}
	oldDB, oldStore := backend.Db, e_sessions.Store
	backend.Db, e_sessions.Store = db, sessions.NewCookieStore([]byte("bootstrap-translations-test-signing"))
	t.Cleanup(func() { backend.Db, e_sessions.Store = oldDB, oldStore })
	return db
}

func TestTranslationsAfterBootstrapSourcePopulationPostgres(t *testing.T) {
	db := translationBootstrapDB(t)
	t.Setenv("DEV_MODE", "false")
	execSQL := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(query, args...); err != nil {
			t.Fatal(err)
		}
	}
	EnsureLoginPageLangKeys(db)
	template, err := os.ReadFile(filepath.Join("..", "..", "..", "frontend", "templates", "login.html"))
	if err != nil {
		t.Fatal(err)
	}
	prelogin := map[string]bool{"login": true}
	for _, seed := range loginPageLangKeySeeds {
		prelogin[seed.langKey] = true
	}
	markup := regexp.MustCompile(`(?s)<!--.*?-->`).ReplaceAll(template, nil)
	for _, match := range regexp.MustCompile(`data-(?:[a-z-]*-)?lang-key="([a-z][a-z0-9_]*)`).FindAllSubmatch(markup, -1) {
		prelogin[string(match[1])] = true
	}
	for key := range prelogin {
		// Some controls are authored only on demand rather than in bootstrap.
		// Give those controls fixture copy so EVERY pre-login name tests scoping.
		execSQL(`INSERT INTO system_lang_keys(lang_key,fi,en) VALUES($1,$2,$3) ON CONFLICT(lang_key) DO NOTHING`, key, "Fixture FI: "+key, "Fixture EN: "+key)
	}
	if len(prelogin) < 20 {
		t.Fatal("pre-login surface was not collected", prelogin)
	}
	execSQL(`CREATE TABLE sec2_reader_records(id bigint PRIMARY KEY,sec2_reader_label text,label_key_id bigint REFERENCES system_lang_keys(id));
CREATE TABLE sec2_private_records(id bigint PRIMARY KEY,sec2_private_label text,label_key_id bigint REFERENCES system_lang_keys(id));
INSERT INTO system_db_tables(table_name,schema_name,folder_id,is_main_table)
VALUES('sec2_reader_records','public',1,true),('sec2_private_records','public',1,true);
INSERT INTO system_column_details(table_uid,column_name)
SELECT table_uid,column_name FROM system_db_tables d JOIN information_schema.columns c
ON c.table_schema='public' AND c.table_name=d.table_name WHERE d.table_name IN ('sec2_reader_records','sec2_private_records');
INSERT INTO system_lang_keys(lang_key,fi,en) VALUES
('sec2_domain_reader_key','Lukijan arvo','Reader value'),('sec2_domain_private_key','Yksityinen arvo','Private value'),
('confidential_mergers_asc','Luottamuksellinen nouseva','Confidential ascending'),
('confidential_mergers_desc','Luottamuksellinen laskeva','Confidential descending');
INSERT INTO sec2_reader_records(id,label_key_id) SELECT 1,id FROM system_lang_keys WHERE lang_key='sec2_domain_reader_key';
INSERT INTO sec2_private_records(id,label_key_id) SELECT 1,id FROM system_lang_keys WHERE lang_key='sec2_domain_private_key';
UPDATE system_config SET boolean_value=true WHERE key='login_to_browse';`)
	for _, dataset := range []string{"sec2_reader_records", "sec2_private_records"} {
		column := strings.Replace(dataset, "records", "label", 1)
		if err := lang.EnsureDatasetInterfaceLabels(db, dataset, []string{column}); err != nil {
			t.Fatal(err)
		}
	}
	// Populate normalized storage for the startup-only copy too. The REAL
	// bootstrap FK must then produce a storage source for every key under test.
	execSQL(`INSERT INTO system_lang_key_translations(lang_key_id,language_code,translation,source_kind,review_status)
SELECT k.id,l.code,l.copy,'manual','approved' FROM system_lang_keys k
CROSS JOIN LATERAL (VALUES('fi',k.fi),('en',k.en)) l(code,copy)
WHERE NULLIF(btrim(l.copy),'') IS NOT NULL ON CONFLICT(lang_key_id,language_code) DO NOTHING`)
	// Force these labels through normalized storage rather than legacy columns.
	execSQL(`UPDATE system_lang_keys SET fi=NULL,en=NULL WHERE lang_key IN
('sec2_reader_label','sec2_reader_records','add_row_sec2_reader_records','search_for_sec2_reader_records')`)

	// Scan the real login template in a scratch source tree. This avoids reading
	// operator files while exercising PopulateLangKeySources, not a mock scan.
	installation := t.TempDir()
	appRoot := filepath.Join(installation, "app")
	for _, dir := range []string{"frontend", "backend"} {
		if err := os.MkdirAll(filepath.Join(appRoot, dir), 0700); err != nil {
			t.Fatal(err)
		}
	}
	for file, raw := range map[string][]byte{"go.mod": []byte("test\n"), "VERSION_APP": []byte("test\n"), "frontend/login.html": template} {
		if err := os.WriteFile(filepath.Join(appRoot, file), raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
	oldPaths := runtimepaths.Current()
	for _, path := range []*string{&oldPaths.InstallationRoot, &oldPaths.ApplicationRoot, &oldPaths.DataRoot, &oldPaths.StorageRoot, &oldPaths.StorageDeletedRoot, &oldPaths.RuntimeRoot} {
		*path, err = filepath.Abs(*path)
		if err != nil {
			t.Fatal(err)
		}
	}
	paths, err := runtimepaths.Resolve(appRoot, installation, true)
	if err != nil {
		t.Fatal(err)
	}
	if err := runtimepaths.Configure(paths); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := runtimepaths.Configure(oldPaths); err != nil {
			t.Error(err)
		}
	})
	if _, err := system_table_tools.PopulateLangKeySources(); err != nil {
		t.Fatal(err)
	}
	assertStorageSource := func(key string) {
		t.Helper()
		var found bool
		if err := db.QueryRow(`SELECT EXISTS(SELECT 1 FROM system_lang_key_sources s JOIN system_lang_keys k ON k.id=s.lang_key_id
WHERE k.lang_key=$1 AND source_type='foreign_key' AND source_high='public.system_lang_key_translations.lang_key_id')`, key).Scan(&found); err != nil || !found {
			t.Fatal("real storage FK was not scanned", key, err)
		}
	}
	for key := range prelogin {
		assertStorageSource(key)
	}
	assertStorageSource("sec2_reader_label")
	for _, locale := range []string{"fi", "en"} {
		baseline, err := lang.ReadDisplayTranslations(locale)
		if err != nil {
			t.Fatal(err)
		}
		check := func(reader bool) {
			t.Helper()
			if reader {
				readable, err := access_control.GetTablesReadableByUser(db, 1)
				if err != nil {
					t.Fatal(err)
				}
				var storageUID int
				err = db.QueryRow(`SELECT COALESCE((SELECT table_uid FROM system_db_tables WHERE table_name='system_lang_key_translations' AND schema_name='public'),0)`).Scan(&storageUID)
				if err != nil || readable[storageUID] {
					t.Fatal("fixture unexpectedly grants translation-storage access", storageUID, err)
				}
			}
			response := httptest.NewRecorder()
			lang.GetTranslationsHandler(response, httptest.NewRequest("GET", "/api/translations?lang="+locale, nil))
			var body map[string]string
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil || response.Code != 200 {
				t.Fatal("translation response", response.Code, err)
			}
			for key := range prelogin {
				if strings.TrimSpace(baseline[key]) == "" || body[key] != baseline[key] {
					t.Errorf("pre-login copy lost (%s): %s", locale, key)
				}
			}
			for _, key := range append(lang_key_naming.DatasetOwnedKeyNames("sec2_reader_records"), "sec2_reader_records", "sec2_reader_label", "sec2_domain_reader_key") {
				if (body[key] != "") != reader || (reader && body[key] != baseline[key]) {
					t.Errorf("wrong reader label visibility (%s, reader=%v): %s", locale, reader, key)
				}
			}
			for _, key := range append(lang_key_naming.DatasetOwnedKeyNames("sec2_private_records"), "sec2_private_records", "sec2_private_label", "sec2_domain_private_key", "confidential_mergers_asc", "confidential_mergers_desc") {
				if _, leaked := body[key]; leaked {
					t.Errorf("private/unresolved label exposed (%s): %s", locale, key)
				}
			}
		}
		execSQL(`UPDATE system_config SET boolean_value=true WHERE key='login_to_browse'`)
		check(false)
		// A guest with one dataset read grant is an ordinary dataset reader.
		// No grant to the translation-storage dataset is added.
		execSQL(`UPDATE system_config SET boolean_value=false WHERE key='login_to_browse';
INSERT INTO system_group_table_func_rights(user_group_id,function_id,target_table_uid)
SELECT g.id,f.id,d.table_uid FROM system_user_groups g CROSS JOIN system_functions f CROSS JOIN system_db_tables d
WHERE g.name='guests' AND f.url_route_endpoint='/api/get-results' AND d.table_name='sec2_reader_records'
AND NOT EXISTS(SELECT 1 FROM system_group_table_func_rights r WHERE r.user_group_id=g.id AND r.function_id=f.id AND r.target_table_uid=d.table_uid)`)
		check(true)
	}
}
