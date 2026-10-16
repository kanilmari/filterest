// composite_foreign_reference_test.go
// Exercises complete-key discovery and source-value overlays without PostgreSQL.
// Reuses the existing recording driver while keeping earlier tests unchanged.
// Detects hidden tuples and partial-key SQL before a row can be updated.
package dtt_1_row_update

import (
	"database/sql"
	"database/sql/driver"
	"errors"
	"strings"
	"testing"

	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/runtime_grants/granttest"
)

func TestUpdateCompositeForeignReferenceUsesSourceTuple(t *testing.T) {
	for _, tc := range []struct {
		name, column    string
		value, x, y     interface{}
		exists, visible bool
		status          int
	}{
		{"hidden_tuple", "target_x", 101, nil, "B", true, false, 403},
		{"readable_tuple", "target_x", 101, nil, "B", true, true, 0},
		{"other_component", "target_y", "B", int64(101), "A", true, true, 0},
		{"missing_tuple", "target_x", 101, nil, "C", false, false, 400},
		{"incomplete_tuple", "target_x", 101, nil, nil, false, false, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			granttest.ConfigureRoles(t)
			queries := []queuedQuery{
				{cols: []string{"schema", "table", "column"}, rows: [][]driver.Value{{"public", "targets", ""}}},
				{cols: []string{"oid", "schema", "table", "source", "target"}, rows: [][]driver.Value{{int64(12), "public", "targets", "{target_x,target_y}", "{x,y}"}}},
				{cols: []string{"target_x", "target_y"}, rows: [][]driver.Value{{tc.x, tc.y}}},
			}
			if tc.y != nil {
				queries = append(queries, queuedQuery{cols: []string{"allowed"}, rows: [][]driver.Value{{int64(1)}}})
				resolve := queuedQuery{cols: []string{"id"}}
				if tc.exists {
					resolve.rows = [][]driver.Value{{int64(2)}}
				}
				queries = append(queries, resolve)
				if tc.exists {
					visible := queuedQuery{cols: []string{"id"}}
					if tc.visible {
						visible.rows = [][]driver.Value{{int64(2)}}
					}
					queries = append(queries, queuedQuery{cols: []string{"column_name"}}, visible)
				}
			}
			d := &referenceRecordingDriver{state: &updRowState{queries: queries}}
			db := sql.OpenDB(d)
			defer db.Close()
			tx, err := db.Begin()
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			refs, err := validateUpdatedForeignReferences(tx, "sources", tc.column, tc.value, 4, "admin", 41)
			if tc.status != 0 {
				var refusal *httpresponse.Refusal
				if !errors.As(err, &refusal) || refusal.Status != tc.status {
					t.Fatalf("target refusal: %v; want %d", err, tc.status)
				}
			} else if err != nil || (tc.y != nil && (len(refs) != 1 || refs[0].id != 2)) || (tc.y == nil && len(refs) != 0) {
				t.Fatalf("complete-key reference: %+v, %v", refs, err)
			}
			if len(d.state.queries) != 0 {
				t.Fatalf("unconsumed queries: %d", len(d.state.queries))
			}
			if tc.y != nil {
				want := `SELECT "id" FROM "targets" WHERE ("x","y") = ($1,$2) FOR KEY SHARE`
				if len(d.queries) < 5 || d.queries[4] != want {
					t.Fatalf("target lookup did not use the full tuple: %v", d.queries)
				}
				if tc.exists && !strings.Contains(d.queries[6], `AND ("targets"."x","targets"."y") = ($2,$3)`) {
					t.Fatalf("visibility did not repeat full key: %v", d.queries[6])
				}
			}
		})
	}
}
