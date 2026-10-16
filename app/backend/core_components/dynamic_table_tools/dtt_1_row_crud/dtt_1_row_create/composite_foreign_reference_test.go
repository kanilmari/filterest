// composite_foreign_reference_test.go
// Checks add-row's full-key binding, NULL handling and missing-component refusal.
// Uses the existing SQL queue driver and actual shared reference checker.
// Protects new-row authorization while keeping all previous tests unchanged.
package dtt_1_row_create

import (
	"database/sql/driver"
	"errors"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dynamic_table_tools/dtt_models"
)

func TestAddRowCompositeForeignReferenceUsesSubmittedTuple(t *testing.T) {
	key := dtt_models.ForeignKeyTuple{ConstraintID: 12, TargetSchema: "public", TargetTable: "targets",
		SourceColumns: []string{"target_x", "target_y"}, TargetColumns: []string{"x", "y"}}
	columns := []dtt_models.AddRowColumnInfo{
		{ColumnName: "target_x", ForeignTableName: "targets", ForeignColumnName: "x", IsCompositeForeignKey: true, CompositeForeignKeys: []dtt_models.ForeignKeyTuple{key}},
		{ColumnName: "target_y", ForeignTableName: "targets", ForeignColumnName: "y", IsCompositeForeignKey: true, CompositeForeignKeys: []dtt_models.ForeignKeyTuple{key}},
	}
	for _, visible := range []bool{false, true} {
		name := "hidden_tuple"
		if visible {
			name = "readable_tuple"
		}
		t.Run(name, func(t *testing.T) {
			tx := relationKeyTx(t)
			pushQuery(queuedQuery{cols: []string{"allowed"}, rows: [][]driver.Value{{int64(1)}}})
			pushQuery(queuedQuery{wantSQL: `SELECT "id" FROM "targets" WHERE ("x","y") = ($1,$2) FOR KEY SHARE`,
				wantArgs: []driver.Value{int64(101), "B"}, cols: []string{"id"}, rows: [][]driver.Value{{int64(2)}}})
			pushQuery(queuedQuery{cols: []string{"column_name"}})
			visibility := queuedQuery{wantSQL: `SELECT "targets"."id" FROM "targets" WHERE "targets"."id" = ANY($1) AND ("targets"."x","targets"."y") = ($2,$3) ORDER BY "targets"."id" FOR KEY SHARE`,
				wantArgs: []driver.Value{"{2}", int64(101), "B"}, cols: []string{"id"}}
			if visible {
				visibility.rows = [][]driver.Value{{int64(2)}}
			}
			pushQuery(visibility)
			refs, err := validateMainForeignKeyReads(tx, columns, map[string]interface{}{"target_x": 101, "target_y": "B"}, 4, "admin", nil)
			if visible {
				if err != nil || len(refs) != 1 || refs[0].rowID != 2 {
					t.Fatalf("complete-key reference: %+v, %v", refs, err)
				}
			} else {
				var refusal *forbiddenError
				if !errors.As(err, &refusal) {
					t.Fatalf("hidden tuple: %v; want forbidden", err)
				}
			}
		})
	}
	t.Run("missing_component", func(t *testing.T) {
		if _, err := validateMainForeignKeyReads(nil, columns, map[string]interface{}{"target_x": 101}, 4, "admin", nil); err == nil {
			t.Fatal("missing tuple component was accepted")
		}
	})
	t.Run("null_component", func(t *testing.T) {
		refs, err := validateMainForeignKeyReads(nil, columns, map[string]interface{}{"target_x": 101, "target_y": nil}, 4, "admin", nil)
		if err != nil || len(refs) != 0 {
			t.Fatalf("NULL tuple should not resolve or lock any target: %+v, %v", refs, err)
		}
	})
}

func TestAddRowCompositeForeignKeyCatalogMetadata(t *testing.T) {
	resetQueues()
	t.Cleanup(resetQueues)
	db := newTestDB(t)
	t.Cleanup(func() { _ = db.Close() })
	previousDB := backend.Db
	backend.Db = db
	t.Cleanup(func() { backend.Db = previousDB })
	pushQuery(queuedQuery{cols: []string{
		"column_name", "data_type", "is_nullable", "column_default", "is_identity",
		"generation_expression", "foreign_table_schema", "foreign_table_name", "foreign_column_name", "udt_name",
		"insert_new_target_with_source", "insert_new_source_with_target", "source_insert_specs", "target_insert_specs",
		"insertable", "is_multilingual", "multilingual_languages",
	}, rows: [][]driver.Value{
		{"target_x", "integer", "YES", nil, "NO", nil, "public", "targets", "", "int4", nil, nil, nil, nil, true, false, []byte("[]")},
		{"target_y", "text", "YES", nil, "NO", nil, "public", "targets", "", "text", nil, nil, nil, nil, true, false, []byte("[]")},
	}})
	pushQuery(queuedQuery{cols: []string{"table_name"}, rows: [][]driver.Value{{"sources"}}})
	pushQuery(queuedQuery{cols: []string{"oid", "schema", "table", "source", "target"},
		rows: [][]driver.Value{{int64(12), "public", "targets", "{target_x,target_y}", "{x,y}"}}})
	columns, err := getAddRowColumnsWithTypes("101", "public")
	if err != nil || len(columns) != 2 {
		t.Fatalf("composite metadata: %+v, %v", columns, err)
	}
	for i, column := range columns {
		wantTarget := []string{"x", "y"}[i]
		if !column.IsCompositeForeignKey || len(column.CompositeForeignKeys) != 1 || column.ForeignColumnName != wantTarget {
			t.Fatalf("component lost its tuple or form metadata: %+v", column)
		}
	}
	if len(queryQueue) != 0 {
		t.Fatalf("unconsumed catalog reads: %d", len(queryQueue))
	}
}
