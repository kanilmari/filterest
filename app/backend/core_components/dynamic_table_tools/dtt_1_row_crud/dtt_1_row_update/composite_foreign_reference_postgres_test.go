// composite_foreign_reference_postgres_test.go
// Reproduces the gate's incomplete-key update against real PostgreSQL.
// Exercises the source lock, complete-key resolution, UPDATE and postcheck.
// Proves the edited tuple never locks another row sharing one component.
package dtt_1_row_update

import (
	"context"
	"errors"
	"testing"
	"time"

	read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	"easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/internal/referencetest"
	"easelect/backend/core_components/httpresponse"
)

func TestUpdateRowCompositeForeignReferencePostgres(t *testing.T) {
	owner, reader := referencetest.CompositeFixture(t)
	for _, published := range []bool{false, true} {
		name := "hidden_tuple"
		if published {
			name = "readable_tuple"
		}
		t.Run(name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			if _, err := owner.ExecContext(ctx, `UPDATE composite_targets SET published=$1 WHERE id=2`, published); err != nil {
				t.Fatal(err)
			}
			tx, err := reader.BeginTx(ctx, nil)
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			visible, err := read.LockRowsVisibleForMutation(tx, "composite_sources", "basic", 4, []int64{41})
			if err != nil || !visible {
				t.Fatalf("source mutation lock: visible=%v, error=%v", visible, err)
			}
			value, err := convertValue(float64(101), "integer")
			if err != nil {
				t.Fatal(err)
			}
			refs, checkErr := validateUpdatedForeignReferences(tx, "composite_sources", "target_x", value, 4, "basic", 41)
			// Check locks even on a refused reference, before rolling it back.
			referencetest.AssertCompositeLocks(t, owner)
			if !published {
				var refusal *httpresponse.Refusal
				if !errors.As(checkErr, &refusal) || refusal.Status != 403 {
					t.Fatalf("hidden (101,'B'): %v; want 403", checkErr)
				}
				_ = tx.Rollback()
			} else {
				if checkErr != nil || len(refs) != 1 || refs[0].id != 2 {
					t.Fatalf("full tuple: refs=%v, error=%v; want row 2", refs, checkErr)
				}
				where, args, err := read.AppendUpdateRowPolicyToWhereClause(tx, "composite_sources", "basic", 4,
					` WHERE "composite_sources"."id"=$2`, []interface{}{value, int64(41)})
				if err != nil {
					t.Fatal(err)
				}
				result, err := tx.ExecContext(ctx, `UPDATE composite_sources SET target_x=$1`+where, args...)
				if err != nil {
					t.Fatal(err)
				}
				if count, err := result.RowsAffected(); err != nil || count != 1 {
					t.Fatalf("updated %d rows: %v", count, err)
				}
				if err := recheckUpdatedForeignReferences(tx, refs, 4, "basic"); err != nil {
					t.Fatal(err)
				}
				if err := tx.Commit(); err != nil {
					t.Fatal(err)
				}
			}
			var stored bool
			if err := owner.QueryRowContext(ctx, `SELECT target_x IS NOT NULL FROM composite_sources WHERE id=41`).Scan(&stored); err != nil || stored != published {
				t.Fatalf("persisted reference=%v, error=%v; want %v", stored, err, published)
			}
		})
	}
}
