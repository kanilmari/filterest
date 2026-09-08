// media_library_test.go
// Exercises strict paths, rollback-safe copying, and the media API against disposable PostgreSQL.
// Between real filesystem boundaries, registered dataset permissions, and per-row usages.
// Exists to verify retention and revocation without touching an operator database.
package media_library

import (
	"context"
	"database/sql"
	"easelect/backend/core_components/dbutils"
	read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	links "easelect/backend/core_components/dynamic_table_tools/dtt_asset_linking"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

const testAssetID = "174668a1-2efa-45a6-aa6c-d8a4ee8ec069"

func TestCanonicalPathsRejectTraversalAndAlternateIdentity(t *testing.T) {
	for _, raw := range []string{"media/" + testAssetID + "/original/image.png", "media/" + testAssetID + "/300/image.png", "media/" + testAssetID + "/2160/image.jpg"} {
		if _, _, _, ok := ParseStoragePath(raw); !ok {
			t.Errorf("rejected %s", raw)
		}
	}
	for _, raw := range []string{"media/" + testAssetID + "/original/../copy.json", "media/" + testAssetID + "/original/image.svg", "media/" + strings.ToUpper(testAssetID) + "/original/image.png", "media/" + testAssetID + "/copy.json", "media/" + testAssetID + "/x/image.png", "media/" + testAssetID + "/original/image.png?x=1", "media/" + testAssetID + "/original/other.png"} {
		if _, _, _, ok := ParseStoragePath(raw); ok {
			t.Errorf("accepted %s", raw)
		}
	}
}
func seedImage(t *testing.T, root string) {
	t.Helper()
	p := filepath.Join(root, "101/1/original")
	if e := os.MkdirAll(p, 0750); e != nil {
		t.Fatal(e)
	}
	if e := os.WriteFile(filepath.Join(p, "101_1_9.png"), []byte("test image contents"), 0600); e != nil {
		t.Fatal(e)
	}
}
func TestCopyRetainsOriginalAndRollbackOnlyRemovesItsOwnFiles(t *testing.T) {
	root := t.TempDir()
	seedImage(t, root)
	rel := relation{ID: 17, ParentUID: 101}
	src := source{ID: 9, ParentID: 1, Reference: "101_1_9.png"}
	copy, e := copyAsset(root, rel, src, testAssetID)
	if e != nil {
		t.Fatal(e)
	}
	if copy.Hash == "" {
		t.Fatal("missing hash")
	}
	if _, e = os.Stat(filepath.Join(root, "101/1/original/101_1_9.png")); e != nil {
		t.Fatal(e)
	}
	if _, e = os.Stat(filepath.Join(root, "media", testAssetID, "original", "image.png")); e != nil {
		t.Fatal(e)
	}
	copy.Cleanup()
	if _, e = os.Stat(filepath.Join(root, "media", testAssetID)); !os.IsNotExist(e) {
		t.Fatal("rollback folder retained")
	}
	if _, e = os.Stat(filepath.Join(root, "101/1/original/101_1_9.png")); e != nil {
		t.Fatal("original removed")
	}
}
func TestCopyRejectsSymlinkAndForeignParent(t *testing.T) {
	root := t.TempDir()
	seedImage(t, root)
	original := filepath.Join(root, "101/1/original/101_1_9.png")
	os.Remove(original)
	target := filepath.Join(t.TempDir(), "private.png")
	os.WriteFile(target, []byte("private"), 0600)
	if e := os.Symlink(target, original); e != nil {
		t.Fatal(e)
	}
	rel := relation{ID: 17, ParentUID: 101}
	src := source{ID: 9, ParentID: 1, Reference: "101_1_9.png"}
	if _, e := copyAsset(root, rel, src, testAssetID); e == nil {
		t.Fatal("followed symlink")
	}
	if _, _, e := legacyLocation(rel, source{ParentID: 1, Reference: "101/2/original/image.png"}); e == nil {
		t.Fatal("accepted foreign parent")
	}
	if _, _, e := legacyLocation(rel, source{ParentID: 1, Reference: "https://outside/image.png"}); e == nil {
		t.Fatal("accepted remote")
	}
}
func TestSelectionsAreRemovedBeforeOrdinaryRowInsert(t *testing.T) {
	payload := map[string]interface{}{"title": "Keep", "_existingImages": []map[string]interface{}{{"relation_id": 17, "source_row_id": 9}}}
	got, e := TakeSelections(payload)
	if e != nil || len(got) != 1 || got[0].SourceRowID != 9 {
		t.Fatal(got, e)
	}
	if _, ok := payload["_existingImages"]; ok {
		t.Fatal("reserved column retained")
	}
	if payload["title"] != "Keep" {
		t.Fatal("row data changed")
	}
	for _, raw := range []interface{}{map[string]int{"source_row_id": 9}, []map[string]int{{"relation_id": -1, "source_row_id": 9}}, []map[string]int{{"relation_id": 17, "source_row_id": 9}, {"relation_id": 17, "source_row_id": 9}}} {
		if _, e := TakeSelections(map[string]interface{}{"_existingImages": raw}); e == nil {
			t.Fatal("accepted invalid selection")
		}
	}
}
func disposableDB(t *testing.T) *sql.DB {
	t.Helper()
	if os.Getenv("FILTEREST_TEST_DISPOSABLE_POSTGRES") != "1" {
		t.Skip("set FILTEREST_TEST_DISPOSABLE_POSTGRES=1")
	}
	root := t.TempDir()
	socket := filepath.Join(root, "socket")
	os.Mkdir(socket, 0700)
	bin := "/usr/lib/postgresql/16/bin/"
	run := func(name string, args ...string) {
		t.Helper()
		if b, e := exec.Command(bin+name, args...).CombinedOutput(); e != nil {
			t.Fatalf("%s: %v %s", name, e, b)
		}
	}
	run("initdb", "-D", filepath.Join(root, "db"), "-A", "trust", "-U", "test_owner", "--no-locale", "--encoding=UTF8")
	run("pg_ctl", "-D", filepath.Join(root, "db"), "-l", filepath.Join(root, "pg.log"), "-o", "-h '' -k '"+socket+"' -p 15459", "-w", "start")
	t.Cleanup(func() {
		exec.Command(bin+"pg_ctl", "-D", filepath.Join(root, "db"), "-m", "fast", "-w", "stop").CombinedOutput()
	})
	db, e := sql.Open("postgres", "host="+socket+" port=15459 user=test_owner dbname=postgres sslmode=disable")
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

const fixtureSchema = `
CREATE TABLE system_lang_keys(id bigserial PRIMARY KEY,lang_key text UNIQUE,fi text,en text,creation_spec text,updated timestamptz);
CREATE TABLE system_lang_key_translations(lang_key_id bigint,language_code text,translation text,source_kind text,review_status text,updated timestamptz,UNIQUE(lang_key_id,language_code));
CREATE TABLE system_lang_key_sources(lang_key_id bigint,source_type text,source_high text,source_low text,usage_explanation text,last_seen date,UNIQUE(lang_key_id,source_type,source_high));
CREATE TABLE system_db_version(version text,description text);
CREATE TABLE system_db_tables(table_uid bigint PRIMARY KEY,table_name text,schema_name text);
CREATE TABLE system_column_details(table_uid bigint,column_name text,must_be_true_unless_own boolean);
CREATE TABLE system_foreign_key_relations_1_m(id bigint PRIMARY KEY,source_table_uid bigint,target_table_uid bigint,source_column_name text,target_insert_specs jsonb);
CREATE TABLE system_permission_actions(id bigint PRIMARY KEY,action_key text,enabled boolean DEFAULT true,scope_type text DEFAULT 'row');
CREATE TABLE system_row_access_rules(table_uid bigint,action_id bigint,row_id bigint DEFAULT 1,user_id bigint DEFAULT 2,group_id bigint,effect text DEFAULT 'deny',valid_from timestamptz DEFAULT now(),valid_until timestamptz);
CREATE TABLE system_row_group_memberships(table_uid bigint);
CREATE TABLE system_functions(id bigint PRIMARY KEY,url_route_endpoint text);
CREATE TABLE system_group_table_func_rights(user_group_id bigint,function_id bigint,target_table_uid bigint);
CREATE TABLE system_user_group_memberships(user_id bigint,group_id bigint);
CREATE TABLE specimen_parent(id bigint PRIMARY KEY,cached_image text);
CREATE TABLE specimen_media(id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,parent_id bigint REFERENCES specimen_parent(id) ON DELETE CASCADE,
 filename text,asset_kind text,original_name text,mime_type text,size_bytes bigint,title jsonb,description jsonb,sort_order int DEFAULT 0,is_primary boolean DEFAULT false,created timestamptz DEFAULT now());
INSERT INTO system_db_tables VALUES(101,'specimen_parent','public'),(102,'specimen_media','public');
INSERT INTO system_permission_actions(id,action_key) VALUES(1,'read'),(2,'update'),(3,'delete');
INSERT INTO system_functions VALUES(1,'/api/get-results'),(2,'/api/update-row'),(3,'/api/add-row-multipart'),(4,'/api/delete-rows');
INSERT INTO system_group_table_func_rights SELECT 7,id,uid FROM system_functions CROSS JOIN (VALUES(101),(102)) AS u(uid);
INSERT INTO system_user_group_memberships VALUES(2,7),(1,7);
INSERT INTO specimen_parent VALUES(1,'101_1_9.png'),(2,NULL),(3,NULL);
INSERT INTO specimen_media(id,parent_id,filename,asset_kind,original_name,mime_type,size_bytes,title,description)
 VALUES(9,1,'101_1_9.png','image','Original.png','image/png',19,'{"fi":"Kuva","en":"Image"}','{"fi":"Selite","en":"Caption"}');
SELECT setval(pg_get_serial_sequence('specimen_media','id'),10);
`

// This real-PG test covers the supported ordinary dataset. It intentionally
// refuses every row-dependent policy instead of emulating a broader ACL engine.
func TestDisposableAttachReadRepeatDetachRevocationAndRollback(t *testing.T) {
	db := disposableDB(t)
	execSQL := func(sql string, args ...interface{}) {
		t.Helper()
		if _, e := db.Exec(sql, args...); e != nil {
			t.Fatal(e)
		}
	}
	execSQL(fixtureSchema)
	canonicalResolver, e := os.ReadFile("../../../server_tools/migrations/20260902000004_finalize_row_access_fail_closed_defaults.sql")
	if e != nil {
		t.Fatal(e)
	}
	resolverText := string(canonicalResolver)
	begin := strings.Index(resolverText, "CREATE OR REPLACE FUNCTION public.resolve_effective_row_access(")
	end := strings.Index(resolverText[begin:], "$$;") + 3
	execSQL(resolverText[begin : begin+end])

	specs, _ := json.Marshal(links.BuildTargetInsertSpecs(links.BuildImageFileUploadConfig("specimen_parent", 10, []string{"png"})))
	execSQL("INSERT INTO system_foreign_key_relations_1_m VALUES(17,102,101,'parent_id',$1)", string(specs))
	migration, e := os.ReadFile("../../../server_tools/migrations/20260908000006_add_media_asset_registry.sql")
	if e != nil {
		t.Fatal(e)
	}
	execSQL(string(migration))
	execSQL(string(migration))
	root := t.TempDir()
	seedImage(t, root)
	actor := dbutils.NewRequestActorContext(2, "basic")
	apply := func(parent int64, commit bool) (Result, error) {
		lt := dbutils.NewLazyTx(db)
		ctx := dbutils.SetLazyTx(context.Background(), lt)
		tx, e := lt.Begin()
		if e != nil {
			return Result{}, e
		}
		result, e := Attach(ctx, tx, root, actor, Request{Dataset: "specimen_parent", RelationID: 17, SourceRowID: 9, ParentRowID: parent})
		if e != nil || !commit {
			lt.Rollback()
		} else {
			e = lt.Commit()
		}
		return result, e
	}

	deniedTx := dbutils.NewLazyTx(db)
	deniedCtx := dbutils.SetLazyTx(context.Background(), deniedTx)
	tx0, _ := deniedTx.Begin()
	tx0.Exec("INSERT INTO specimen_parent VALUES(99,NULL)")
	_, err0 := Attach(deniedCtx, tx0, root, actor, Request{Dataset: "wrong_dataset", RelationID: 17, SourceRowID: 9, ParentRowID: 99})
	if err0 == nil {
		t.Fatal("cross-dataset source admitted")
	}
	deniedTx.Rollback()
	var partial bool
	db.QueryRow("SELECT EXISTS(SELECT 1 FROM specimen_parent WHERE id=99)").Scan(&partial)
	if partial {
		t.Fatal("failed create retained parent")
	}
	first, e := apply(2, true)
	if e != nil {
		t.Fatal("attach", e)
	}
	if !AuthorizeStorageRead(db, actor, first.AssetID, "image.png") {
		t.Fatal("new image unreadable")
	}
	if !AuthorizeStorageRead(db, dbutils.NewRequestActorContext(1, "guest"), first.AssetID, "image.png") {
		t.Fatal("guest with identical dataset rights denied")
	}

	execSQL("CREATE ROLE media_reader")
	execSQL("GRANT USAGE ON SCHEMA public TO media_reader")
	execSQL("GRANT SELECT ON ALL TABLES IN SCHEMA public TO media_reader")
	execSQL("REVOKE SELECT ON specimen_media FROM media_reader")
	execSQL("GRANT SELECT(id,parent_id,asset_kind,original_name,mime_type,size_bytes,title,description,sort_order,is_primary,created) ON specimen_media TO media_reader")
	readTx, _ := db.Begin()
	readTx.Exec("SET LOCAL ROLE media_reader")
	if AuthorizeStorageRead(readTx, actor, first.AssetID, "image.png") {
		t.Fatal("hidden filename column allowed")
	}
	readTx.Rollback()
	execSQL("GRANT SELECT(filename) ON specimen_media TO media_reader")
	readTx, _ = db.Begin()
	readTx.Exec("SET LOCAL ROLE media_reader")
	if !AuthorizeStorageRead(readTx, actor, first.AssetID, "image.png") {
		t.Fatal("ordinary reader with complete column grants denied")
	}
	readTx.Rollback()
	repeat, e := apply(2, true)
	if e != nil || !repeat.Unchanged || repeat.UsageRowID != first.UsageRowID {
		t.Fatal("repeat duplicated", repeat, e)
	}
	var text string
	db.QueryRow("SELECT title->>'fi'||':'||(description->>'en') FROM specimen_media WHERE id=$1", first.UsageRowID).Scan(&text)
	if text != "Kuva:Caption" {
		t.Fatal("captions not preserved", text)
	}
	second, e := apply(3, true)
	if e != nil {
		t.Fatal(e)
	}
	execSQL("INSERT INTO system_row_access_rules(table_uid,action_id) VALUES(101,1)")
	responseRows := []map[string]interface{}{{"cached_image": first.URL, "cached_image_title": "derived caption", "cached_image_metadata_json": "derived metadata", "title": "Own title", "description": "Own description"}}
	read.FilterIndependentMediaRows(db, actor, responseRows)
	if responseRows[0]["cached_image"] != nil || responseRows[0]["cached_image_title"] != nil || responseRows[0]["cached_image_metadata_json"] != nil {
		t.Fatal("revoked cached image metadata exposed")
	}
	if responseRows[0]["title"] != "Own title" || responseRows[0]["description"] != "Own description" {
		t.Fatal("authored content removed")
	}

	if AuthorizeStorageRead(db, actor, first.AssetID, "image.png") {
		t.Fatal("row read policy failed to revoke even admin")
	}
	if _, e = apply(2, true); !errors.Is(e, ErrUnsupported) {
		t.Fatal("unsupported audience attach allowed", e)
	}
	execSQL("DELETE FROM system_row_access_rules")
	execSQL("DELETE FROM system_group_table_func_rights WHERE target_table_uid=101 AND function_id=1")
	if AuthorizeStorageRead(db, actor, first.AssetID, "image.png") {
		t.Fatal("dataset ACL revocation ignored")
	}
	execSQL("INSERT INTO system_group_table_func_rights VALUES(7,1,101)")
	execSQL("UPDATE system_foreign_key_relations_1_m SET source_column_name='other' WHERE id=17")
	if AuthorizeStorageRead(db, actor, first.AssetID, "image.png") {
		t.Fatal("relation drift admitted")
	}
	execSQL("UPDATE system_foreign_key_relations_1_m SET source_column_name='parent_id' WHERE id=17")
	lt := dbutils.NewLazyTx(db)
	ctx := dbutils.SetLazyTx(context.Background(), lt)
	tx, _ := lt.Begin()
	if e = Detach(ctx, tx, actor, Request{Dataset: "specimen_parent", RelationID: 17, ParentRowID: 2, AssetID: first.AssetID}); e != nil {
		lt.Rollback()
		t.Fatal("detach", e)
	}
	if e = lt.Commit(); e != nil {
		t.Fatal(e)
	}
	if !AuthorizeStorageRead(db, actor, first.AssetID, "image.png") {
		t.Fatal("other usage disappeared")
	}
	execSQL("DELETE FROM specimen_parent WHERE id=1")
	if !AuthorizeStorageRead(db, actor, first.AssetID, "image.png") {
		t.Fatal("source deletion broke reused image")
	}
	if _, e = os.Stat(filepath.Join(root, "media", first.AssetID, "original", "image.png")); e != nil {
		t.Fatal("shared file removed", e)
	}
	execSQL("DELETE FROM specimen_media WHERE id=$1", second.UsageRowID)
	if AuthorizeStorageRead(db, actor, first.AssetID, "image.png") {
		t.Fatal("stale usage authorized")
	}
	// A separate source gives rollback a new physical identity. No orphan survives a normal rollback.
	execSQL("INSERT INTO specimen_parent VALUES(1,NULL)")
	execSQL("INSERT INTO specimen_media(id,parent_id,filename,asset_kind) VALUES(9,1,'101_1_9.png','image')")
	entries, _ := os.ReadDir(filepath.Join(root, "media"))
	before := len(entries)
	os.WriteFile(filepath.Join(root, "101/1/original/101_1_9.png"), []byte("new file revision"), 0600)
	rolled, e := apply(2, false)
	if e != nil {
		t.Fatal("rollback setup", e)
	}
	entries, _ = os.ReadDir(filepath.Join(root, "media"))
	if len(entries) != before {
		t.Fatal("rollback leaked copy")
	}
	if AuthorizeStorageRead(db, actor, rolled.AssetID, "image.png") {
		t.Fatal("rolled back usage readable")
	}
}
