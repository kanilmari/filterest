// setting_writers_postgres_test.go
// Exercises generic settings writers and the language seed on a disposable site.
// Reuses the existing isolated PostgreSQL, public bootstrap and request transaction pattern.
// Exists to prove refused saves return 400 and leave the whole transaction unchanged.
package dtt_crud_workflows_test

import (
	"bytes"
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	devtools "easelect/backend/core_components/dev_tools"
	create "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_create"
	update "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_update"
	workflows "easelect/backend/core_components/dynamic_table_tools/dtt_crud_workflows"
	"easelect/backend/core_components/lang"
	"easelect/backend/core_components/runtimepaths"
	e_sessions "easelect/backend/core_components/sessions"
	"easelect/backend/core_components/system_config_checks"
	"github.com/gorilla/sessions"
)

func TestSettingWritersPostgres(t *testing.T) {
	db, _ := workflows.RegistrationDisposableDBForTest(t)
	workflows.LoadPublicBootstrapForTest(t, db)
	oldDB, oldBasic, oldGuest := backend.Db, backend.DbBasic, backend.DbGuest
	backend.Db, backend.DbBasic, backend.DbGuest = db, db, db
	oldStore, oldName := e_sessions.Store, e_sessions.SessionName
	e_sessions.Store = sessions.NewCookieStore([]byte("wl119-disposable-session-key-only"))
	e_sessions.SessionName = "setting_test"
	oldPaths := runtimepaths.Current()
	root := t.TempDir()
	paths, err := runtimepaths.Resolve(root, root, false)
	if err != nil {
		t.Fatal(err)
	}
	if err := runtimepaths.Configure(paths); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		backend.Db, backend.DbBasic, backend.DbGuest = oldDB, oldBasic, oldGuest
		e_sessions.Store, e_sessions.SessionName = oldStore, oldName
		_ = runtimepaths.Configure(oldPaths)
	})
	mustExec := func(query string, args ...interface{}) {
		t.Helper()
		if _, err := db.Exec(query, args...); err != nil {
			t.Fatal(err)
		}
	}
	// The package registers system_config without column metadata, which an upgraded site has and the
	// update path reads per column (editable_in_ui). Mirror that site so each request reaches its writer.
	mustExec(`INSERT INTO system_column_details (table_uid, column_name, data_type, co_number, editable_in_ui)
		SELECT registry.table_uid, columns.column_name, columns.data_type, columns.ordinal_position, columns.column_name <> 'id'
		  FROM system_db_tables AS registry
		  JOIN information_schema.columns AS columns
		    ON columns.table_schema = 'public' AND columns.table_name = registry.table_name
		 WHERE registry.table_name = 'system_config'
		   AND NOT EXISTS (SELECT 1 FROM system_column_details AS existing
		                   WHERE existing.table_uid = registry.table_uid AND existing.column_name = columns.column_name)`)
	request := func(body string, handler http.HandlerFunc) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest("POST", "/?dataset=system_config", strings.NewReader(body))
		session, err := e_sessions.Store.Get(req, e_sessions.SessionName)
		if err != nil {
			t.Fatal(err)
		}
		session.Values["user_id"], session.Values["user_role"] = 2, "admin"
		lazy := dbutils.NewLazyTxWithBeginHook(db, func(tx *sql.Tx) error {
			return dbutils.ApplyRequestActorToTx(tx, dbutils.NewRequestActorContext(2, "admin"))
		})
		req = req.WithContext(dbutils.SetLazyTx(req.Context(), lazy))
		rec := httptest.NewRecorder()
		handler(rec, req)
		if rec.Code >= 400 {
			_ = lazy.Rollback()
		} else if err := lazy.Commit(); err != nil {
			t.Fatal(err)
		}
		return rec
	}
	snapshot := func() string {
		t.Helper()
		var state string
		if err := db.QueryRow(`SELECT COALESCE(jsonb_agg(to_jsonb(config) ORDER BY id), '[]'::jsonb)::text FROM system_config AS config`).Scan(&state); err != nil {
			t.Fatal(err)
		}
		return state
	}
	refused := func(before string, rec *httptest.ResponseRecorder) {
		t.Helper()
		if rec.Code != 400 || !strings.Contains(rec.Body.String(), `"error_lang_key":"`+system_config_checks.InvalidValueLangKey+`"`) {
			t.Fatalf("%d %s", rec.Code, rec.Body)
		}
		if snapshot() != before {
			t.Fatal("refusal changed stored settings")
		}
	}
	accepted := func(rec *httptest.ResponseRecorder) {
		t.Helper()
		if rec.Code >= 400 {
			t.Fatalf("%d %s", rec.Code, rec.Body)
		}
	}
	var id int64
	if err := db.QueryRow(`SELECT id FROM system_config WHERE key='absolute_sign_in_limit'`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	const invalid = `{"limit_enabled":true,"limit_unit":"unknown","limit_amount":2}`
	const valid = `{"limit_enabled":true,"limit_unit":"months","limit_amount":1}`
	// The settings view sends a JSON column's new value as JSON text, as the update route expects.
	jsonText := func(value string) string {
		encoded, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		return string(encoded)
	}
	updateHandler := func(w http.ResponseWriter, r *http.Request) { update.UpdateRowHandler(w, r, "system_config") }
	add := func(payload string) *httptest.ResponseRecorder {
		return request("", func(w http.ResponseWriter, r *http.Request) {
			var body bytes.Buffer
			form := multipart.NewWriter(&body)
			if err := form.WriteField("jsonPayload", payload); err != nil {
				t.Fatal(err)
			}
			if err := form.Close(); err != nil {
				t.Fatal(err)
			}
			r.Body = io.NopCloser(&body)
			r.Header.Set("Content-Type", form.FormDataContentType())
			create.AddRowMultipartHandler(w, r, "system_config")
		})
	}
	writeCSV := func(records [][]string) {
		t.Helper()
		dir := filepath.Join(root, "tables_data")
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
		file, err := os.Create(filepath.Join(dir, "system_config.csv"))
		if err != nil {
			t.Fatal(err)
		}
		writer := csv.NewWriter(file)
		if err := writer.WriteAll(records); err != nil {
			t.Fatal(err)
		}
		if err := file.Close(); err != nil {
			t.Fatal(err)
		}
	}
	// The steps share one site and build on each other, so they run in order in this test
	// rather than as subtests, whose helpers here would stop the parent test.
	{ // An update is checked as the complete edit.
		before := snapshot()
		refused(before, request(fmt.Sprintf(`{"id":%d,"updates":[{"column":"text_value","value":"must roll back"},{"column":"json_value","value":%s}]}`, id, jsonText(invalid)), updateHandler))
		refused(before, request(fmt.Sprintf(`{"id":%d,"column":"value_type","value":0}`, id), updateHandler))
		accepted(request(fmt.Sprintf(`{"id":%d,"column":"json_value","value":%s}`, id, jsonText(valid)), updateHandler))
		var raw string
		if err := db.QueryRow(`SELECT json_value::text FROM system_config WHERE id=$1`, id).Scan(&raw); err != nil {
			t.Fatal(err)
		}
		var policy map[string]interface{}
		if err := json.Unmarshal([]byte(raw), &policy); err != nil || policy["limit_unit"] != "months" {
			t.Fatalf("%s %v", raw, err)
		}
	}
	{ // An add checks registered values and leaves other keys alone.
		mustExec(`DELETE FROM system_config WHERE key='absolute_sign_in_limit'`)
		before := snapshot()
		refused(before, add(fmt.Sprintf(`{"key":"absolute_sign_in_limit","value_type":5,"json_value":%s}`, invalid)))
		accepted(add(fmt.Sprintf(`{"key":"absolute_sign_in_limit","value_type":5,"json_value":%s}`, valid)))
		accepted(add(fmt.Sprintf(`{"key":"wl119_unregistered","value_type":5,"json_value":%s}`, invalid)))
		if err := db.QueryRow(`SELECT id FROM system_config WHERE key='absolute_sign_in_limit'`).Scan(&id); err != nil {
			t.Fatal(err)
		}
		var unregisteredID int64
		if err := db.QueryRow(`SELECT id FROM system_config WHERE key='wl119_unregistered'`).Scan(&unregisteredID); err != nil {
			t.Fatal(err)
		}
		accepted(request(fmt.Sprintf(`{"id":%d,"column":"json_value","value":%s}`, unregisteredID, jsonText(invalid)), updateHandler))
		mustExec(`DELETE FROM system_config WHERE key='absolute_sign_in_limit'`)
		before = snapshot()
		refused(before, request(fmt.Sprintf(`{"id":%d,"column":"key","value":"absolute_sign_in_limit"}`, unregisteredID), updateHandler))
		accepted(add(fmt.Sprintf(`{"key":"absolute_sign_in_limit","value_type":5,"json_value":%s}`, valid)))
		if err := db.QueryRow(`SELECT id FROM system_config WHERE key='absolute_sign_in_limit'`).Scan(&id); err != nil {
			t.Fatal(err)
		}
	}
	{ // A CSV restore checks partial upserts and rolls back the whole batch.
		before := snapshot()
		writeCSV([][]string{{"id", "json_value"}, {fmt.Sprint(id), invalid}})
		refused(before, request("", devtools.ImportTableCSVHandler))
		writeCSV([][]string{{"id", "key", "value_type", "json_value"}, {"89003", "wl119_batch", "5", invalid}, {fmt.Sprint(id), "absolute_sign_in_limit", "5", invalid}})
		refused(before, request("", devtools.ImportTableCSVHandler))
		writeCSV([][]string{{"id", "key", "value_type", "json_value"}, {fmt.Sprint(id), "absolute_sign_in_limit", "5", valid}, {"89003", "wl119_batch", "5", invalid}})
		accepted(request("", devtools.ImportTableCSVHandler))
	}
	{ // Translation repair cannot bypass the checks.
		// Both translations exist, so this exercises only the local repair and
		// does not call a translation provider. It models an old damaged value.
		mustExec(`UPDATE system_config SET json_value='{"fi":"teksti","en":"text"}' WHERE id=$1`, id)
		before := snapshot()
		refused(before, request(fmt.Sprintf(`{"table":"system_config","row_ids":[%d],"columns":["json_value"]}`, id), lang.FixTableTranslationsHandler))
		mustExec(`UPDATE system_config SET json_value=$1 WHERE id=$2`, valid, id)
	}
	{ // The language seed fills empty values only and is idempotent.
		mustExec(`UPDATE system_lang_keys SET fi='', en='Site wording' WHERE lang_key='duration_unit_seconds'`)
		// A served translation cannot be blank (a CHECK), so a missing Finnish one is a deleted row.
		mustExec(`DELETE FROM system_lang_key_translations WHERE language_code='fi' AND lang_key_id=(SELECT id FROM system_lang_keys WHERE lang_key='duration_unit_seconds')`)
		mustExec(`UPDATE system_lang_key_translations SET translation='Reviewed wording' WHERE language_code='en' AND lang_key_id=(SELECT id FROM system_lang_keys WHERE lang_key='duration_unit_seconds')`)
		script, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "server_tools", "migrations", "20261005000055_seed_setting_check_language_keys.sql"))
		if err != nil {
			t.Fatal(err)
		}
		mustExec(string(script))
		languageSnapshot := func() string {
			var state string
			if err := db.QueryRow(`SELECT jsonb_agg(to_jsonb(keys) ORDER BY id)::text FROM system_lang_keys AS keys WHERE lang_key LIKE 'duration_unit_%' OR lang_key='error_setting_duration_invalid'`).Scan(&state); err != nil {
				t.Fatal(err)
			}
			return state
		}
		first := languageSnapshot()
		mustExec(string(script))
		if first != languageSnapshot() {
			t.Fatal("second seed changed filled key rows")
		}
		var fi, en, servedFI, servedEN string
		if err := db.QueryRow(`SELECT fi,en,
            (SELECT translation FROM system_lang_key_translations WHERE lang_key_id=keys.id AND language_code='fi'),
            (SELECT translation FROM system_lang_key_translations WHERE lang_key_id=keys.id AND language_code='en')
            FROM system_lang_keys AS keys WHERE lang_key='duration_unit_seconds'`).Scan(&fi, &en, &servedFI, &servedEN); err != nil {
			t.Fatal(err)
		}
		if fi != "sekuntia" || en != "Site wording" || servedFI != "sekuntia" || servedEN != "Reviewed wording" {
			t.Fatalf("%q %q %q %q", fi, en, servedFI, servedEN)
		}
		var count int
		if err := db.QueryRow(`SELECT count(*) FROM system_lang_key_translations JOIN system_lang_keys ON lang_key_id=system_lang_keys.id WHERE (lang_key LIKE 'duration_unit_%' OR lang_key='error_setting_duration_invalid') AND language_code IN ('fi','en')`).Scan(&count); err != nil || count != 16 {
			t.Fatalf("language seed count=%d %v", count, err)
		}
	}
}
