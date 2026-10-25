// column_visibility_invalidation_test.go
// Proves visibility writers share the real lazy transaction's commit boundary.
// Connects metadata write detection to rollback, failed commit and scoped hooks.
// Unrelated saves keep their previous cache behavior.
package runtime_grant_mutations

import (
	"context"
	"database/sql"
	"reflect"
	"testing"

	"easelect/backend/core_components/dbutils"
)

func TestColumnVisibilityInvalidationRunsOnlyAfterCommit(t *testing.T) {
	for _, end := range []string{"commit", "rollback", "failed commit", "raw transaction"} {
		t.Run(end, func(t *testing.T) {
			columnVisibilityInvalidators.Lock()
			previous := columnVisibilityInvalidators.hooks
			columnVisibilityInvalidators.hooks = nil
			columnVisibilityInvalidators.Unlock()
			t.Cleanup(func() {
				columnVisibilityInvalidators.Lock()
				columnVisibilityInvalidators.hooks = previous
				columnVisibilityInvalidators.Unlock()
			})
			var cleared []string
			RegisterColumnVisibilityCacheInvalidator(func(dataset string) { cleared = append(cleared, dataset) })
			db := sql.OpenDB(&kindMutationDriver{commitFailure: end == "failed commit"})
			defer db.Close()
			lazy := dbutils.NewLazyTx(db)
			defer lazy.Rollback()
			ctx := dbutils.SetLazyTx(context.Background(), lazy)
			if _, err := dbutils.RequireTxWithError(ctx); err != nil {
				t.Fatal(err)
			}
			if end == "raw transaction" {
				ctx = context.Background()
			}
			err := ScheduleColumnVisibilityCacheInvalidation(ctx, "changed")
			if (err != nil) != (end == "raw transaction") {
				t.Fatalf("post-commit registration: %v", err)
			}
			if len(cleared) != 0 {
				t.Fatal("cache cleared before commit")
			}
			if end == "rollback" {
				if err := lazy.Rollback(); err != nil {
					t.Fatal(err)
				}
			} else if err := lazy.Commit(); (err != nil) != (end == "failed commit") {
				t.Fatalf("commit: %v", err)
			}
			if end == "commit" {
				if !reflect.DeepEqual(cleared, []string{"changed"}) {
					t.Fatal("wrong invalidation scope", cleared)
				}
			} else if len(cleared) != 0 {
				t.Fatal("cache cleared without a successful hooked commit", cleared)
			}
		})
	}
}

func TestGenericColumnVisibilityWriteDetection(t *testing.T) {
	for _, test := range []struct {
		table, column string
		want          bool
	}{
		{"system_column_details", "hide_everywhere", true},
		{"system_column_details", "client_delivery_mode", true},
		{"system_column_details", "card_element", false},
		{"system_column_details", "is_multilingual", false},
		{"app_content", "hide_everywhere", false},
	} {
		mutation := &Mutation{}
		mutation.IncludeValues(test.table, map[string]interface{}{test.column: false, "table_uid": 7})
		if mutation.columnVisibilityWritten != test.want {
			t.Fatalf("%s.%s: visibility detection=%v", test.table, test.column, mutation.columnVisibilityWritten)
		}
	}
}
