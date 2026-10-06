// gallery_integration_postgres_test.go
// Runs real gallery work from outside the runtime policy package.
// Prevents handler imports creating a test cycle now that handlers use the policy.
// Keeps both accepted commit-1 gallery regression proofs intact.
package runtime_grants_test

import (
	"context"
	"easelect/backend/core_components/dynamic_table_tools/dtt_asset_linking"
	"easelect/backend/core_components/dynamic_table_tools/dtt_card_picture"
	. "easelect/backend/core_components/runtime_grants"
	"easelect/backend/core_components/runtimepaths"
	"github.com/lib/pq"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSharedGalleryUpdateOnlyAdoptionPostgres(t *testing.T) {
	owner, connect, config, _ := ReviewPostgresFixture(t)
	FixtureExec(t, owner, `DELETE FROM system_triggers;
 DELETE FROM system_group_table_func_rights;
 CREATE TABLE gallery_parent(id integer PRIMARY KEY,cached_image text);
 CREATE TABLE gallery_assets(id serial PRIMARY KEY,parent_id integer,filename text,asset_kind text,sort_order integer,is_primary boolean,metadata_json jsonb);
 CREATE TABLE gallery_attachments(id integer PRIMARY KEY,parent_id integer,stored_name text,private text);
 INSERT INTO system_db_tables VALUES(18,8,'gallery_parent','public','gallery_parent'::regclass::oid,NULL),(19,9,'gallery_assets','public','gallery_assets'::regclass::oid,NULL),(20,10,'gallery_attachments','public','gallery_attachments'::regclass::oid,NULL);
 INSERT INTO system_group_table_func_rights VALUES(2,3,9);
 INSERT INTO system_foreign_key_relations_1_m VALUES
 (9,8,'parent_id','id',NULL,false,'{"file_upload":{"filename_column":"filename","profiles":{"image":{"asset_kinds":["image"]}}}}',80),
 (10,8,'parent_id','id',NULL,false,'{"file_upload":{"filename_column":"stored_name","profile_key":"attachment"}}',81);
 INSERT INTO gallery_parent VALUES(1,'8_1_1.jpg');
 INSERT INTO gallery_assets(parent_id,filename,asset_kind,sort_order,is_primary) VALUES(1,'8_1_2.jpg','image',1,false);
 INSERT INTO gallery_attachments VALUES(1,1,'attachment.pdf','private attachment')`)
	s := ReadFixtureSnapshot(t, owner, config)
	grants := GrantsFor(t, s)
	ApplyFixtureGrants(t, owner, s, grants)
	// Product metadata reads stay with the runtime roles until stage 2c (plan V2: reads are add-only here), and the
	// canonical rule discovers the gallery through them, as it does on a site.
	FixtureExec(t, owner, "GRANT SELECT ON system_foreign_key_relations_1_m, system_db_tables TO "+pq.QuoteIdentifier(config.Names["basic"]))
	basic := connect(config.Names["basic"])
	var private string
	if err := basic.QueryRow(`SELECT private FROM gallery_attachments`).Scan(&private); err == nil {
		t.Fatal("sibling private column was granted")
	}
	// The canonical rule sees a real surviving old picture and must adopt it.
	paths, err := runtimepaths.Resolve(t.TempDir(), t.TempDir(), true)
	if err != nil {
		t.Fatal(err)
	}
	ConfigureReviewRuntimePaths(t, paths)
	folder := filepath.Join(paths.StorageRoot, "8", "1", "original")
	if err := os.MkdirAll(folder, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(folder, "8_1_1.jpg"), []byte("fixture picture"), 0600); err != nil {
		t.Fatal(err)
	}
	tx, err := basic.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`UPDATE gallery_assets SET is_primary=true WHERE id=1`); err != nil {
		t.Fatal(err)
	}
	gallery, err := dtt_card_picture.PictureRelationOf(tx, "gallery_parent")
	if err != nil || gallery == nil {
		t.Fatal("canonical gallery discovery", err)
	}
	if err := dtt_asset_linking.ApplyCardPictureRule(tx, "gallery_parent", gallery, []int64{1}, nil); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	var preview string
	var adopted int
	if err := owner.QueryRow(`SELECT cached_image FROM gallery_parent WHERE id=1`).Scan(&preview); err != nil || preview != "8_1_2.jpg" {
		t.Fatal("preview stale after update-only mutation", preview, err)
	}
	if err := owner.QueryRow(`SELECT count(*) FROM gallery_assets WHERE filename='8_1_1.jpg'`).Scan(&adopted); err != nil || adopted != 1 {
		t.Fatal("previous picture not preserved", adopted, err)
	}
}

