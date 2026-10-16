// record_title_metadata_postgres_test.go
// Proves natural-label delivery follows actual per-column PostgreSQL grants.
// Connects the row reader's SELECT intersection to shared cached table metadata.
// Keeps denied labels absent before and after a cached-schema permission change.
package dtt_1_row_read

import (
	"testing"

	"easelect/backend/core_components/dynamic_table_tools/dtt_models"
	dtt_utils "easelect/backend/core_components/dynamic_table_tools/dtt_utils"
)

func TestNaturalRecordLabelColumnGrantsPostgres(t *testing.T) {
	owner, reader := ownerResolverPostgres(t)
	if _, err := owner.Exec(`CREATE TABLE title_grants(id integer PRIMARY KEY, label text, private_label text);
 INSERT INTO title_grants VALUES(1,'Readable','Private');
 GRANT SELECT(id,label) ON title_grants TO wl58_reader;`); err != nil {
		t.Fatal(err)
	}
	cached := dtt_models.TableReadMeta{FKDisplayColumn: "private_label"}
	types := map[string]interface{}{"id": map[string]interface{}{}, "label": map[string]interface{}{}, "private_label": map[string]interface{}{}}
	check := func(want string) {
		t.Helper()
		columns, err := fetchUserSelectableColumns(reader, "title_grants")
		if err != nil {
			t.Fatal(err)
		}
		if got := authorizedRecordTitleMeta(cached, columns, types).FKDisplayColumn; got != want {
			t.Fatalf("label=%q want=%q, columns=%v", got, want, columns)
		}
	}
	check("")
	if _, err := owner.Exec(`GRANT SELECT(private_label) ON title_grants TO wl58_reader`); err != nil {
		t.Fatal(err)
	}
	check("private_label")
	if _, err := owner.Exec(`REVOKE SELECT(private_label) ON title_grants FROM wl58_reader`); err != nil {
		t.Fatal(err)
	}
	check("")
}

// The lookup must distinguish actual target facts from a readable source FK.
// ownerResolverPostgres owns and removes its complete disposable cluster.
func TestRecordTitleRelationTargetMetadataPostgres(t *testing.T) {
	owner, _ := ownerResolverPostgres(t)
	if _, err := owner.Exec(`
 ALTER TABLE system_column_details ADD COLUMN is_multilingual boolean DEFAULT false,
   ADD COLUMN hide_everywhere boolean DEFAULT false,
   ADD COLUMN client_delivery_mode text DEFAULT 'include';
 CREATE TABLE title_customers(id integer PRIMARY KEY, name text, hidden text, server_only text,
   plain_json jsonb, multilingual jsonb, unregistered text, api_token text);
 INSERT INTO system_db_tables(table_uid,table_name) VALUES(100,'title_customers');
 INSERT INTO system_column_details(table_uid,column_name,is_multilingual,hide_everywhere,client_delivery_mode) VALUES
   (100,'name',false,false,'include'), (100,'hidden',false,true,'include'),
   (100,'server_only',false,false,'server_only'), (100,'plain_json',false,false,'include'),
   (100,'multilingual',true,false,'include'), (100,'api_token',false,false,'include'),
   (100,'missing_physical_field',false,false,'include');`); err != nil {
		t.Fatal(err)
	}
	keys := map[string]dtt_utils.ForeignKey{}
	for _, column := range []string{"name", "hidden", "server_only", "plain_json", "multilingual", "unregistered", "api_token", "missing_physical_field"} {
		keys[column+"_id"] = dtt_utils.ForeignKey{ReferencedTable: "title_customers", NameColumn: column}
	}
	targets, err := fetchRecordTitleAliasTargets(owner, keys)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]recordTitleTargetMetadata{
		"name_id":         {DataType: "text", ClientDeliveryMode: "include"},
		"hidden_id":       {DataType: "text", HideEverywhere: true, ClientDeliveryMode: "include"},
		"server_only_id":  {DataType: "text", ClientDeliveryMode: "server_only"},
		"plain_json_id":   {DataType: "jsonb", ClientDeliveryMode: "include"},
		"multilingual_id": {DataType: "jsonb", IsMultilingual: true, ClientDeliveryMode: "include"},
		"api_token_id":    {DataType: "text", ClientDeliveryMode: "include"},
	}
	if len(targets) != len(want) {
		t.Fatalf("unregistered or missing target received metadata: %+v", targets)
	}
	for column, expected := range want {
		if targets[column] != expected {
			t.Fatalf("%s metadata=%+v want=%+v", column, targets[column], expected)
		}
	}
}
