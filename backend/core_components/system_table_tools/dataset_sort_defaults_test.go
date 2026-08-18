// dataset_sort_defaults_test.go
// Verifies the accepted persistent sorting values and safe virtual sort keys.
// Covers the validation boundary between browser selections and database settings.
// Exists to prevent arbitrary sort expressions from entering stored defaults.
package system_table_tools

import "testing"

func TestParseDatasetSortValue(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name          string
		raw           string
		wantColumn    string
		wantDirection string
		wantError     bool
	}{
		{name: "search relevance", raw: "", wantColumn: searchRelevanceSortColumn, wantDirection: "ASC"},
		{name: "newest", raw: "created:DESC", wantColumn: "created", wantDirection: "DESC"},
		{name: "normalizes direction", raw: "updated:asc", wantColumn: "updated", wantDirection: "ASC"},
		{name: "virtual image sort", raw: "__images_first:DESC", wantColumn: imagesFirstSortColumn, wantDirection: "DESC"},
		{name: "missing direction", raw: "created", wantError: true},
		{name: "invalid direction", raw: "created:sideways", wantError: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			column, direction, err := parseDatasetSortValue(test.raw)
			if test.wantError {
				if err == nil {
					t.Fatal("expected validation error")
				}
				return
			}
			if err != nil {
				t.Fatalf("parseDatasetSortValue returned error: %v", err)
			}
			if column != test.wantColumn || direction != test.wantDirection {
				t.Fatalf("got %q/%q, want %q/%q", column, direction, test.wantColumn, test.wantDirection)
			}
		})
	}
}
