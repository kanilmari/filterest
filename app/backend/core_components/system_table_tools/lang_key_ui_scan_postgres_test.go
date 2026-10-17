// lang_key_ui_scan_postgres_test.go
// Proves literal scan trust through the real public translation handler.
// Connects scanner generations, partial writes, cleanup and creator re-binding.
// Uses only opt-in disposable PostgreSQL and removes all fixture state on exit.
package system_table_tools

import (
	"database/sql"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"easelect/backend/core_components/lang"
	e_sessions "easelect/backend/core_components/sessions"
	"github.com/gorilla/sessions"
)

const uiScanFixturePath = "frontend/core_components/filterbar/top_row_buttons/sort_default_scope_modal_builder.js"

func uiScanPostgresFixture(t *testing.T) *sql.DB {
	t.Helper()
	db := scanTrustPostgresFixture(t)
	db.SetMaxOpenConns(4)
	t.Setenv("DEV_MODE", "false")
	oldStore := e_sessions.Store
	e_sessions.Store = sessions.NewCookieStore([]byte("wo42-disposable-translation-fixture"))
	t.Cleanup(func() { e_sessions.Store = oldStore })
	frontPageExec(t, db, `ALTER TABLE system_config ADD COLUMN boolean_value boolean;
 ALTER TABLE system_lang_keys ADD COLUMN fi text, ADD COLUMN ch text, ADD COLUMN yue text,
   ADD COLUMN creation_spec text, ADD COLUMN updated timestamptz;
 ALTER TABLE system_db_tables ADD COLUMN schema_name text DEFAULT 'public', ADD COLUMN ui_hidden boolean DEFAULT false;
 ALTER TABLE system_column_details ADD COLUMN hide_everywhere boolean DEFAULT false, ADD COLUMN client_delivery_mode text DEFAULT 'include';
 CREATE TABLE system_languages(language_code text,fallback_language_code text,is_enabled boolean);
 INSERT INTO system_languages VALUES('en',NULL,true),('fi',NULL,true);
 SELECT setval(pg_get_serial_sequence('system_lang_keys','id'),(SELECT max(id) FROM system_lang_keys));
 ALTER TABLE system_lang_key_translations ADD COLUMN language_code text, ADD COLUMN source_kind text,
   ADD COLUMN review_status text, ADD COLUMN updated timestamptz, ADD UNIQUE(lang_key_id,language_code);
 CREATE TABLE system_user_group_memberships(user_id integer,group_id integer);
 CREATE TABLE system_functions(id integer,url_route_endpoint text,disabled boolean);
 CREATE TABLE system_group_table_func_rights(user_group_id integer,function_id integer,target_table_uid integer);
 INSERT INTO system_user_group_memberships VALUES(1,3);
 INSERT INTO system_functions VALUES(1,'/api/get-results',false),(2,'/api/tree_data',false);
 INSERT INTO system_lang_keys(lang_key,en) VALUES('status','Status'),('about','About');
 INSERT INTO system_table_folders VALUES('about');
 INSERT INTO system_lang_key_sources(lang_key_id,source_type,source_high,source_low,last_seen)
 SELECT id,'folder','about','about',CURRENT_DATE FROM system_lang_keys WHERE lang_key='about';`)
	writeUIScanFile(t, `t('status'); t('about');`)
	return db
}

func writeUIScanFile(t *testing.T, content string) {
	t.Helper()
	path := filepath.Join(currentLangKeyRuntimePaths().ApplicationRoot, filepath.FromSlash(uiScanFixturePath))
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
}

func assertUIGuest(t *testing.T, key string, want bool) {
	t.Helper()
	response := httptest.NewRecorder()
	lang.GetTranslationsHandler(response, httptest.NewRequest("GET", "/api/translations?lang=en", nil))
	var values map[string]string
	if err := json.Unmarshal(response.Body.Bytes(), &values); err != nil {
		t.Fatal(err, response.Body.String())
	}
	_, has := values[key]
	if response.Code != 200 || has != want {
		t.Fatalf("guest %s present=%v want=%v; map=%v", key, has, want, values)
	}
	if response.Header().Get("Cache-Control") != "private, no-store" || response.Header().Get("Vary") != "Cookie" {
		t.Fatal(response.Header())
	}
}

func privateStatusAfterUIScan(t *testing.T, db *sql.DB) {
	t.Helper()
	frontPageExec(t, db, `CREATE TABLE zz_private_status(id integer,status text);
 INSERT INTO system_db_tables VALUES(71,'zz_private_status','public',false);
 INSERT INTO system_column_details(table_uid,column_name) VALUES(71,'status');`)
	if err := lang.EnsureDatasetInterfaceLabels(db, "zz_private_status", []string{"status"}); err != nil {
		t.Fatal(err)
	}
}

func completeUIScan(t *testing.T) {
	t.Helper()
	if _, err := PopulateLangKeySources(); err != nil || !SourceScanIsFresh() {
		t.Fatal(err)
	}
}