func TestGalleryParentAdoptionDoesNotSettleNestedRowsPostgres(t *testing.T) {
	owner, connect, config, _ := ReviewPostgresFixture(t)
	FixtureExec(t, owner, `CREATE TABLE gallery_parent(id integer PRIMARY KEY,cached_image text);
 CREATE TABLE gallery_assets(id serial PRIMARY KEY,parent_id integer,filename text,asset_kind text,sort_order integer,is_primary boolean,metadata_json jsonb,cached_image text);
 CREATE TABLE nested_gallery_assets(id serial PRIMARY KEY,parent_id integer,filename text,asset_kind text,sort_order integer,is_primary boolean,metadata_json jsonb);
 INSERT INTO system_db_tables VALUES(18,8,'gallery_parent','public','gallery_parent'::regclass::oid,NULL),(19,9,'gallery_assets','public','gallery_assets'::regclass::oid,NULL),(20,10,'nested_gallery_assets','public','nested_gallery_assets'::regclass::oid,NULL);
 INSERT INTO system_group_table_func_rights VALUES(2,2,8);
 INSERT INTO system_foreign_key_relations_1_m VALUES
 (9,8,'parent_id','id',NULL,false,'{"file_upload":{"filename_column":"filename","profiles":{"image":{}}}}',80),
 (10,9,'parent_id','id',NULL,false,'{"file_upload":{"filename_column":"filename","profiles":{"image":{}}}}',81);
 INSERT INTO gallery_parent VALUES(1,'8_1_1.jpg');
 INSERT INTO gallery_assets(parent_id,filename,asset_kind,sort_order,is_primary) VALUES(1,'8_1_2.jpg','image',1,true)`)
	s := ReadFixtureSnapshot(t, owner, config)
	ApplyFixtureGrants(t, owner, s, GrantsFor(t, s))
	FixtureExec(t, owner, "GRANT SELECT ON system_foreign_key_relations_1_m, system_db_tables TO "+pq.QuoteIdentifier(config.Names["basic"]))
	basic := connect(config.Names["basic"])
	for _, privilege := range []string{"UPDATE(sort_order)", "UPDATE(is_primary)", "UPDATE(cached_image)"} {
		var allowed bool
		column := strings.TrimSuffix(strings.TrimPrefix(privilege, "UPDATE("), ")")
		if err := basic.QueryRow(`SELECT has_column_privilege('gallery_assets',$1,'UPDATE')`, column).Scan(&allowed); err != nil || allowed {
			t.Fatal("parent adoption acquired child callback write", privilege, err)
		}
	}
	var allowed bool
	if err := basic.QueryRow(`SELECT has_table_privilege('nested_gallery_assets','INSERT') OR has_sequence_privilege('nested_gallery_assets_id_seq','USAGE')`).Scan(&allowed); err != nil || allowed {
		t.Fatal("nested adoption acquired phantom INSERT/sequence", err)
	}
	paths, err := runtimepaths.Resolve(t.TempDir(), t.TempDir(), true)
	if err != nil {
		t.Fatal(err)
	}
	ConfigureReviewRuntimePaths(t, paths)
	folder := filepath.Join(paths.StorageRoot, "8", "1", "original")
	if err := os.MkdirAll(folder, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(folder, "8_1_1.jpg"), []byte("fixture picture"), 0600); err != nil {
		t.Fatal(err)
	}
	tx, err := basic.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	gallery, err := dtt_card_picture.PictureRelationOf(tx, "gallery_parent")
	if err != nil || gallery == nil {
		t.Fatal("canonical gallery discovery", err)
	}
	if err := dtt_asset_linking.ApplyCardPictureRule(tx, "gallery_parent", gallery, []int64{1}, nil); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	var preview string
	var adopted int
	if err := owner.QueryRow(`SELECT cached_image FROM gallery_parent WHERE id=1`).Scan(&preview); err != nil || preview != "8_1_2.jpg" {
		t.Fatal("parent-only rule did not update preview", preview, err)
	}
	if err := owner.QueryRow(`SELECT count(*) FROM gallery_assets WHERE filename='8_1_1.jpg'`).Scan(&adopted); err != nil || adopted != 1 {
		t.Fatal("parent-only rule did not adopt old picture", adopted, err)
	}
}
