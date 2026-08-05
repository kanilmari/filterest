package system_table_tools

import (
	"reflect"
	"strings"
	"testing"
)

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

func TestNormalizeFilterbarSectionCollapsedKeepsOnlyKnownCollapsedSections(t *testing.T) {
	got := normalizeFilterbarSectionCollapsed(map[string]bool{
		"filters": true,
		"tools":   false,
		"unknown": true,
		"chat":    true,
	})
	want := map[string]bool{
		"filters": true,
		"chat":    true,
	}

	if !reflect.DeepEqual(got, want) {
		t.Fatalf("normalizeFilterbarSectionCollapsed() = %#v, want %#v", got, want)
	}
}

func TestNormalizeFilterbarSectionCollapsedFallsBackToOpenSections(t *testing.T) {
	got := normalizeFilterbarSectionCollapsed(nil)
	if len(got) != 0 {
		t.Fatalf("normalizeFilterbarSectionCollapsed(nil) = %#v, want empty map", got)
	}
}
