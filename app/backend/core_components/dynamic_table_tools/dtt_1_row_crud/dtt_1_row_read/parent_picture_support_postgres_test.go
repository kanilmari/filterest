// parent_picture_support_postgres_test.go
// Proves denied external parent pictures cannot be rescued through owner reads.
// Uses the existing isolated PostgreSQL fixture, with no gallery relation.
// Covers both provided image metadata and discovery through owner metadata.
package dtt_1_row_read

import (
	"net/url"
	"reflect"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
)

func TestParentPictureSupportDeniedColumnPostgres(t *testing.T) {
	owner, reader := ownerResolverPostgres(t)
	if _, err := owner.Exec(`
CREATE TABLE wl162_parent_picture(id integer PRIMARY KEY, private_picture text);
INSERT INTO wl162_parent_picture VALUES(1,'https://example.org/private-parent.png');
GRANT SELECT(id) ON wl162_parent_picture TO wl58_reader;
ALTER TABLE system_column_details ADD COLUMN card_element text, ADD COLUMN co_number integer,
 ADD COLUMN hide_everywhere boolean DEFAULT false,
 ADD COLUMN client_delivery_mode text DEFAULT 'include', ADD COLUMN show_value_on_card boolean DEFAULT true;
INSERT INTO system_db_tables(table_uid,table_name) VALUES(162,'wl162_parent_picture');
INSERT INTO system_column_details(table_uid,column_name,card_element,co_number) VALUES(162,'private_picture','image',2);
CREATE TABLE system_foreign_key_relations_1_m(source_table_uid bigint,target_table_uid bigint,source_column_name text,target_insert_specs jsonb);
GRANT SELECT ON system_foreign_key_relations_1_m TO wl58_reader;`); err != nil {
		t.Fatal(err)
	}
	old := backend.Db
	backend.Db = owner
	t.Cleanup(func() { backend.Db = old })
	var denied string
	if err := reader.QueryRow(`SELECT private_picture FROM wl162_parent_picture`).Scan(&denied); err == nil {
		t.Fatal("fixture reader can select the private picture")
	}
	for _, metadata := range []string{"provided", "discovered"} {
		for _, view := range []string{"card", "article_view", "product_card"} {
			t.Run(metadata+"/"+view, func(t *testing.T) {
				var id int64
				if err := reader.QueryRow(`SELECT id FROM wl162_parent_picture`).Scan(&id); err != nil {
					t.Fatal("authorized row unavailable", err)
				}
				rows := []map[string]interface{}{{"id": id}}
				var columns map[int]dtt_models.ColumnInfo
				if metadata == "provided" {
					columns = map[int]dtt_models.ColumnInfo{2: {ColumnName: "private_picture", CardElement: "image"}}
				}
				if err := prepareRowsForResponse(reader, "wl162_parent_picture", rows, columns, []string{"id"},
					dbutils.NewRequestActorContext(4, "basic"), resolveRowSupportRequest(url.Values{"view_key": {view}}), nil); err != nil {
					t.Fatal("optional picture denial rejected the authorized row", err)
				}
				if !reflect.DeepEqual(rows, []map[string]interface{}{{"id": int64(1)}}) {
					t.Fatal("owner rescued the denied external picture", rows)
				}
			})
		}
	}
}
