// lang_key_consistency_checks_test.go
// Unit tests for synthetic test lang-key cleanup classification and descriptions.
// Bridges the consistency-check lang-key helpers and deterministic test assertions.
// Exists to keep e2e/test cleanup rules stable without requiring a live database.
package system_table_tools

import (
	"strings"
	"testing"
)

func TestIsSyntheticTestLangKey(t *testing.T) {
	testCases := []struct {
		name string
		key  string
		want bool
	}{
		{name: "e2e prefix", key: "e2e_folder_abc", want: true},
		{name: "test prefix", key: "test_perm_table_123", want: true},
		{name: "embedded after prefix", key: "add_row_e2e_folder_abc", want: true},
		{name: "search slogan", key: "search_slogan_test_perm_table_123", want: true},
		{name: "front page suffix", key: "test_perm_table_123_front_page", want: true},
		{name: "normal lang key", key: "orders_front_page", want: false},
		{name: "word containing test", key: "latest_status", want: false},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isSyntheticTestLangKey(tc.key); got != tc.want {
				t.Fatalf("isSyntheticTestLangKey(%q) = %v, want %v", tc.key, got, tc.want)
			}
		})
	}
}

func TestBuildLangKeyConsistencyDescription_SyntheticKey(t *testing.T) {
	row := langKeyRow{
		id:          91,
		key:         "add_row_e2e_folder_abc",
		en:          "Add row e2e folder abc",
		langKeyType: "ui",
	}

	description := buildLangKeyConsistencyDescription(row, map[int]int{91: 12})

	if !strings.Contains(description, "Synthetic test lang key") {
		t.Fatalf("description %q should explain synthetic test cleanup", description)
	}
	if !strings.Contains(description, `en: "Add row e2e folder abc"`) {
		t.Fatalf("description %q missing English preview", description)
	}
	if !strings.Contains(description, "type: ui") {
		t.Fatalf("description %q missing lang key type", description)
	}
	if !strings.Contains(description, "orphan for 12 days") {
		t.Fatalf("description %q missing orphan age", description)
	}
}

func TestBuildLangKeyConsistencyDescription_OrdinaryOrphan(t *testing.T) {
	row := langKeyRow{
		id:          33,
		key:         "orders_front_page",
		en:          "Orders",
		langKeyType: "ui",
	}

	description := buildLangKeyConsistencyDescription(row, map[int]int{})

	if !strings.Contains(description, "Orphan lang key: not found in code/schema") {
		t.Fatalf("description %q should keep ordinary orphan wording", description)
	}
	if strings.Contains(description, "Synthetic test lang key") {
		t.Fatalf("description %q should not flag normal keys as synthetic", description)
	}
}
