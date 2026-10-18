// card_image_update_postgres_test.go
// Exercises actual image-use saves, row rights, versions and atomic adoption.
// Reuses the existing disposable PostgreSQL fixture and real row-policy resolver.
// The foreman runs these native proofs; they never connect to installation data.
package dtt_1_row_update

import (
	"database/sql"
	"errors"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	pictures "easelect/backend/core_components/dynamic_table_tools/dtt_card_picture"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/runtimepaths"
)

const cardImageUpdateFixture = `
ALTER TABLE system_db_tables ALTER COLUMN table_uid TYPE integer;
ALTER TABLE system_column_details ADD COLUMN data_type text, ADD COLUMN co_number integer,
 ADD COLUMN editable_in_ui boolean DEFAULT true, ADD COLUMN insertable boolean,
 ADD COLUMN card_element text, ADD COLUMN hide_in_filter_panel boolean, ADD COLUMN show_value_on_card boolean, ADD COLUMN hide_everywhere boolean,
 ADD COLUMN client_delivery_mode text DEFAULT 'include', ADD COLUMN hide_on_small_card boolean,
 ADD COLUMN hide_false_null_on_sml_crd boolean;
CREATE TABLE system_data_repair_records(migration text,action text);
CREATE TABLE system_foreign_key_relations_1_m(id bigint PRIMARY KEY,source_table_uid bigint,
 target_table_uid bigint,source_column_name text,target_insert_specs jsonb);
CREATE FUNCTION public.app_row_actor_column(regclass,text) RETURNS text LANGUAGE SQL AS 'SELECT NULL::text';
CREATE TABLE image_parents(id integer PRIMARY KEY,cached_image text,hero_image text);
CREATE TABLE image_links(id serial PRIMARY KEY,parent_id integer REFERENCES image_parents(id),
 filename text,asset_kind text DEFAULT 'image',sort_order integer DEFAULT 0,is_primary boolean DEFAULT false,
 metadata_json jsonb,created timestamptz DEFAULT now());
INSERT INTO system_db_tables(table_uid,table_name) VALUES(701,'image_parents'),(702,'image_links');
INSERT INTO system_column_details(table_uid,column_name,card_element,show_value_on_card)
 VALUES(701,'cached_image','hidden',false),(701,'hero_image','image',true);
INSERT INTO system_foreign_key_relations_1_m VALUES(91,702,701,'parent_id',
 '{"file_upload":{"profile_key":"asset_linking","filename_column":"filename","profiles":{"image":{}}}}');
INSERT INTO system_functions VALUES(2,'/api/update-row',false),(3,'/api/add-row-multipart',false);
INSERT INTO system_group_table_func_rights VALUES(2,1,701),(2,2,701),(2,1,702),(2,2,702),(2,3,702);
INSERT INTO image_parents VALUES(4,'first.png','second.png'),(5,NULL,'701_5_77.png');
INSERT INTO image_links(parent_id,filename) VALUES(4,'first.png'),(4,'second.png');
GRANT SELECT,UPDATE,INSERT ON image_parents,image_links TO update_reference_reader;
GRANT SELECT ON system_foreign_key_relations_1_m TO update_reference_reader;
GRANT USAGE ON SEQUENCE image_links_id_seq TO update_reference_reader;
`

func cardImagePostgresFixture(t *testing.T) (*sql.DB, *sql.DB) {
	t.Helper()
	owner, editor := updateReferencePostgres(t)
	if _, err := owner.Exec(cardImageUpdateFixture); err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile("../../../../../server_tools/migrations/20261015000009_add_card_image_usage_presentation.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := owner.Exec(string(migration)); err != nil {
		t.Fatal(err)
	}
	return owner, editor
}

