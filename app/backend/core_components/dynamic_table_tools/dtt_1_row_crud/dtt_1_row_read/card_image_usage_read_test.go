// card_image_usage_read_test.go
// Proves per-field, non-first gallery enrichment and separate use identities.
// Covers the map projection used after authorized gallery and parent reads.
// Ambiguous files and invisible links never supply another use's settings.
package dtt_1_row_read

import (
	"easelect/backend/core_components/dbutils"
	pictures "easelect/backend/core_components/dynamic_table_tools/dtt_card_picture"
	"testing"
)

func TestCardImageUsageProjectionAndVisibilityPostgres(t *testing.T) {
	db := relatedCardPicturePostgres(t)
	_, err := db.Exec(`ALTER TABLE system_column_details ADD COLUMN must_be_true_unless_own boolean DEFAULT false;
CREATE TABLE system_foreign_key_relations_1_m(id bigint,source_table_uid bigint,target_table_uid bigint,source_column_name text);
CREATE TABLE system_functions(id bigint,url_route_endpoint text,disabled boolean);
CREATE TABLE system_group_table_func_rights(user_group_id bigint,function_id bigint,target_table_uid bigint);
CREATE TABLE system_user_group_memberships(user_id bigint,group_id bigint);
CREATE FUNCTION resolve_effective_row_access(text,bigint,bigint,text,boolean,boolean) RETURNS boolean LANGUAGE SQL AS 'SELECT $5 AND $2<>13';
CREATE TABLE brands_assets(id bigint PRIMARY KEY,parent_id bigint,filename text,card_image_presentation text,
 card_image_focal_x numeric,card_image_focal_y numeric);
INSERT INTO system_db_tables VALUES(302,'brands_assets','public');
INSERT INTO system_foreign_key_relations_1_m VALUES(9,302,300,'parent_id');
INSERT INTO system_functions VALUES(1,'/api/get-results',false);
INSERT INTO system_user_group_memberships VALUES(7,2);
INSERT INTO system_group_table_func_rights VALUES(2,1,302);
INSERT INTO brands_assets VALUES(11,1,'first.png','contain',NULL,NULL),(12,1,'second.png','cover',0.2,0.8),(13,1,'hidden.png','contain_blur',NULL,NULL);`)
	if err != nil {
		t.Fatal(err)
	}
	gallery := &cardGalleryRead{discovered: true, parentTableUID: "300", relation: &pictures.PictureRelation{
		ChildTable: "brands_assets", ForeignKey: "parent_id", FilenameColumn: "filename", HasCardImageSettings: true,
		Columns: pictures.GalleryColumns{ID: true},
	}}
	rows := []map[string]interface{}{{"id": int64(1), "cached_image": "second.png", "logo_image": "hidden.png"}}
	if err := enrichRowsWithCanonicalAssetImages(db, "brands", rows, []int64{1}, dbutils.NewRequestActorContext(7, "basic"), gallery); err != nil {
		t.Fatal(err)
	}
	use, ok := rows[0]["cached_image_usage"].(pictures.CardImageUse)
	if !ok || use.LinkRowID != 12 || *rows[0]["cached_image_presentation"].(*string) != "cover" {
		t.Fatal(rows)
	}
	if _, ok := rows[0]["logo_image_presentation"]; ok {
		t.Fatal("hidden link disclosed its presentation", rows)
	}
}

func TestCardImageUsageFollowsExactFieldAndNonFirstImage(t *testing.T) {
	cover, contain := "cover", "contain"
	x, y := 0.2, 0.8
	images := []canonicalAssetImageValue{
		{filename: "first.png", linkID: 11, linkVersion: "30", presentation: &contain},
		{filename: "second.png", linkID: 12, linkVersion: "31", presentation: &cover, focalX: &x, focalY: &y, title: "Second"},
	}
	row := map[string]interface{}{"id": int64(4), "cached_image": "first.png", "hero_image": "second.png", "image": "external.jpg"}
	applyExactCardImageUses(row, "example", 4, "20", 9, "101", []string{"cached_image", "hero_image", "image"}, images)
	first := row["cached_image_usage"].(pictures.CardImageUse)
	second := row["hero_image_usage"].(pictures.CardImageUse)
	if first.LinkRowID != 11 || second.LinkRowID != 12 || second.Column != "hero_image" || first.Version == second.Version {
		t.Fatal(first, second)
	}
	if *row["hero_image_presentation"].(*string) != "cover" || row["hero_image_title"] != "Second" {
		t.Fatal(row)
	}
	if row["image_usage"].(pictures.CardImageUse).LinkRowID != 0 {
		t.Fatal("unlinked image identified as a gallery use")
	}
	if _, ok := row["image_presentation"]; ok {
		t.Fatal("unlinked image borrowed another use's setting")
	}
}

func TestCardImageUsageRefusesAmbiguousAndHiddenSettings(t *testing.T) {
	cover := "cover"
	row := map[string]interface{}{"cached_image": "same.png"}
	applyExactCardImageUses(row, "example", 4, "20", 9, "101", []string{"cached_image"}, []canonicalAssetImageValue{
		{filename: "same.png", linkID: 11, presentation: &cover}, {filename: "same.png", linkID: 12},
	})
	if _, ok := row["cached_image_usage"]; ok {
		t.Fatal("ambiguous URL became a writable identity")
	}
	applyExactCardImageUses(row, "example", 4, "20", 9, "101", []string{"cached_image"}, nil)
	if _, ok := row["cached_image_presentation"]; ok {
		t.Fatal("invisible image settings exposed")
	}
}
