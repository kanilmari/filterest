// lang_key_consistency_checks_test.go
// Unit tests for synthetic test lang-key cleanup classification and descriptions.
// Bridges the consistency-check lang-key helpers and deterministic test assertions.
// Exists to keep e2e/test cleanup rules stable without requiring a live database.
package system_table_tools

import (
	"database/sql/driver"
	"encoding/json"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
)

func TestIsSyntheticTestLangKey(t *testing.T) {
	testCases := []struct {
		name string
		key  string
		want bool
	}{
		{name: "e2e prefix", key: "e2e_folder_abc", want: true},
		{name: "test prefix", key: "test_perm_table_123", want: true},
		{name: "embedded after prefix", key: "add_row_e2e_folder_abc", want: false},
		{name: "search slogan", key: "search_slogan_test_perm_table_123", want: false},
		{name: "front page suffix", key: "test_perm_table_123_front_page", want: false},
		{name: "ordinary short key", key: "test_x", want: false},
		{name: "ordinary test word", key: "testimonial", want: false},
		{name: "ordinary test key", key: "test_connection", want: false},
		{name: "random tail", key: "test_abc123", want: true},
		{name: "numeric tail", key: "test_123", want: true},
		{name: "e2e random", key: "e2e_abc123", want: true},
		{name: "e2e tail with newline", key: "e2e_a\nb", want: true},
		{name: "test digit tail with newline", key: "test_ab\n1cdef2", want: false},
		{name: "long s is not ASCII s", key: "teſt_123", want: false},
		{name: "Kelvin sign is not ASCII k", key: "test_abK123", want: false},
		{name: "mixed ASCII case", key: "TeSt_AbC123", want: true},
		{name: "bare e2e", key: "e2e_", want: false},
		{name: "dash prefix", key: "test-123", want: false},
		{name: "short mixed tail", key: "test_x1", want: false},
		{name: "case insensitive", key: "TEST_ABC123", want: true},
		{name: "no whitespace normalization", key: " test_123 ", want: false},
		{name: "uuid", key: "test_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", want: true},
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

func TestLangKeyPatternsRecognizeLowerCamelConfigKeys(t *testing.T) {
	testCases := []struct {
		name    string
		content string
		want    string
	}{
		{
			name:    "lower camel config property",
			content: `{ key: "week", label: "Week", langKey: "calendar_week" }`,
			want:    "calendar_week",
		},
		{
			name:    "named lang key constant",
			content: `const NO_EVENTS_LANG_KEY = "calendar_no_events";`,
			want:    "calendar_no_events",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			found := false
			for _, pattern := range langKeyPatterns {
				matches := pattern.FindAllStringSubmatch(tc.content, -1)
				for _, match := range matches {
					if len(match) > 1 && match[1] == tc.want {
						found = true
					}
				}
			}
			if !found {
				t.Fatalf("source scanning should find %q", tc.want)
			}
		})
	}
}

func TestBuildLangKeyConsistencyDescription_SyntheticKey(t *testing.T) {
	row := langKeyRow{
		id:          91,
		key:         "e2e_folder_abc",
		en:          "Add row e2e folder abc",
		langKeyType: "ui",
	}

	description := buildLangKeyConsistencyDescription(row, map[int]int{91: 12})

	if orphanDescriptionLangKeys(row, nil)[0] != "consistency_synthetic_key_archiving_paused" {
		t.Fatalf("description %q should explain synthetic test cleanup", description)
	}
	if !strings.Contains(description, `en: "Add row e2e folder abc"`) {
		t.Fatalf("description %q missing English preview", description)
	}
	if !strings.Contains(description, "type: ui") {
		t.Fatalf("description %q missing lang key type", description)
	}
	if orphanDescriptionLangKeys(row, map[int]int{91: 12})[1] != "consistency_orphan_age_days+12" {
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

	if orphanDescriptionLangKeys(row, nil)[0] != "consistency_orphan_archiving_paused" {
		t.Fatalf("description %q should keep ordinary orphan wording", description)
	}
	if strings.Contains(description, "Synthetic test lang key") {
		t.Fatalf("description %q should not flag normal keys as synthetic", description)
	}
}

func TestOrphanReportIncludesBothTranslationStatesWithoutWriting(t *testing.T) {
	resetOrphanQueues()
	t.Cleanup(resetOrphanQueues)
	db := newSystemTableToolsTestDB(t)
	previous := backend.Db
	backend.Db = db
	t.Cleanup(func() { backend.Db = previous; _ = db.Close() })
	pushOrphanQuery(orphanQueuedQuery{
		cols: []string{"id", "key", "en", "type", "live", "translated"},
		rows: [][]driver.Value{
			{int64(1), "translated_key", "Copy", "ui", false, true},
			{int64(2), "untranslated_key", "", "ui", false, false},
		},
	})
	pushOrphanQuery(orphanQueuedQuery{cols: []string{"id", "age", "live"}})
	report := checkOrphanLangKeys()
	if len(report.Issues) != 2 || report.Issues[0].Translated == nil || report.Issues[1].Translated == nil ||
		!*report.Issues[0].Translated || *report.Issues[1].Translated {
		t.Fatalf("missing or mixed translation states: %+v", report)
	}
	encoded, err := json.Marshal(report)
	if err != nil || !strings.Contains(string(encoded), `"translated":false`) {
		t.Fatalf("untranslated state was omitted: %s, %v", encoded, err)
	}
	for _, query := range snapshotOrphanCalls() {
		if !strings.HasPrefix(strings.TrimSpace(query), "SELECT") {
			t.Fatalf("report attempted a write: %s", query)
		}
	}
}
