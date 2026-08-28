// add_row_columns_visibility_test.go
// Verifies globally hidden presentation fields stay out of add-row form metadata.
// Bridges system_column_details visibility with both add-row metadata endpoints.
// Exists so hide_everywhere means hidden throughout ordinary content UI.
package dtt_1_row_create

import (
	"strings"
	"testing"
)

func TestAddRowColumnsQueryExcludesGloballyHiddenFields(t *testing.T) {
	if !strings.Contains(
		addRowColumnsWithTypesQuery,
		"COALESCE(scd.hide_everywhere, false) = false",
	) {
		t.Fatal("add-row metadata must exclude fields hidden everywhere")
	}
	if !strings.Contains(addRowColumnsWithTypesQuery, "ORDER BY\n        scd.co_number") {
		t.Fatal("add-row metadata must preserve the global field order")
	}
}

func TestAddRowColumnsQueryIncludesMultilingualStorageContract(t *testing.T) {
	for _, requiredFragment := range []string{
		"COALESCE(scd.is_multilingual, false) AS is_multilingual",
		"FROM system_languages sl",
		"sl.is_enabled = true",
		"sl.public_selector_ready = true",
		"sl.coverage_status = 'complete'",
		"sl.review_status = 'approved'",
	} {
		if !strings.Contains(addRowColumnsWithTypesQuery, requiredFragment) {
			t.Fatalf("add-row metadata query missing %q", requiredFragment)
		}
	}
}
