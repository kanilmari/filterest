// vector_search_projection_test.go
// Pins the vector projection's known-and-readable column intersection without PostgreSQL.
// Connects the shared projection filter to the vector handler's JOIN builder.
// Protects complete grants, absent optional media fields and metadata isolation.
package dtt_1_row_read

import (
	"reflect"
	"testing"

	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
	dtt_utils "easelect/backend/core_components/dynamic_table_tools/dtt_utils"
)

func TestVectorQueryColumnsProjectionIntersection(t *testing.T) {
	known := map[int]dtt_models.ColumnInfo{
		1: {ColumnName: "id"}, 2: {ColumnName: "label"},
		3: {ColumnName: "image", CardElement: "image"}, 4: {ColumnName: "thumbnail"},
	}
	for _, tc := range []struct {
		name    string
		allowed map[string]bool
		want    []int
	}{
		{"complete_grants", map[string]bool{"id": true, "label": true, "image": true, "thumbnail": true}, []int{1, 2, 3, 4}},
		{"restricted", map[string]bool{"id": true, "image": true, "thumbnail": true}, []int{1, 3, 4}},
		{"optional_media_denied", map[string]bool{"id": true, "label": true}, []int{1, 2}},
		{"unknown_grant", map[string]bool{"id": true, "unknown": true}, []int{1}},
		{"false_grant", map[string]bool{"id": true, "label": false}, []int{1}},
		{"no_evidence", nil, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			want := make(map[int]dtt_models.ColumnInfo, len(tc.want))
			for _, uid := range tc.want {
				want[uid] = known[uid]
			}
			got := filterReadableColumnMetadata(known, tc.allowed)
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("projection=%v want=%v", got, want)
			}
			// Projection must not erase known metadata used to reject URL filters.
			delete(got, 1)
			if len(known) != 4 || known[1].ColumnName != "id" {
				t.Fatal("projection mutated the known-column set")
			}
		})
	}
}

func TestVectorQueryColumnsProjectionDropsUnreadableForeignJoin(t *testing.T) {
	db := openBuildJoinsMockDB(t, &buildJoinsQueryCounter{counts: map[string]int{}})
	resetJoinMetadataCacheForTests()
	t.Cleanup(resetJoinMetadataCacheForTests)
	setCachedJoinMetadata("tasks", joinMetadataCacheEntry{
		tableUID: "42",
		foreignKeys: map[string]dtt_utils.ForeignKey{
			"target_id": {ReferencedTable: "targets", ReferencedColumn: "id", NameColumn: "title"},
		},
	})
	known := map[int]dtt_models.ColumnInfo{1: {ColumnName: "id"}, 2: {ColumnName: "target_id"}}
	readable := filterReadableColumnMetadata(known, map[string]bool{"id": true})
	uids := make([]int, 0, len(readable))
	for uid := range readable {
		uids = append(uids, uid)
	}
	projection, joins, expressions, args, err := buildJoinsWith1MRelations(db, "tasks", known, uids, nil, 0)
	if err != nil || projection != `"tasks"."id" AS "id"` || joins != "" || len(expressions) != 1 || len(args) != 0 {
		t.Fatalf("unreadable FK reached projection or JOIN: %s %s %v %v %v", projection, joins, expressions, args, err)
	}
}
