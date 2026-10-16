// record_title_metadata_test.go
// Proves natural labels are redacted per request, without changing cached metadata.
// Connects the SELECT/visibility intersection to the record-title response contract.
// Prevents one actor's cached label from exposing a restricted column to another.
package dtt_1_row_read

import (
	"database/sql/driver"
	"fmt"
	"reflect"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dynamic_table_tools/dtt_models"
	dtt_utils "easelect/backend/core_components/dynamic_table_tools/dtt_utils"
)

func TestNaturalRecordLabelRequiresAuthorizedVisibleColumn(t *testing.T) {
	cached := dtt_models.TableReadMeta{FKDisplayColumn: "category_id"}
	for _, test := range []struct {
		name        string
		columns     []string
		description map[string]interface{}
		want        string
	}{
		{"authorized relation source", []string{"category_id"}, map[string]interface{}{"foreign_table": "categories"}, "category_id"},
		{"restricted or unselected source", []string{"id"}, map[string]interface{}{}, ""},
		{"missing metadata", []string{"category_id"}, nil, ""},
		{"hidden everywhere", []string{"category_id"}, map[string]interface{}{"hide_everywhere": true}, ""},
		{"server only", []string{"category_id"}, map[string]interface{}{"client_delivery_mode": "server_only"}, ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			types := map[string]interface{}{}
			if test.description != nil {
				types["category_id"] = test.description
			}
			got := authorizedRecordTitleMeta(cached, test.columns, types)
			if got.FKDisplayColumn != test.want {
				t.Fatalf("label=%q want=%q", got.FKDisplayColumn, test.want)
			}
			if cached.FKDisplayColumn != "category_id" {
				t.Fatal("redaction mutated the cache")
			}
		})
	}
}

func TestRecordTitleAliasTargetFactsAreCopiedPerResponse(t *testing.T) {
	resetJoinMetadataCacheForTests()
	t.Cleanup(resetJoinMetadataCacheForTests)
	for _, target := range []recordTitleTargetMetadata{
		{DataType: "text", ClientDeliveryMode: "include"},
		{DataType: "text", HideEverywhere: true, ClientDeliveryMode: "include"},
		{DataType: "text", ClientDeliveryMode: "server_only"},
		{DataType: "jsonb", ClientDeliveryMode: "include"},
		{DataType: "jsonb", IsMultilingual: true, ClientDeliveryMode: "include"},
	} {
		t.Run(target.DataType+target.ClientDeliveryMode+fmt.Sprint(target.HideEverywhere, target.IsMultilingual), func(t *testing.T) {
			source := map[string]interface{}{"foreign_table": "customers", "data_type": "integer"}
			types := map[string]interface{}{"customer_id": source}
			setCachedSchemaMetadata("notes", &schemaCacheEntry{columnDataTypes: types, cachedAt: time.Now()})
			t.Cleanup(func() { InvalidateSchemaCache("notes") })
			setCachedJoinMetadata("notes", joinMetadataCacheEntry{
				foreignKeys:  map[string]dtt_utils.ForeignKey{"customer_id": {ReferencedTable: "customers", NameColumn: "name"}},
				titleTargets: map[string]recordTitleTargetMetadata{"customer_id": target},
			})
			annotated := recordTitleAliasSources("notes", getCachedSchemaMetadata("notes").columnDataTypes)
			column := annotated["customer_id"].(map[string]interface{})
			facts := column["foreign_display_metadata"].(map[string]interface{})
			want := map[string]interface{}{"data_type": target.DataType, "is_multilingual": target.IsMultilingual,
				"hide_everywhere": target.HideEverywhere, "client_delivery_mode": target.ClientDeliveryMode}
			if !reflect.DeepEqual(facts, want) || column["data_type"] != "integer" || column["foreign_display_column"] != "name" {
				t.Fatalf("target facts or source type changed: %v", column)
			}
			facts["hide_everywhere"] = !target.HideEverywhere
			column["authorized"] = false
			delete(annotated, "customer_id")
			if !reflect.DeepEqual(source, map[string]interface{}{"foreign_table": "customers", "data_type": "integer"}) {
				t.Fatalf("response mutated cached schema: %v", source)
			}
			next := recordTitleAliasSources("notes", types)["customer_id"].(map[string]interface{})
			if !reflect.DeepEqual(next["foreign_display_metadata"], want) || next["authorized"] != nil {
				t.Fatalf("another request inherited response changes: %v", next)
			}
		})
	}
}