func cardImageUseForTest(t *testing.T, q *sql.DB, rowID, linkID int64) pictures.CardImageUse {
	t.Helper()
	var parentVersion, linkVersion, source string
	if err := q.QueryRow(`SELECT xmin::text,hero_image FROM image_parents WHERE id=$1`, rowID).Scan(&parentVersion, &source); err != nil {
		t.Fatal(err)
	}
	if linkID != 0 {
		if err := q.QueryRow(`SELECT xmin::text FROM image_links WHERE id=$1`, linkID).Scan(&linkVersion); err != nil {
			t.Fatal(err)
		}
	}
	return pictures.CardImageUse{Dataset: "image_parents", RowID: rowID, Column: "hero_image", RelationID: 91, LinkRowID: linkID,
		Version: pictures.CardImageVersion(parentVersion, linkVersion, source)}
}

func callCardImageSave(t *testing.T, editor *sql.DB, use pictures.CardImageUse, adopt bool) (*sql.Tx, pictures.CardImageUse, error) {
	t.Helper()
	tx, err := editor.Begin()
	if err != nil {
		t.Fatal(err)
	}
	allowed, err := read.LockRowsVisibleForMutation(tx, use.Dataset, "basic", 4, []int64{use.RowID})
	if err != nil {
		tx.Rollback()
		t.Fatal(err)
	}
	if !allowed {
		return tx, use, cardImageRefusal(403, "parent row is not editable")
	}
	mode := "cover"
	updated, err := saveCardImageUpdate(tx, httptest.NewRequest("POST", "/api/update-row?dataset=image_parents", nil), use.Dataset, use.RowID,
		&cardImageUpdate{Use: use, Adopt: adopt, CardImageSettings: pictures.CardImageSettings{Presentation: &mode, Focal: &pictures.CardImageFocal{X: 0.2, Y: 0.8}}}, 4, "basic")
	return tx, updated, err
}

func TestCardImageRowUpdateIsolationAndPermissionsPostgres(t *testing.T) {
	owner, editor := cardImagePostgresFixture(t)
	use := cardImageUseForTest(t, owner, 4, 2)
	tx, saved, err := callCardImageSave(t, editor, use, false)
	if err != nil {
		tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if saved.LinkRowID != 2 || saved.Version == use.Version {
		t.Fatal("save identity did not advance", saved)
	}
	var first sql.NullString
	var second string
	if err := owner.QueryRow(`SELECT card_image_presentation FROM image_links WHERE id=1`).Scan(&first); err != nil {
		t.Fatal(err)
	}
	if err := owner.QueryRow(`SELECT card_image_presentation FROM image_links WHERE id=2`).Scan(&second); err != nil {
		t.Fatal(err)
	}
	if first.Valid || second != "cover" {
		t.Fatal("another image use changed", first, second)
	}
	for _, tc := range []struct {
		name, setup, restore string
		status               int
	}{
		{"parent_update_right", `DELETE FROM system_group_table_func_rights WHERE target_table_uid=701 AND function_id=2`, `INSERT INTO system_group_table_func_rights VALUES(2,2,701)`, 403},
		{"gallery_update_right", `DELETE FROM system_group_table_func_rights WHERE target_table_uid=702 AND function_id=2`, `INSERT INTO system_group_table_func_rights VALUES(2,2,702)`, 403},
		{"field_editability", `UPDATE system_column_details SET editable_in_ui=false WHERE table_uid=702 AND column_name='card_image_presentation'`, `UPDATE system_column_details SET editable_in_ui=true WHERE table_uid=702 AND column_name='card_image_presentation'`, 403},
		{"parent_policy", `INSERT INTO system_row_access_rules(table_uid,action_id,row_id,user_id,effect) VALUES(701,2,4,4,'deny')`, `DELETE FROM system_row_access_rules WHERE table_uid=701`, 403},
		{"hidden_gallery", `INSERT INTO system_row_access_rules(table_uid,action_id,row_id,user_id,effect) VALUES(702,1,2,4,'deny')`, `DELETE FROM system_row_access_rules WHERE table_uid=702`, 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := owner.Exec(tc.setup); err != nil {
				t.Fatal(err)
			}
			defer func() {
				if _, err := owner.Exec(tc.restore); err != nil {
					t.Error(err)
				}
			}()
			current := cardImageUseForTest(t, owner, 4, 2)
			tx, _, err := callCardImageSave(t, editor, current, false)
			tx.Rollback()
			var refusal *httpresponse.Refusal
			if !errors.As(err, &refusal) || refusal.Status != tc.status {
				t.Fatalf("got %v, want %d", err, tc.status)
			}
		})
	}
	// Both a link change and a source-field change invalidate the old descriptor.
	for _, change := range []string{`UPDATE image_links SET sort_order=8 WHERE id=2`, `UPDATE image_parents SET hero_image='replaced.png' WHERE id=4`} {
		old := cardImageUseForTest(t, owner, 4, 2)
		if _, err := owner.Exec(change); err != nil {
			t.Fatal(err)
		}
		tx, _, err := callCardImageSave(t, editor, old, false)
		tx.Rollback()
		var refusal *httpresponse.Refusal
		if !errors.As(err, &refusal) || refusal.Status != 409 {
			t.Fatalf("changed source accepted: %v", err)
		}
	}
}