func startUIScan(t *testing.T, db *sql.DB) uiLiteralScanAttempt {
	t.Helper()
	_, fp, err := langKeyCodeInventory()
	if err != nil {
		t.Fatal(err)
	}
	attempt, err := beginUILiteralScan(db, fp)
	if err != nil {
		t.Fatal(err)
	}
	return attempt
}

func TestUILiteralFolderAndPostScanPrivateColumnPostgres(t *testing.T) {
	db := uiScanPostgresFixture(t)
	assertUIGuest(t, "about", false)
	completeUIScan(t)
	assertUIGuest(t, "about", true)
	privateStatusAfterUIScan(t, db)
	assertUIGuest(t, "status", true)
	if frontPageCount(t, db, `SELECT count(*) FROM system_lang_key_sources s JOIN system_lang_keys k ON k.id=s.lang_key_id WHERE k.lang_key='status' AND s.source_type='column'`) == 0 {
		t.Fatal("creator did not rebind")
	}
}

func TestUILiteralUnchangedMidScanAndFailedAttemptPostgres(t *testing.T) {
	db := uiScanPostgresFixture(t)
	completeUIScan(t)
	attempt := startUIScan(t, db)
	privateStatusAfterUIScan(t, db)
	// Rewrite only status; about remains on the completed generation.
	var id int64
	if err := db.QueryRow(`SELECT id FROM system_lang_keys WHERE lang_key='status'`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if err := upsertSource(id, "code", "app/"+uiScanFixturePath, attempt.marker()); err != nil {
		t.Fatal(err)
	}
	assertUIGuest(t, "status", true)
	assertUIGuest(t, "about", true)
	if err := requireUILiteralCompletion(attempt, db); err != nil {
		t.Fatal(err)
	}
	assertUIGuest(t, "status", true)
	// Completion trusts this generation only; about was deliberately not rewritten.
	assertUIGuest(t, "about", false)
	failed := startUIScan(t, db)
	if _, err := failed.finish(db, false); err != nil {
		t.Fatal(err)
	}
	assertUIGuest(t, "status", false)
}

func TestUILiteralRemovalThenChangedRunningOrPartialScanPostgres(t *testing.T) {
	for _, failed := range []bool{false, true} {
		t.Run(map[bool]string{false: "running", true: "partial"}[failed], func(t *testing.T) {
			db := uiScanPostgresFixture(t)
			completeUIScan(t)
			writeUIScanFile(t, `t('about'); // status removed`)
			if failed {
				frontPageExec(t, db, `ALTER TABLE system_table_views RENAME TO missing_views`)
				if _, err := PopulateLangKeySources(); err == nil {
					t.Fatal("partial scan accepted")
				}
			} else {
				startUIScan(t, db)
			}
			privateStatusAfterUIScan(t, db)
			assertUIGuest(t, "status", false)
		})
	}
}

func TestUILiteralOlderCompletionAndFailureCASPostgres(t *testing.T) {
	db := uiScanPostgresFixture(t)
	completeUIScan(t)
	privateStatusAfterUIScan(t, db)
	old := startUIScan(t, db)
	writeUIScanFile(t, `t('about'); // changed generation inputs`)
	newer := startUIScan(t, db)
	if updated, err := old.finish(db, true); err != nil || updated {
		t.Fatal("older completion replaced attempt", updated, err)
	}
	if updated, err := old.finish(db, false); err != nil || updated {
		t.Fatal("older failure replaced attempt", updated, err)
	}
	assertUIGuest(t, "status", false)
	var aboutID int64
	if err := db.QueryRow(`SELECT id FROM system_lang_keys WHERE lang_key='about'`).Scan(&aboutID); err != nil {
		t.Fatal(err)
	}
	if err := upsertSource(aboutID, "code", "app/"+uiScanFixturePath, newer.marker()); err != nil {
		t.Fatal(err)
	}
	assertUIGuest(t, "about", false)
	// The newer generation can complete; status has no evidence in that scan.
	if err := requireUILiteralCompletion(newer, db); err != nil {
		t.Fatal(err)
	}
	assertUIGuest(t, "status", false)
	assertUIGuest(t, "about", true)
	if updated, err := old.finish(db, true); err != nil || updated {
		t.Fatal("late older completion replaced completed newer attempt", updated, err)
	}
	assertUIGuest(t, "about", true)
	// A real scan of the reduced code trips B2's sanity floor (2 code keys below 90% of the seven-day maximum 3):
	// it is blocked, records its own attempt as failed and withdraws the literal exemption (fail closed).
	if _, err := PopulateLangKeySources(); err != nil || SourceScanIsFresh() {
		t.Fatal("suspicious scan was not blocked", err)
	}
	assertUIGuest(t, "about", false)
	assertUIGuest(t, "status", false)
}

func TestUILiteralMissingMalformedAndStaleTrustPostgres(t *testing.T) {
	db := uiScanPostgresFixture(t)
	completeUIScan(t)
	privateStatusAfterUIScan(t, db)
	var state string
	if err := db.QueryRow(`SELECT json_value::text FROM system_config WHERE key='lang_key_ui_scan'`).Scan(&state); err != nil {
		t.Fatal(err)
	}
	for _, mutation := range []string{
		`DELETE FROM system_config WHERE key='lang_key_ui_scan'`,
		`UPDATE system_config SET json_value=json_value-'complete_generation' WHERE key='lang_key_ui_scan'`,
		`UPDATE system_config SET json_value=json_value-'complete_fingerprint' WHERE key='lang_key_ui_scan'`,
		`UPDATE system_config SET json_value=jsonb_set(json_value,'{attempt,fingerprint}','""') WHERE key='lang_key_ui_scan'`,
		`UPDATE system_config SET json_value=jsonb_set(json_value,'{attempt,generation}','"mismatch"') WHERE key='lang_key_ui_scan'`,
		`UPDATE system_config SET json_value=jsonb_set(json_value,'{attempt,state}','"failed"') WHERE key='lang_key_ui_scan'`,
	} {
		if _, err := db.Exec(`INSERT INTO system_config(key,json_value,value_type) VALUES('lang_key_ui_scan',$1::jsonb,5)
    ON CONFLICT(key) DO UPDATE SET json_value=EXCLUDED.json_value`, state); err != nil {
			t.Fatal(err)
		}
		frontPageExec(t, db, mutation)
		assertUIGuest(t, "status", false)
	}
	if _, err := db.Exec(`UPDATE system_config SET json_value=$1::jsonb WHERE key='lang_key_ui_scan'`, state); err != nil {
		t.Fatal(err)
	}
	frontPageExec(t, db, `UPDATE system_lang_key_sources SET last_seen=CURRENT_DATE-7 WHERE source_type='code' AND source_low LIKE 'ui_literal_v1:%'`)
	assertUIGuest(t, "status", true)
	frontPageExec(t, db, `UPDATE system_lang_key_sources SET last_seen=CURRENT_DATE-8 WHERE source_type='code' AND source_low LIKE 'ui_literal_v1:%'`)
	assertUIGuest(t, "status", false)
	if _, err := deleteStaleLangKeySources(); err != nil {
		t.Fatal(err)
	}
	if frontPageCount(t, db, `SELECT count(*) FROM system_lang_key_sources WHERE source_low LIKE 'ui_literal_v1:%'`) != 0 {
		t.Fatal("expired literal survived cleanup")
	}
	// At the seven-day boundary, cleanup must retain the row too.
	frontPageExec(t, db, `INSERT INTO system_lang_key_sources(lang_key_id,source_type,source_high,source_low,last_seen)
 SELECT id,'code','boundary.js','ui_literal_v1:boundary',CURRENT_DATE-7 FROM system_lang_keys WHERE lang_key='status'`)
	if _, err := deleteStaleLangKeySources(); err != nil {
		t.Fatal(err)
	}
	if frontPageCount(t, db, `SELECT count(*) FROM system_lang_key_sources WHERE source_high='boundary.js'`) != 1 {
		t.Fatal("boundary row deleted")
	}
}

func TestUILiteralSuspiciousAndCleanupFailureBlockCompletionPostgres(t *testing.T) {
	for _, failure := range []string{"floor", "cleanup"} {
		t.Run(failure, func(t *testing.T) {
			db := uiScanPostgresFixture(t)
			completeUIScan(t)
			privateStatusAfterUIScan(t, db)
			if failure == "floor" {
				if _, _, err := recordCodeSourceCount(db, 100, timeNowUTC()); err != nil {
					t.Fatal(err)
				}
			} else {
				frontPageExec(t, db, `CREATE FUNCTION refuse_ui_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'injected cleanup failure'; END$$;
    CREATE TRIGGER refuse_ui_cleanup BEFORE DELETE ON system_lang_key_sources FOR EACH ROW EXECUTE FUNCTION refuse_ui_cleanup();
    INSERT INTO system_lang_key_sources(lang_key_id,source_type,source_high,last_seen) VALUES(1,'code','expired_cleanup.js',CURRENT_DATE-8);`)
			}
			_, err := PopulateLangKeySources()
			if failure == "cleanup" && err == nil {
				t.Fatal("cleanup error swallowed")
			}
			if SourceScanIsFresh() {
				t.Fatal("blocked scan advanced freshness")
			}
			assertUIGuest(t, "status", false)
			var state string
			if err := db.QueryRow(`SELECT json_value #>> '{attempt,state}' FROM system_config WHERE key='lang_key_ui_scan'`).Scan(&state); err != nil || state != "failed" {
				t.Fatal(state, err)
			}
		})
	}
}

func TestUILiteralScanAdvisorySerializationPostgres(t *testing.T) {
	db := uiScanPostgresFixture(t)
	first, err := lockUILiteralScan(db)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Rollback()
	second, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer second.Rollback()
	var acquired bool
	const query = `SELECT pg_try_advisory_xact_lock(hashtextextended('lang_key_ui_scan',0))`
	if err := second.QueryRow(query).Scan(&acquired); err != nil || acquired {
		t.Fatal("scan not serialized", acquired, err)
	}
	if err := first.Rollback(); err != nil {
		t.Fatal(err)
	}
	if err := second.QueryRow(query).Scan(&acquired); err != nil || !acquired {
		t.Fatal("lock not released", acquired, err)
	}
}
