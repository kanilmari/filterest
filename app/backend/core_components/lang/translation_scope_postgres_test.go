// translation_scope_postgres_test.go
// Proves object associations and real permission joins on disposable PostgreSQL.
// Connects runtime label creation, migration notices and API source filtering.
// Opt-in precedes cluster creation; installation databases are never consulted.
package lang

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/lang_key_naming"
	"github.com/lib/pq"
)

func translationDisposableDB(t *testing.T, notices *[]string) *sql.DB {
	t.Helper()
	if os.Getenv("FILTEREST_TEST_DISPOSABLE_POSTGRES") != "1" {
		t.Skip("set FILTEREST_TEST_DISPOSABLE_POSTGRES=1 for disposable translation proofs")
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
	run("pg_ctl", "-D", data, "-l", filepath.Join(root, "postgres.log"), "-o", "-h '' -k '"+socket+"' -p 15598", "-w", "start")
	t.Cleanup(func() { run("pg_ctl", "-D", data, "-m", "immediate", "-w", "stop") })
	connector, err := pq.NewConnector(fmt.Sprintf("host=%s port=15598 user=fixture_owner dbname=postgres sslmode=disable", socket))
	if err != nil {
		t.Fatal(err)
	}
	db := sql.OpenDB(pq.ConnectorWithNoticeHandler(connector, func(notice *pq.Error) { *notices = append(*notices, notice.Message) }))
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { db.Close() })
	oldDB := backend.Db
	backend.Db = db
	t.Cleanup(func() { backend.Db = oldDB })
	return db
}

const translationPostgresFixture = `
CREATE TABLE system_languages(language_code text PRIMARY KEY, is_enabled boolean, fallback_language_code text);
INSERT INTO system_languages VALUES ('fi',true,NULL),('en',true,NULL);
CREATE TABLE system_lang_keys(id serial PRIMARY KEY,lang_key text UNIQUE,fi text,en text,ch text,yue text,creation_spec text,updated timestamptz);
CREATE TABLE system_lang_key_translations(lang_key_id integer,language_code text,translation text,source_kind text,review_status text,updated timestamptz, UNIQUE(lang_key_id,language_code));
CREATE TABLE system_lang_key_sources(lang_key_id integer,source_type text,source_high text,source_low text,usage_explanation text,last_seen date, UNIQUE(lang_key_id,source_type,source_high));
CREATE TABLE system_db_tables(table_uid integer PRIMARY KEY,table_name text,schema_name text,ui_hidden boolean DEFAULT false);
CREATE TABLE system_column_details(table_uid integer,column_name text,hide_everywhere boolean DEFAULT false,client_delivery_mode text DEFAULT 'include');
CREATE TABLE system_table_folders(id serial PRIMARY KEY,folder_name text);
CREATE TABLE system_user_group_memberships(user_id integer,group_id integer);
CREATE TABLE system_functions(id integer PRIMARY KEY,url_route_endpoint text,disabled boolean);
CREATE TABLE system_group_table_func_rights(user_group_id integer,function_id integer,target_table_uid integer);
CREATE TABLE system_data_repair_records(migration text,action text,detail jsonb);
CREATE TABLE app_scope_a(id integer,a_label text);
CREATE TABLE app_scope_b(id integer,b_label text);
INSERT INTO system_db_tables VALUES (11,'app_scope_a','public',false),(22,'app_scope_b','public',false);
INSERT INTO system_column_details(table_uid,column_name) VALUES (11,'id'),(11,'a_label'),(22,'id'),(22,'b_label');
INSERT INTO system_user_group_memberships VALUES (1,3),(42,4),(43,5),(99,1);
INSERT INTO system_functions VALUES (1,'/api/get-results',false),(2,'/api/tree_data',false);
INSERT INTO system_group_table_func_rights VALUES (4,1,11),(5,1,22),(5,2,NULL);
INSERT INTO system_table_folders(folder_name) VALUES ('scope_folder');
INSERT INTO system_lang_keys(lang_key,en,fi) VALUES ('login','Login','Kirjaudu'),('scope_folder','Folder','Kansio'),('add_row_app_lost_fixture','Lost','Kadonnut');
INSERT INTO system_lang_keys(lang_key,en,creation_spec) VALUES ('retired_dataset_name','Old private name','Interface label derived from dataset schema names.');
`

