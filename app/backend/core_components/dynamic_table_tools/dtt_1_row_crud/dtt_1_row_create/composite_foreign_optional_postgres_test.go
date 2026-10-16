// composite_foreign_optional_postgres_test.go
// Proves optional composite inserts and MATCH FULL against disposable PostgreSQL.
// Uses production catalog reads, normalization, authorization, INSERT and rechecks.
// Verifies stored NULLs and default refusals without touching an installation DB.
package dtt_1_row_create

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/internal/referencetest"
	"easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/row_mutation_policy"
	"github.com/lib/pq"
)

func TestAddRowOptionalCompositePostgres(t *testing.T) {
	for _, match := range []string{"SIMPLE", "FULL"} {
		t.Run(match, func(t *testing.T) {
			owner, reader := referencetest.CompositeFixture(t)
			previousDB := backend.Db
			backend.Db = reader
			t.Cleanup(func() { backend.Db = previousDB })
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			// This fixture belongs only to the disposable cluster. Existing round-5
			// fixtures and tests are unchanged, including their hidden (101,'B').
			_, err := owner.ExecContext(ctx, fmt.Sprintf(`
				CREATE TABLE optional_composite_sources (
				 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, title text,
				 target_x integer, target_y text,
				 FOREIGN KEY(target_x,target_y) REFERENCES composite_targets(x,y) MATCH %s);
				UPDATE system_db_tables SET table_name='optional_composite_sources' WHERE table_uid=101;
				INSERT INTO composite_targets VALUES(3,101,'4',false);
				GRANT SELECT,INSERT ON optional_composite_sources TO reference_reader;
				GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO reference_reader;`, match))
			if err != nil {
				t.Fatal(err)
			}
			storedRows := 0
			for _, tc := range []struct {
				name, payload                string
				defaultY, serverComplete     bool
				defaultRefusal, hidden       bool
				partialNull, publishedTarget bool
				wantReference                int64
			}{
				{name: "gate_explicit_null_and_omission", payload: `{"title":"note","target_x":null}`},
				{name: "both_omitted", payload: `{"title":"note"}`},
				{name: "both_explicit_null", payload: `{"title":"note","target_x":null,"target_y":null}`},
				{name: "value_and_omission", payload: `{"title":"note","target_x":101}`, partialNull: true},
				{name: "omission_and_value", payload: `{"title":"note","target_y":"B"}`, partialNull: true},
				{name: "hidden_tuple", payload: `{"title":"note","target_x":101,"target_y":"B"}`, hidden: true},
				{name: "readable_tuple", payload: `{"title":"note","target_x":101,"target_y":"B"}`, publishedTarget: true, wantReference: 2},
				{name: "omitted_default", payload: `{"title":"note","target_x":101}`, defaultY: true, defaultRefusal: true},
				{name: "omitted_default_with_null", payload: `{"title":"note","target_x":null}`, defaultY: true, defaultRefusal: true},
				{name: "both_omitted_with_default", payload: `{"title":"note"}`, defaultY: true, defaultRefusal: true},
				{name: "explicit_null_over_default", payload: `{"title":"note","target_x":null,"target_y":null}`, defaultY: true},
				{name: "server_completed_hidden_tuple", payload: `{"title":"note","target_x":101}`, serverComplete: true, hidden: true},
				{name: "server_completed_readable_tuple", payload: `{"title":"note","target_x":101}`, serverComplete: true, publishedTarget: true, wantReference: 3},
			} {
				t.Run(tc.name, func(t *testing.T) {
					defaultDDL := `ALTER TABLE optional_composite_sources ALTER COLUMN target_y DROP DEFAULT`
					if tc.defaultY {
						defaultDDL = `ALTER TABLE optional_composite_sources ALTER COLUMN target_y SET DEFAULT 'B'::text`
					}
					if _, err := owner.ExecContext(ctx, defaultDDL); err != nil {
						t.Fatal(err)
					}
					if _, err := owner.ExecContext(ctx, `UPDATE composite_targets SET published=$1 WHERE id IN(2,3)`, tc.publishedTarget); err != nil {
						t.Fatal(err)
					}
					columns, err := getAddRowColumnsWithTypes("101", "public")
					if err != nil {
						t.Fatal(err)
					}
					row := make(map[string]interface{})
					if err := json.Unmarshal([]byte(tc.payload), &row); err != nil {
						t.Fatal(err)
					}
					marks := make(row_mutation_policy.RowActorColumns)
					if tc.serverComplete {
						marks["target_y"] = "owner"
					}
					if err := normalizeMainForeignKeyValues(columns, row, marks); err != nil {
						t.Fatal(err)
					}
					applyCurrentActorOwnership(row, columns, 4, "", marks)
					tx, err := reader.BeginTx(ctx, nil)
					if err != nil {
						t.Fatal(err)
					}
					defer tx.Rollback()
					refs, err := validateMainForeignKeyReads(tx, columns, row, 4, "basic", marks)
					if tc.defaultRefusal {
						if err == nil || !strings.Contains(err.Error(), "target_y") || !strings.Contains(err.Error(), "default") {
							t.Fatalf("omitted default: %v; want refusal naming target_y and default", err)
						}
						return
					}
					if tc.hidden {
						var refusal *forbiddenError
						if !errors.As(err, &refusal) {
							t.Fatalf("hidden tuple: %v; want forbidden", err)
						}
						return
					}
					if err != nil {
						t.Fatal(err)
					}
					if tc.wantReference == 0 && len(refs) != 0 || tc.wantReference != 0 && (len(refs) != 1 || refs[0].rowID != tc.wantReference) {
						t.Fatalf("reference checks: %v; want target %d", refs, tc.wantReference)
					}
					types := make(map[string]string)
					for _, column := range columns {
						types[column.ColumnName] = column.DataType
					}
					id, err := insertMainRow(ctx, tx, "optional_composite_sources", row, types)
					if match == "FULL" && tc.partialNull {
						var pgErr *pq.Error
						if !errors.As(err, &pgErr) || pgErr.Code != "23503" {
							t.Fatalf("MATCH FULL partial NULL: %v; want foreign_key_violation", err)
						}
						return
					}
					if err != nil {
						t.Fatal(err)
					}
					if err := recheckReferencesAfterInsert(tx, refs, nil, 4, "basic"); err != nil {
						t.Fatal(err)
					}
					if err := tx.Commit(); err != nil {
						t.Fatal(err)
					}
					storedRows++
					var x sql.NullInt64
					var y sql.NullString
					var title string
					if err := owner.QueryRowContext(ctx, `SELECT title,target_x,target_y FROM optional_composite_sources WHERE id=$1`, id).Scan(&title, &x, &y); err != nil {
						t.Fatal(err)
					}
					wantY := ""
					if row["target_y"] != nil {
						wantY = fmt.Sprint(row["target_y"])
					}
					if title != "note" || x.Valid != (row["target_x"] != nil) || x.Valid && x.Int64 != 101 || y.Valid != (row["target_y"] != nil) || y.String != wantY {
						t.Fatalf("persisted values: title=%q, x=%+v, y=%+v; input=%v", title, x, y, row)
					}
				})
			}
			var count int
			if err := owner.QueryRowContext(ctx, `SELECT count(*) FROM optional_composite_sources`).Scan(&count); err != nil || count != storedRows {
				t.Fatalf("persisted rows=%d, error=%v; want %d (refused writes leave no row)", count, err, storedRows)
			}
		})
	}
}
