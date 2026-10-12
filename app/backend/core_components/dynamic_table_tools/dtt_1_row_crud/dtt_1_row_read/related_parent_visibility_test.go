// related_parent_visibility_test.go
// Verifies parent and reference reads retain the shared mandatory row decision.
// Bridges relation query helpers with owner flags and the unverified RLS pilot.
// Keeps focused authorization regressions separate from the broader child-query tests.
package dtt_1_row_read

import (
	"database/sql/driver"
	dtt_utils "easelect/backend/core_components/dynamic_table_tools/dtt_utils"
	"strings"
	"testing"
)

func TestIsRelatedParentRowVisibleHidesMissingAndPolicyFilteredRows(t *testing.T) {
	tests := []struct {
		name       string
		readPolicy ReadRowPolicy
		userID     int
		wantSQL    string
		wantArgs   []driver.Value
	}{
		{
			name:     "missing parent",
			userID:   42,
			wantSQL:  `public.resolve_effective_row_access($2, "parent_rows"."id", $3, 'read', (TRUE), FALSE)`,
			wantArgs: []driver.Value{int64(7), "parent_rows", int64(42)},
		},
		{
			name:       "parent hidden by row policy",
			readPolicy: legacyMustTrueReadPolicy([]string{"published"}, "user_id"),
			userID:     42,
			wantSQL:    `(("parent_rows"."published" = TRUE OR "parent_rows"."user_id" = $2)) AND (public.resolve_effective_row_access($3, "parent_rows"."id", $4, 'read', (TRUE), FALSE))`,
			wantArgs:   []driver.Value{int64(7), int64(42), "parent_rows", int64(42)},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			state := &relatedItemsQueryState{rowValue: false}
			db := openRelatedItemsQueryDB(t, state)

			visible, err := isRelatedParentRowVisible(db, "parent_rows", 7, "basic", test.userID, test.readPolicy)
			if err != nil {
				t.Fatalf("isRelatedParentRowVisible returned error: %v", err)
			}
			if visible {
				t.Fatal("hidden or missing parent must not be visible")
			}

			state.mu.Lock()
			lastQuery := state.lastQuery
			lastArgs := append([]driver.NamedValue(nil), state.lastArgs...)
			state.mu.Unlock()
			if !strings.Contains(lastQuery, test.wantSQL) {
				t.Fatalf("query = %q, want fragment %q", lastQuery, test.wantSQL)
			}
			if len(lastArgs) != len(test.wantArgs) {
				t.Fatalf("query args = %#v, want %#v", lastArgs, test.wantArgs)
			}
			for index, want := range test.wantArgs {
				if lastArgs[index].Value != want {
					t.Fatalf("query arg %d = %#v, want %#v", index, lastArgs[index].Value, want)
				}
			}
		})
	}
}

func TestIsRelatedParentRowVisibleAllowsVisibleParent(t *testing.T) {
	state := &relatedItemsQueryState{rowValue: true}
	db := openRelatedItemsQueryDB(t, state)

	visible, err := isRelatedParentRowVisible(db, "parent_rows", 7, "basic", 42, ReadRowPolicy{})
	if err != nil {
		t.Fatalf("isRelatedParentRowVisible returned error: %v", err)
	}
	if !visible {
		t.Fatal("visible parent must be accepted")
	}
}

func TestIsRelatedParentRowVisibleKeepsUnverifiedPilotFlags(t *testing.T) {
	state := &relatedItemsQueryState{rowValue: false}
	db := openRelatedItemsQueryDB(t, state)
	legacyPolicy := legacyMustTrueReadPolicy([]string{"published"}, "user_id")

	visible, err := isRelatedParentRowVisible(db, rlsPilotTableName, 7, "basic", 42, legacyPolicy)
	if err != nil {
		t.Fatalf("isRelatedParentRowVisible returned error: %v", err)
	}
	if visible {
		t.Fatal("pilot RLS-hidden parent must not be visible")
	}

	state.mu.Lock()
	lastQuery := state.lastQuery
	state.mu.Unlock()
	if !strings.Contains(lastQuery, `("app_service_catalog"."published" = TRUE OR "app_service_catalog"."user_id" = $2)`) {
		t.Fatalf("pilot parent query lost mandatory visibility fallback: %q", lastQuery)
	}
}

func TestReadParentForeignKeyValuesReappliesParentReadPolicy(t *testing.T) {
	state := &relatedItemsQueryState{rowValue: int64(99)}
	db := openRelatedItemsQueryDB(t, state)
	foreignKeys := map[string]dtt_utils.ForeignKey{
		"lookup_id": {ReferencedTable: "lookup_rows", ReferencedColumn: "id"},
	}

	values, err := readParentForeignKeyValues(
		db,
		"parent_rows",
		7,
		foreignKeys,
		"basic",
		42,
		legacyMustTrueReadPolicy([]string{"published"}, "user_id"),
	)
	if err != nil {
		t.Fatalf("readParentForeignKeyValues returned error: %v", err)
	}
	if values["lookup_id"] != int64(99) {
		t.Fatalf("parent FK value = %#v, want 99", values["lookup_id"])
	}

	state.mu.Lock()
	lastQuery := state.lastQuery
	lastArgs := append([]driver.NamedValue(nil), state.lastArgs...)
	state.mu.Unlock()
	if !strings.Contains(lastQuery, `WHERE "parent_rows"."id" = $1 AND (("parent_rows"."published" = TRUE OR "parent_rows"."user_id" = $2)) AND (public.resolve_effective_row_access($3, "parent_rows"."id", $4, 'read', (TRUE), FALSE))`) {
		t.Fatalf("parent FK query did not reapply row policy: %s", lastQuery)
	}
	if len(lastArgs) != 4 || lastArgs[0].Value != int64(7) || lastArgs[1].Value != int64(42) || lastArgs[2].Value != "parent_rows" || lastArgs[3].Value != int64(42) {
		t.Fatalf("parent FK query args = %#v, want parent, owner, dataset, and actor", lastArgs)
	}
}