func TestRecordTitleAliasTargetsReadAsOneSchemaBatch(t *testing.T) {
	counter := &buildJoinsQueryCounter{counts: map[string]int{}, titleRows: [][]driver.Value{
		{"customer_id", "text", false, true, "include"},
		{"label_id", "jsonb", true, false, "include"},
		{"code_id", "text", false, false, "server_only"},
	}}
	db := openBuildJoinsMockDB(t, counter)
	keys := map[string]dtt_utils.ForeignKey{}
	for _, source := range []string{"customer_id", "label_id", "code_id", "unregistered_id"} {
		keys[source] = dtt_utils.ForeignKey{ReferencedTable: "customers", NameColumn: "name"}
	}
	targets, err := fetchRecordTitleAliasTargets(db, keys)
	if err != nil || len(targets) != 3 || counter.get("title_targets") != 1 {
		t.Fatalf("schema batch targets=%v err=%v count=%d", targets, err, counter.get("title_targets"))
	}
	if !targets["customer_id"].HideEverywhere || !targets["label_id"].IsMultilingual || targets["code_id"].ClientDeliveryMode != "server_only" {
		t.Fatalf("target flags were not preserved: %+v", targets)
	}
	if _, proven := targets["unregistered_id"]; proven {
		t.Fatal("unregistered target received safe defaults")
	}
	if _, err := fetchRecordTitleAliasTargets(nil, nil); err != nil {
		t.Fatal(err)
	}
}

func TestRecordTitleAliasSourcesUseExistingCacheWithoutMutation(t *testing.T) {
	resetJoinMetadataCacheForTests()
	t.Cleanup(resetJoinMetadataCacheForTests)
	types := map[string]interface{}{"category_id": map[string]interface{}{"foreign_table": "categories"}}
	setCachedJoinMetadata("notes", joinMetadataCacheEntry{foreignKeys: map[string]dtt_utils.ForeignKey{
		"category_id": {NameColumn: "api_token"},
	}})
	annotated := recordTitleAliasSources("notes", types)
	if annotated["category_id"].(map[string]interface{})["foreign_display_column"] != "api_token" {
		t.Fatal("alias lost its actual source")
	}
	if types["category_id"].(map[string]interface{})["foreign_display_column"] != nil {
		t.Fatal("shared schema metadata mutated")
	}
}

