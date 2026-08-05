// lang_key_source_resolver_test.go
// Unit tests for schema ownership resolution of exact and dynamic lang keys.
// Bridges dynamic AI-generated key saves and the schema-backed source model.
// Exists so table-owned keys like add_row_<dataset> do not silently fall back to code::unknown.
package lang

import "testing"

func TestResolveSchemaSourceRefsForLangKeyHandlesDynamicTableAndColumnKeys(t *testing.T) {
	columnToTables := map[string][]string{
		"name": {"customers", "orders"},
	}
	tableNames := map[string]bool{
		"customers": true,
	}

	tableSources := resolveSchemaSourceRefsForLangKey("add_row_customers", columnToTables, tableNames)
	if len(tableSources) != 1 {
		t.Fatalf("tableSources len = %d, want 1", len(tableSources))
	}
	if tableSources[0].sourceType != "table" || tableSources[0].sourceHigh != "customers" || tableSources[0].sourceLow != "customers" {
		t.Fatalf("table source = %+v, want table/customers/customers", tableSources[0])
	}

	columnSources := resolveSchemaSourceRefsForLangKey("search_for_name", columnToTables, tableNames)
	if len(columnSources) != 2 {
		t.Fatalf("columnSources len = %d, want 2", len(columnSources))
	}
	if columnSources[0].sourceType != "column" || columnSources[0].sourceLow != "name" {
		t.Fatalf("first column source = %+v, want column/*/name", columnSources[0])
	}
	if columnSources[1].sourceType != "column" || columnSources[1].sourceLow != "name" {
		t.Fatalf("second column source = %+v, want column/*/name", columnSources[1])
	}
}

func TestDatasetOwnedDynamicLangKeyNames(t *testing.T) {
	got := datasetOwnedDynamicLangKeyNames("app_service_catalog")
	want := []string{
		"add_row_app_service_catalog",
		"search_for_app_service_catalog",
		"search_slogan_app_service_catalog",
		"app_service_catalog_front_page",
	}
	if len(got) != len(want) {
		t.Fatalf("len(got) = %d, want %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}
