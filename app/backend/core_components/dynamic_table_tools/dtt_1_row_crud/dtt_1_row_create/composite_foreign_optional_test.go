// composite_foreign_optional_test.go
// Covers optional composite references and unresolved insert-time values.
// Exercises the real normalizer, actor stamping and complete-tuple validator.
// Keeps omitted NULLs usable without guessing defaults or weakening target checks.
package dtt_1_row_create

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"reflect"
	"strings"
	"testing"

	"easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/row_mutation_policy"
	"easelect/backend/core_components/dynamic_table_tools/dtt_models"
)

func optionalCompositeColumns() []dtt_models.AddRowColumnInfo {
	key := dtt_models.ForeignKeyTuple{ConstraintID: 12, TargetSchema: "public", TargetTable: "targets",
		SourceColumns: []string{"target_x", "target_y"}, TargetColumns: []string{"x", "y"}}
	return []dtt_models.AddRowColumnInfo{
		{ColumnName: "target_x", DataType: "integer", IsNullable: "YES", IsIdentity: "NO", ForeignTableName: "targets", ForeignColumnName: "x", IsCompositeForeignKey: true, CompositeForeignKeys: []dtt_models.ForeignKeyTuple{key}},
		{ColumnName: "target_y", DataType: "text", IsNullable: "YES", IsIdentity: "NO", ForeignTableName: "targets", ForeignColumnName: "y", IsCompositeForeignKey: true, CompositeForeignKeys: []dtt_models.ForeignKeyTuple{key}},
	}
}

func TestAddRowOptionalCompositeOmissions(t *testing.T) {
	for _, tc := range []struct {
		name string
		row  map[string]interface{}
	}{
		{"gate_explicit_null_and_omission", map[string]interface{}{"title": "note", "target_x": nil}},
		{"both_omitted", map[string]interface{}{"title": "note"}},
		{"value_and_omission", map[string]interface{}{"title": "note", "target_x": 101}},
		{"omission_and_value", map[string]interface{}{"title": "note", "target_y": "B"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			columns := optionalCompositeColumns()
			before := make(map[string]interface{}, len(tc.row))
			for column, value := range tc.row {
				before[column] = value
			}
			if err := normalizeMainForeignKeyValues(columns, tc.row, nil); err != nil {
				t.Fatal(err)
			}
			// No transaction: any accidental target lookup would fail this test.
			refs, err := validateMainForeignKeyReads(nil, columns, tc.row, 4, "basic", nil)
			if err != nil || len(refs) != 0 {
				t.Fatalf("optional tuple: refs=%v, error=%v", refs, err)
			}
			if !reflect.DeepEqual(tc.row, before) {
				t.Fatalf("validation changed the insert values: %v; want %v", tc.row, before)
			}
			tx := relationKeyTx(t)
			pushQuery(queuedQuery{cols: []string{"id"}, rows: [][]driver.Value{{int64(42)}}})
			pushQuery(queuedQuery{cols: []string{"exists"}}) // No search-vector column.
			id, err := insertMainRow(context.Background(), tx, "sources", tc.row,
				map[string]string{"title": "text", "target_x": "integer", "target_y": "text"})
			if err != nil || id != 42 {
				t.Fatalf("optional tuple insert: id=%d, error=%v", id, err)
			}
			if len(queryQueue) != 0 {
				t.Fatalf("insert did not complete: %d queries remain", len(queryQueue))
			}
		})
	}
}

func TestAddRowOptionalCompositeUnresolvedValues(t *testing.T) {
	for _, tc := range []struct {
		name   string
		change func(*dtt_models.AddRowColumnInfo)
	}{
		{"default", func(c *dtt_models.AddRowColumnInfo) { c.ColumnDefault = "'B'::text" }},
		{"identity", func(c *dtt_models.AddRowColumnInfo) { c.IsIdentity = "YES" }},
		{"generated", func(c *dtt_models.AddRowColumnInfo) { c.GenerationExpression = "'B'::text" }},
		{"unknown_metadata", func(c *dtt_models.AddRowColumnInfo) { c.IsNullable = "" }},
	} {
		for _, nullSibling := range []bool{false, true} {
			t.Run(tc.name+"/null_sibling="+map[bool]string{false: "false", true: "true"}[nullSibling], func(t *testing.T) {
				columns := optionalCompositeColumns()
				tc.change(&columns[1])
				row := map[string]interface{}{"target_x": 101}
				if nullSibling {
					row["target_x"] = nil
				}
				_, err := validateMainForeignKeyReads(nil, columns, row, 4, "basic", nil)
				if err == nil || !strings.Contains(err.Error(), "target_y") {
					t.Fatalf("unresolved insert value: %v; want refusal naming target_y", err)
				}
			})
		}
	}
	// Explicit NULL overrides a default, so it is known and needs no target check.
	columns := optionalCompositeColumns()
	columns[1].ColumnDefault = "'B'::text"
	refs, err := validateMainForeignKeyReads(nil, columns, map[string]interface{}{"target_x": 101, "target_y": nil}, 4, "basic", nil)
	if err != nil || len(refs) != 0 {
		t.Fatalf("explicit NULL over default: refs=%v, error=%v", refs, err)
	}
}

func TestAddRowOptionalCompositeServerCompletedTuple(t *testing.T) {
	for _, visible := range []bool{false, true} {
		t.Run(map[bool]string{false: "hidden", true: "readable"}[visible], func(t *testing.T) {
			tx := relationKeyTx(t)
			columns := optionalCompositeColumns()
			columns[1].DataType = "integer"
			columns[1].Insertable = sql.NullBool{Bool: false, Valid: true}
			marks := row_mutation_policy.RowActorColumns{"target_y": "owner"}
			row := map[string]interface{}{"target_x": 101} // Caller supplies one component.
			if err := normalizeMainForeignKeyValues(columns, row, marks); err != nil {
				t.Fatal(err)
			}
			applyCurrentActorOwnership(row, columns, 4, "", marks)
			pushQuery(queuedQuery{cols: []string{"allowed"}, rows: [][]driver.Value{{int64(1)}}})
			pushQuery(queuedQuery{wantSQL: `SELECT "id" FROM "targets" WHERE ("x","y") = ($1,$2) FOR KEY SHARE`,
				wantArgs: []driver.Value{int64(101), int64(4)}, cols: []string{"id"}, rows: [][]driver.Value{{int64(2)}}})
			pushQuery(queuedQuery{cols: []string{"column_name"}})
			visibility := queuedQuery{wantSQL: `SELECT "targets"."id" FROM "targets" WHERE "targets"."id" = ANY($1) AND ("targets"."x","targets"."y") = ($2,$3) ORDER BY "targets"."id" FOR KEY SHARE`,
				wantArgs: []driver.Value{"{2}", int64(101), int64(4)}, cols: []string{"id"}}
			if visible {
				visibility.rows = [][]driver.Value{{int64(2)}}
			}
			pushQuery(visibility)
			refs, err := validateMainForeignKeyReads(tx, columns, row, 4, "admin", marks)
			if visible {
				if err != nil || len(refs) != 1 || refs[0].rowID != 2 {
					t.Fatalf("completed tuple: refs=%v, error=%v", refs, err)
				}
			} else {
				var refusal *forbiddenError
				if !errors.As(err, &refusal) {
					t.Fatalf("hidden completed tuple: %v; want forbidden", err)
				}
			}
			if len(queryQueue) != 0 {
				t.Fatalf("target checks skipped: %d queries remain", len(queryQueue))
			}
		})
	}
}
