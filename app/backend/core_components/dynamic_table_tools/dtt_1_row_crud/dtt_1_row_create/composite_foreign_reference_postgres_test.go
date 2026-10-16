// composite_foreign_reference_postgres_test.go
// Reproduces a new row's hidden composite reference against real PostgreSQL.
// Uses the production metadata reader, converted values, validator and postcheck.
// Proves both tuple identity and absence of partial-key target locks.
package dtt_1_row_create

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/internal/referencetest"
)

func TestAddRowCompositeForeignReferencePostgres(t *testing.T) {
	owner, reader := referencetest.CompositeFixture(t)
	previousDB := backend.Db
	backend.Db = reader
	t.Cleanup(func() { backend.Db = previousDB })
	columns, err := getAddRowColumnsWithTypes("101", "public")
	if err != nil {
		t.Fatal(err)
	}
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
			row := map[string]interface{}{"target_x": 101, "target_y": "B"}
			if err := normalizeMainForeignKeyValues(columns, row, nil); err != nil {
				t.Fatal(err)
			}
			refs, checkErr := validateMainForeignKeyReads(tx, columns, row, 4, "basic", nil)
			referencetest.AssertCompositeLocks(t, owner)
			if !published {
				var refusal *forbiddenError
				if !errors.As(checkErr, &refusal) || !strings.Contains(refusal.msg, "foreign row cannot be read") {
					t.Fatalf("hidden (101,'B'): %v; want forbidden", checkErr)
				}
				_ = tx.Rollback()
			} else {
				if checkErr != nil || len(refs) != 1 || refs[0].rowID != 2 {
					t.Fatalf("full tuple: refs=%v, error=%v; want row 2", refs, checkErr)
				}
				if _, err := tx.ExecContext(ctx, `INSERT INTO composite_sources(id,target_x,target_y) VALUES(42,$1,$2)`, row["target_x"], row["target_y"]); err != nil {
					t.Fatal(err)
				}
				if err := recheckReferencesAfterInsert(tx, refs, nil, 4, "basic"); err != nil {
					t.Fatal(err)
				}
				if err := tx.Commit(); err != nil {
					t.Fatal(err)
				}
			}
			var stored bool
			if err := owner.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM composite_sources WHERE id=42 AND target_x=101 AND target_y='B')`).Scan(&stored); err != nil || stored != published {
				t.Fatalf("persisted reference=%v, error=%v; want %v", stored, err, published)
			}
		})
	}
}
