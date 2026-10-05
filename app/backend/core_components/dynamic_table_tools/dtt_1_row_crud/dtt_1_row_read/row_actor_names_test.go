// row_actor_names_test.go
// Proves group A never joins actor names while ordinary user references still work.
// Covers main and related projections and cached-mark isolation.
// Keeps filters and sorts on the same NULL expression as the displayed label.
package dtt_1_row_read

import (
	"database/sql/driver"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/row_mutation_policy"
	"easelect/backend/core_components/dynamic_table_tools/dtt_models"
	"easelect/backend/core_components/dynamic_table_tools/dtt_utils"
	"strings"
	"testing"
)

func TestActorNamesAreNullWithoutAJoin(t *testing.T) {
	resetJoinMetadataCacheForTests()
	t.Cleanup(resetJoinMetadataCacheForTests)
	fk := dtt_utils.ForeignKey{ReferencedTable: "system_users", ReferencedColumn: "id", NameColumn: "full_name"}
	marks := row_mutation_policy.RowActorColumns{"created_by": "creator", "user_id": "owner"}
	keys := map[string]dtt_utils.ForeignKey{"created_by": fk, "user_id": fk, "reviewer_id": fk}
	db := openBuildJoinsMockDB(t, &buildJoinsQueryCounter{counts: map[string]int{}})
	setCachedJoinMetadata("notes", joinMetadataCacheEntry{tableUID: "42", foreignKeys: keys, actorColumns: marks, fkRelations: map[string]OneMRelation{"user_id": {CachedNameColInSrc: "cached_username"}}})
	// Both storing and reading entries must copy the marks.
	delete(marks, "created_by")
	entry, _ := getCachedJoinMetadata("notes")
	delete(entry.actorColumns, "user_id")
	columns := map[int]dtt_models.ColumnInfo{1: {ColumnName: "created_by"}, 2: {ColumnName: "user_id"}, 3: {ColumnName: "reviewer_id"}}
	selected, joins, expressions, err := buildJoinsWith1MRelations(db, "notes", columns, []int{1, 2, 3})
	if err != nil {
		t.Fatal(err)
	}
	for _, alias := range []string{"created_by_name", "user_name (ln)"} {
		if !strings.Contains(selected, `NULL::text AS "`+alias+`"`) || expressions[alias] != "NULL::text" {
			t.Fatalf("%s: %s %v", alias, selected, expressions)
		}
	}
	if strings.Contains(joins, "created_by_alias") || strings.Contains(joins, "user_id_alias") || !strings.Contains(joins, "reviewer_id_alias") {
		t.Fatalf("wrong joins: %s", joins)
	}
	if !strings.Contains(selected, `"reviewer_id_alias1"."full_name"`) {
		t.Fatal("ordinary user reference changed")
	}
	selected, joins = buildRelatedSelectColumnsWithFKLabels("notes", []string{"created_by", "user_id", "reviewer_id"}, keys, row_mutation_policy.RowActorColumns{"created_by": "creator", "user_id": "owner"})
	if strings.Count(selected, "NULL::text") != 2 || strings.Contains(joins, "created_by_related") || strings.Contains(joins, "user_id_related") || !strings.Contains(joins, "reviewer_id_related") {
		t.Fatalf("related: %s %s", selected, joins)
	}
}

func TestRecreatedDatasetCannotReuseOldActorMarks(t *testing.T) {
	resetJoinMetadataCacheForTests()
	t.Cleanup(resetJoinMetadataCacheForTests)
	counter := &buildJoinsQueryCounter{counts: map[string]int{}, actorRows: [][]driver.Value{{"created_by", "creator"}, {"owner_id", "owner"}}}
	db := openBuildJoinsMockDB(t, counter)
	previousDB := backend.Db
	backend.Db = db
	t.Cleanup(func() { backend.Db = previousDB })
	// The old dataset exposed owner_id as an ordinary user reference. The new
	// dataset has uid 42 and marks it as its owner, even though the name is reused.
	setCachedJoinMetadata("notes", joinMetadataCacheEntry{tableUID: "41", foreignKeys: map[string]dtt_utils.ForeignKey{
		"owner_id": {ReferencedTable: "system_users", ReferencedColumn: "id", NameColumn: "full_name"},
	}})
	selected, joins, expressions, err := buildJoinsWith1MRelations(db, "notes", map[int]dtt_models.ColumnInfo{1: {ColumnName: "owner_id"}}, []int{1})
	if err != nil || joins != "" || expressions["owner_name (ln)"] != "NULL::text" || !strings.Contains(selected, `NULL::text AS "owner_name (ln)"`) {
		t.Fatalf("recreated dataset exposed an actor: %s %s %v %v", selected, joins, expressions, err)
	}
	if counter.get("actor_marks") != 1 {
		t.Fatal("recreated dataset did not load its own marks")
	}
}
