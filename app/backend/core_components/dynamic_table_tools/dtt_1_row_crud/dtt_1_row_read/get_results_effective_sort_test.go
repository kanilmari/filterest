// get_results_effective_sort_test.go
// Checks the serialized Newest primary order against its SQL resolver.
// Connects get-results response metadata to all fallbacks and no-column tables.
// Prevents tie-break columns or another client policy from appearing as primary sorts.
package dtt_1_row_read

import (
	"encoding/json"
	"net/url"
	"strings"
	"testing"

	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
)

func TestEffectiveNewestSortResponse(t *testing.T) {
	for _, tc := range []struct {
		name    string
		columns []string
		want    string
	}{
		{"created", []string{"created", "created_at", "applied_at", "id"}, "created"},
		{"created_at", []string{"created_at", "applied_at", "id"}, "created_at"},
		{"applied_at", []string{"applied_at", "id"}, "applied_at"},
		{"id", []string{"id"}, "id"},
		{"none", []string{"name", "updated"}, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			columns := map[int]dtt_models.ColumnInfo{}
			for i, column := range tc.columns {
				columns[i] = dtt_models.ColumnInfo{ColumnName: column}
			}
			params := url.Values{"sort_column": {semanticNewestSortColumn}, "sort_order": {"DESC"}}
			effective := effectiveNewestSort(params, columns)
			encoded, err := json.Marshal(map[string]interface{}{"effective_sort": effective})
			if err != nil {
				t.Fatal(err)
			}
			clause, err := buildOrderByClause(params, "items", buildColumnsByName(columns), nil)
			if err != nil {
				t.Fatal(err)
			}
			if tc.want == "" {
				if string(encoded) != `{"effective_sort":null}` || clause != "" {
					t.Fatalf("no candidate: response=%s SQL=%s", encoded, clause)
				}
				return
			}
			wantJSON := `{"effective_sort":{"column":"` + tc.want + `","direction":"DESC"}}`
			if string(encoded) != wantJSON {
				t.Fatalf("response: %s, want %s", encoded, wantJSON)
			}
			if !strings.HasPrefix(clause, ` ORDER BY "items"."`+tc.want+`" DESC NULLS LAST`) {
				t.Fatalf("response primary column differs from SQL: %s %s", encoded, clause)
			}
			if tc.want != "id" && !strings.HasSuffix(clause, `, "items"."id" DESC`) {
				t.Fatalf("missing stable id tie-break: %s", clause)
			}
		})
	}
}

func TestEffectiveNewestSortDoesNotDescribeExplicitSorts(t *testing.T) {
	columns := map[int]dtt_models.ColumnInfo{1: {ColumnName: "created"}}
	for _, column := range []string{"created", "__images_first", ""} {
		if got := effectiveNewestSort(url.Values{"sort_column": {column}}, columns); got != nil {
			t.Fatalf("explicit mode %q acquired Newest metadata: %#v", column, got)
		}
	}
}

func TestEffectiveNewestSortDirectionMatchesSQL(t *testing.T) {
	columns := map[int]dtt_models.ColumnInfo{1: {ColumnName: "id"}}
	for _, direction := range []string{"ASC", "desc", "invalid", ""} {
		params := url.Values{"sort_column": {semanticNewestSortColumn}, "sort_order": {direction}}
		effective := effectiveNewestSort(params, columns)
		clause, err := buildOrderByClause(params, "items", buildColumnsByName(columns), nil)
		if err != nil || !strings.Contains(clause, `"id" `+effective.Direction+` NULLS LAST`) {
			t.Fatalf("direction diverged: %#v %s %v", effective, clause, err)
		}
	}
}