func TestTranslationObjectAssociationsAndPermissionsPostgres(t *testing.T) {
	var notices []string
	db := translationDisposableDB(t, &notices)
	execSQL := func(query string) {
		t.Helper()
		if _, err := db.Exec(query); err != nil {
			t.Fatal(err)
		}
	}
	execSQL(translationPostgresFixture)
	for _, dataset := range []string{"app_scope_a", "app_scope_b"} {
		column := map[string]string{"app_scope_a": "a_label", "app_scope_b": "b_label"}[dataset]
		if err := EnsureDatasetInterfaceLabels(db, dataset, []string{"id", column}); err != nil {
			t.Fatal(err)
		}
	}
	execSQL("ALTER TABLE app_scope_a ADD COLUMN added_label text; INSERT INTO system_column_details(table_uid,column_name) VALUES (11,'added_label')")
	if err := EnsureColumnInterfaceLabels(db, "app_scope_a", []string{"added_label"}); err != nil {
		t.Fatal(err)
	}
	assertAssociation := func(key, kind, high, low string) {
		t.Helper()
		var found bool
		if err := db.QueryRow(`SELECT EXISTS(SELECT 1 FROM system_lang_key_sources s JOIN system_lang_keys k ON k.id=s.lang_key_id
WHERE k.lang_key=$1 AND s.source_type=$2 AND s.source_high=$3 AND s.source_low=$4)`, key, kind, high, low).Scan(&found); err != nil || !found {
			t.Fatal("missing association", key, kind, high, low, err)
		}
	}
	for _, label := range append(datasetInterfaceLabels("app_scope_a"), columnInterfaceLabels("app_scope_a", []string{"id", "a_label", "added_label"})...) {
		assertAssociation(label.LangKey, label.SourceType, label.SourceHigh, label.SourceLow)
	}
	// Emulate an upgrade whose old writer omitted associations, retaining a
	// generic source to prove it cannot make a private key public.
	execSQL(`DELETE FROM system_lang_key_sources WHERE source_type='table';
INSERT INTO system_lang_key_sources(lang_key_id,source_type,source_high) SELECT id,'code','fixture.js' FROM system_lang_keys WHERE lang_key='add_row_app_scope_a'`)
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "server_tools", "migrations", "20261015000006_backfill_translation_object_sources.sql"))
	if err != nil {
		t.Fatal(err)
	}
	execSQL(string(raw))
	for _, key := range append([]string{"app_scope_a"}, lang_key_naming.DatasetOwnedKeyNames("app_scope_a")...) {
		assertAssociation(key, "table", "app_scope_a", "app_scope_a")
	}
	assertAssociation("scope_folder", "folder", "scope_folder", "scope_folder")
	logs := strings.Join(notices, "\n")
	if !strings.Contains(logs, "associated keys before=") || !strings.Contains(logs, "after=") || !strings.Contains(logs, "unresolved object key (withheld from non-admin translations): add_row_app_lost_fixture") {
		t.Fatal("missing migration evidence", logs)
	}
	var before, after int
	if err := db.QueryRow("SELECT count(*) FROM system_lang_key_sources").Scan(&before); err != nil {
		t.Fatal(err)
	}
	execSQL(string(raw))
	if err := db.QueryRow("SELECT count(*) FROM system_lang_key_sources").Scan(&after); err != nil || before != after {
		t.Fatal("non-idempotent backfill", before, after, err)
	}
	values, err := ReadDisplayTranslations("en")
	if err != nil {
		t.Fatal(err)
	}
	for _, user := range []int{1, 42, 43, 99, 42} {
		scope, err := readTranslationScope(db, user)
		if err != nil {
			t.Fatal(err)
		}
		filtered, err := filterTranslationMap(context.Background(), values, scope)
		if err != nil {
			t.Fatal(err)
		}
		_, hasA := filtered["add_row_app_scope_a"]
		_, hasB := filtered["add_row_app_scope_b"]
		_, folder := filtered["scope_folder"]
		if hasA != (user == 42 || user == 99) || hasB != (user == 43 || user == 99) || folder != (user == 43 || user == 99) || filtered["login"] != "Login" {
			t.Fatal("wrong reader scope", user, filtered)
		}
		if user == 99 && !reflect.DeepEqual(filtered, values) {
			t.Fatal("admin lost keys")
		}
		if _, leaked := filtered["retired_dataset_name"]; user != 99 && leaked {
			t.Fatal("unassociated derived label exposed", user)
		}
		if user == 42 {
			for _, key := range []string{"search_for_app_scope_a", "a_label", "added_label"} {
				if filtered[key] == "" {
					t.Fatal("reader lost own label", key)
				}
			}
		}
	}
	// Test each visibility rule independently so dataset hiding cannot mask a
	// broken column condition, and hiding cannot mask a broken grant join.
	for _, check := range []struct {
		change, missing string
		datasetVisible  bool
	}{
		{"UPDATE system_column_details SET hide_everywhere=true WHERE column_name='a_label'", "a_label", true},
		{"UPDATE system_column_details SET client_delivery_mode='server_only' WHERE column_name='added_label'", "added_label", true},
		{"UPDATE system_db_tables SET ui_hidden=true WHERE table_uid=11", "app_scope_a", false},
		{"UPDATE system_db_tables SET ui_hidden=false WHERE table_uid=11; DELETE FROM system_group_table_func_rights WHERE user_group_id=4", "app_scope_a", false},
	} {
		execSQL(check.change)
		scope, err := readTranslationScope(db, 42)
		if err != nil {
			t.Fatal(err)
		}
		filtered, err := filterTranslationMap(context.Background(), values, scope)
		_, leaked := filtered[check.missing]
		_, datasetVisible := filtered["app_scope_a"]
		if err != nil || leaked || datasetVisible != check.datasetVisible || filtered["login"] != "Login" {
			t.Fatal("visibility change retained names", check.change, filtered, err)
		}
	}
}