func TestRelatedRecordTitleAliasSourcesUseAuthorizedSchemaFacts(t *testing.T) {
	for _, scenario := range []struct {
		name   string
		rows   [][]driver.Value
		err    error
		proven bool
	}{
		{"visible multilingual", [][]driver.Value{{"customer_id", "jsonb", true, false, "include"}}, nil, true},
		{"hidden", [][]driver.Value{{"customer_id", "text", false, true, "include"}}, nil, true},
		{"server only", [][]driver.Value{{"customer_id", "text", false, false, "server_only"}}, nil, true},
		{"missing", nil, nil, false},
		{"lookup failed", nil, fmt.Errorf("schema unavailable"), false},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			resetJoinMetadataCacheForTests()
			t.Cleanup(resetJoinMetadataCacheForTests)
			counter := &buildJoinsQueryCounter{counts: map[string]int{}, titleRows: scenario.rows, titleErr: scenario.err}
			db := openBuildJoinsMockDB(t, counter)
			previousDB := backend.Db
			backend.Db = db
			t.Cleanup(func() { backend.Db = previousDB })
			types := map[string]interface{}{
				"customer_id": map[string]interface{}{"foreign_table": "customers", "data_type": "integer"},
				"denied_id":   map[string]interface{}{"data_type": "integer"},
			}
			original := cloneRelatedDataTypes(types)
			keys := map[string]dtt_utils.ForeignKey{"customer_id": {ReferencedTable: "customers", NameColumn: "name"}}
			// Related joins can use different targets from a warm listing cache.
			setCachedJoinMetadata("notes", joinMetadataCacheEntry{foreignKeys: map[string]dtt_utils.ForeignKey{
				"customer_id": {ReferencedTable: "customers", NameColumn: "old_name"},
			}})
			got := relatedRecordTitleAliasSources(nil, keys, types)
			column := got["customer_id"].(map[string]interface{})
			facts, proven := column["foreign_display_metadata"].(map[string]interface{})
			if proven != scenario.proven || column["foreign_display_column"] != "name" || counter.get("title_targets") != 1 {
				t.Fatalf("related alias facts=%v, schema reads=%d", column, counter.get("title_targets"))
			}
			if proven {
				want := scenario.rows[0]
				if facts["data_type"] != want[1] || facts["is_multilingual"] != want[2] ||
					facts["hide_everywhere"] != want[3] || facts["client_delivery_mode"] != want[4] {
					t.Fatalf("target facts changed: %v", facts)
				}
				facts["hide_everywhere"] = true
			}
			if got["denied_id"].(map[string]interface{})["foreign_display_metadata"] != nil {
				t.Fatal("denied join received target proof")
			}
			column["authorized"] = false
			if !reflect.DeepEqual(types, original) {
				t.Fatal("related response modified shared source types")
			}
			cached, _ := getCachedJoinMetadata("notes")
			if cached.foreignKeys["customer_id"].NameColumn != "old_name" || len(cached.titleTargets) != 0 {
				t.Fatal("related response changed the listing join cache")
			}
		})
	}
	if got := relatedRecordTitleAliasSources(nil, nil, map[string]interface{}{}); len(got) != 0 {
		t.Fatal("empty joins should need no schema read")
	}
}

func TestIntelligentResultStageLoadsTitleFactsAfterEmptyTextStage(t *testing.T) {
	resetJoinMetadataCacheForTests()
	t.Cleanup(resetJoinMetadataCacheForTests)
	types := map[string]interface{}{"queue_id": map[string]interface{}{"data_type": "integer", "foreign_table": "queues"}}
	rows, columns, err := fetchRowsInOrder(nil, "tasks", nil, intelligentSearchAuthorization{})
	if err != nil {
		t.Fatal(err)
	}
	text := intelligentResultStage("text", "tasks", columns, rows, types)
	// The AI row query populates the cache only after the text packet is sent.
	setCachedJoinMetadata("tasks", joinMetadataCacheEntry{
		foreignKeys: map[string]dtt_utils.ForeignKey{"queue_id": {ReferencedTable: "queues", NameColumn: "name"}},
		titleTargets: map[string]recordTitleTargetMetadata{"queue_id": {
			DataType: "jsonb", IsMultilingual: true, ClientDeliveryMode: "include",
		}},
	})
	aiRows := []map[string]interface{}{{"queue_id": 9, "queue_name (ln)": `{"en":"Feature development","fi":"Ominaisuuksien kehitys"}`}}
	ai := intelligentResultStage("ai", "tasks", []string{"queue_id"}, aiRows, types)
	column := ai["types"].(map[string]interface{})["queue_id"].(map[string]interface{})
	if column["foreign_display_column"] != "name" || column["foreign_display_metadata"] == nil {
		t.Fatalf("AI-only result lost its relation title facts: %v", ai)
	}
	column["foreign_display_metadata"].(map[string]interface{})["hide_everywhere"] = true
	for _, previous := range []map[string]interface{}{types, text["types"].(map[string]interface{})} {
		if previous["queue_id"].(map[string]interface{})["foreign_display_metadata"] != nil {
			t.Fatal("AI response modified the source or an already-sent stage")
		}
	}
}