func TestCardImageAdoptionIsAtomicAndUsesDisplayedFieldPostgres(t *testing.T) {
	owner, editor := cardImagePostgresFixture(t)
	// Restore the process's paths as other tests do (health_handler_test.go): a package test run may have a relative
	// or unset application root, which Resolve refuses, so the saved value is restored as it was.
	old := runtimepaths.Current()
	t.Cleanup(func() { _ = runtimepaths.Configure(old) })
	root := t.TempDir()
	paths, err := runtimepaths.Resolve(filepath.Join(root, "app"), root, true)
	if err != nil {
		t.Fatal(err)
	}
	if err := runtimepaths.Configure(paths); err != nil {
		t.Fatal(err)
	}
	folder := filepath.Join(paths.StorageRoot, "701", "5", "original")
	if err := os.MkdirAll(folder, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(folder, "701_5_77.png"), []byte("fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	use := cardImageUseForTest(t, owner, 5, 0)
	// A real failure after INSERT must leave neither the link nor its settings.
	if _, err := owner.Exec(`ALTER TABLE image_links ADD CONSTRAINT refuse_test_save CHECK(card_image_presentation IS NULL)`); err != nil {
		t.Fatal(err)
	}
	tx, _, err := callCardImageSave(t, editor, use, true)
	if err == nil {
		tx.Rollback()
		t.Fatal("injected post-adoption failure succeeded")
	}
	tx.Rollback()
	var count int
	if err := owner.QueryRow(`SELECT count(*) FROM image_links WHERE parent_id=5`).Scan(&count); err != nil || count != 0 {
		t.Fatal("partial adoption remains", count, err)
	}
	if _, err := owner.Exec(`ALTER TABLE image_links DROP CONSTRAINT refuse_test_save`); err != nil {
		t.Fatal(err)
	}
	tx, saved, err := callCardImageSave(t, editor, use, true)
	if err != nil {
		tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if saved.LinkRowID <= 0 {
		t.Fatal("adoption has no exact link identity")
	}
	var filename, origin string
	var cached sql.NullString
	if err := owner.QueryRow(`SELECT filename,metadata_json->>'recovered_from' FROM image_links WHERE id=$1`, saved.LinkRowID).Scan(&filename, &origin); err != nil {
		t.Fatal(err)
	}
	if err := owner.QueryRow(`SELECT cached_image FROM image_parents WHERE id=5`).Scan(&cached); err != nil {
		t.Fatal(err)
	}
	if filename != "701_5_77.png" || origin != "hero_image" || cached.Valid {
		t.Fatal("adopted another field", filename, origin, cached)
	}
	// Repeating the original adoption descriptor cannot create another link.
	tx, _, err = callCardImageSave(t, editor, use, true)
	tx.Rollback()
	if err == nil {
		t.Fatal("duplicate adoption accepted")
	}
}
