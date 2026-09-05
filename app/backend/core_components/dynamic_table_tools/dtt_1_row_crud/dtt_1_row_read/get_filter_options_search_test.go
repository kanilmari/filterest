// get_filter_options_search_test.go
// Verifies full-dataset search predicates for relation and filter option reads.
// Bridges user search text with safely quoted value and display columns.
// Exists so LIMIT can never be applied before relation-picker search again.
package dtt_1_row_read

import (
	"strings"
	"testing"
)

func TestAppendFilterOptionSearchRunsBeforeLimitAgainstValueAndDisplayColumns(t *testing.T) {
	whereClause, args := appendFilterOptionSearchToWhereClause(
		"id",
		"title",
		"matrix",
		` WHERE "id" IS NOT NULL`,
		nil,
	)

	if len(args) != 1 || args[0] != "matrix" {
		t.Fatalf("args = %#v", args)
	}
	for _, fragment := range []string{
		`POSITION(LOWER($1) IN LOWER(CAST("id" AS text)))`,
		`POSITION(LOWER($1) IN LOWER(CAST("title" AS text)))`,
	} {
		if !strings.Contains(whereClause, fragment) {
			t.Fatalf("where clause missing %q: %s", fragment, whereClause)
		}
	}
	if strings.Contains(strings.ToUpper(whereClause), "LIMIT") {
		t.Fatalf("search helper must not introduce a pre-search limit: %s", whereClause)
	}
}

func TestAppendFilterOptionSearchLeavesEmptySearchUntouched(t *testing.T) {
	want := ` WHERE "id" IS NOT NULL`
	whereClause, args := appendFilterOptionSearchToWhereClause("id", "title", "", want, nil)
	if whereClause != want || len(args) != 0 {
		t.Fatalf("empty search changed query: %q %#v", whereClause, args)
	}
}
