// filterbar_section_layout_test.go
// Verifies that the shared filterbar layout preserves explicit open and closed states.
// Connects session identities to the shared writer before validation or persistence.
// Exists so page reloads can restore disclosures without changing legacy defaults.
package system_table_tools

import (
	"encoding/json"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"easelect/backend/core_components/dbutils/queryfixture"
)

func TestSharedFilterbarLayoutRefusesGuestBeforeParsingOrTransaction(t *testing.T) {
	for _, body := range []string{
		`{"section_order":["style"]}`,
		`{"section_collapsed":{"filters":true}}`,
		`{"section_collapsed":{"filters":null}}`,
		`{"allow_own_order":true}`,
		`{"allow_own_order":false}`,
		`{"section_order":["style"],"section_collapsed":{"tools":false},"allow_own_order":true}`,
		`{}`, `invalid JSON`,
	} {
		for _, id := range []int{0, 1} {
			request := queryfixture.Request(t, "POST", "/api/filterbar-section-layout/save", body, id, "user")
			response := httptest.NewRecorder()
			// No transaction is supplied: every path must stop before requesting one.
			SaveFilterbarSectionLayoutHandler(response, request)
			var refusal map[string]interface{}
			if response.Code != 403 || response.Header().Get("Content-Type") != "application/json; charset=utf-8" ||
				json.Unmarshal(response.Body.Bytes(), &refusal) != nil || refusal["error"] == nil || refusal["code"] != float64(403) {
				t.Fatalf("actor=%d body=%s: %d %s", id, body, response.Code, response.Body)
			}
		}
	}
}

func TestFilterbarSectionLayoutUpsertDoesNotRequireValueTypeCatalog(t *testing.T) {
	if strings.Contains(filterbarSectionLayoutUpsertSQL, "system_config_value_data_types") {
		t.Fatal("filterbar layout upsert must work without the optional value-type catalog")
	}
	if strings.Contains(filterbarSectionLayoutUpsertSQL, "value_type") {
		t.Fatal("filterbar layout upsert must preserve existing optional value_type metadata")
	}
}

func TestNormalizeFilterbarSectionOrderKeepsKnownUniqueKeys(t *testing.T) {
	got := normalizeFilterbarSectionOrder([]string{
		"filters",
		"unknown",
		"tools",
		"filters",
		"chat",
	})
	want := []string{
		"filters",
		"tools",
		"chat",
		"search_overview",
		"search_controls",
		"views",
		"field_sets",
		"style",
	}

	if !reflect.DeepEqual(got, want) {
		t.Fatalf("normalizeFilterbarSectionOrder() = %#v, want %#v", got, want)
	}
}

func TestNormalizeFilterbarSectionOrderFallsBackToDefault(t *testing.T) {
	got := normalizeFilterbarSectionOrder(nil)
	if !reflect.DeepEqual(got, defaultFilterbarSectionOrder) {
		t.Fatalf("normalizeFilterbarSectionOrder(nil) = %#v, want %#v", got, defaultFilterbarSectionOrder)
	}
}

func TestNormalizeFilterbarSectionOrderUpgradesLegacyDefault(t *testing.T) {
	got := normalizeFilterbarSectionOrder([]string{
		"search_controls",
		"tools",
		"views",
		"field_sets",
		"filters",
		"chat",
	})
	if !reflect.DeepEqual(got, defaultFilterbarSectionOrder) {
		t.Fatalf("normalizeFilterbarSectionOrder(legacy) = %#v, want %#v", got, defaultFilterbarSectionOrder)
	}
}

func TestNormalizeFilterbarSectionCollapsedPreservesExplicitBooleans(t *testing.T) {
	input := map[string]bool{
		"filters": true,
		"tools":   false,
		"unknown": true,
	}
	want := map[string]bool{
		"filters": true,
		"tools":   false,
	}

	if got := normalizeFilterbarSectionCollapsed(input); !reflect.DeepEqual(got, want) {
		t.Fatalf("normalizeFilterbarSectionCollapsed() = %#v, want %#v", got, want)
	}
}

func TestNormalizeFilterbarSectionCollapsedKeepsMissingLegacyEntriesMissing(t *testing.T) {
	if got := normalizeFilterbarSectionCollapsed(nil); len(got) != 0 {
		t.Fatalf("normalizeFilterbarSectionCollapsed(nil) = %#v, want empty map", got)
	}
}

func TestFilterbarStyleSectionPersistsOrderAndCollapsedState(t *testing.T) {
	if got := normalizeFilterbarSectionOrder([]string{"style"}); len(got) == 0 || got[0] != "style" {
		t.Fatalf("style section lost its explicit position: %v", got)
	}
	if got := normalizeFilterbarSectionCollapsed(map[string]bool{"style": true}); !got["style"] {
		t.Fatal("style section lost its collapsed state")
	}
}
