// system_table_column_metadata_test.go
// Verifies the grouped-table metadata query used by the system table metadata handler.
// Bridges the current-project folder semantics and the SQL builder without requiring a live database.
// Exists to lock in ancestor-aware current-project detection for tables placed in subfolders.

package system_table_tools

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"easelect/backend/core_components/dynamic_table_tools/dtt_models"
)

func TestGroupedTableJSONExposesPresentationMediaAsTypedBoolean(t *testing.T) {
	payload, err := json.Marshal(dtt_models.Table{HasPresentationMedia: true})
	if err != nil {
		t.Fatalf("marshal grouped table metadata: %v", err)
	}
	if !strings.Contains(string(payload), `"has_presentation_media":true`) {
		t.Fatalf("grouped table JSON missing typed media flag: %s", payload)
	}
}

func TestDeduplicateTabOrderEntriesKeepsFirstOccurrence(t *testing.T) {
	entries := []map[string]interface{}{
		{"tab_id": "travel_info", "sort_order": 1},
		{"tab_id": "travel_deals", "sort_order": 2},
		{"tab_id": "static:system_users", "sort_order": 3},
		{"tab_id": "static:system_users", "sort_order": 4},
	}

	got := deduplicateTabOrderEntries(entries)
	want := entries[:3]
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("deduplicated tab order = %#v, want %#v", got, want)
	}
}

func TestBuildGroupedTablesQueryUsesRecursiveCurrentProjectFolders(t *testing.T) {
	query := buildGroupedTablesQuery("NULL::varchar AS icon_key")

	requiredFragments := []string{
		"WITH RECURSIVE current_project_roots AS",
		"current_project_folders AS",
		"WHERE is_current_project = true",
		"FROM current_project_roots",
		"INNER JOIN current_project_folders cpf ON child.parent_id = cpf.id",
		"LEFT JOIN current_project_folders cpf ON t.folder_id = cpf.id",
		"COALESCE(cpf.id IS NOT NULL, false) AS is_in_current_project",
		"LEFT JOIN current_project_roots cpr ON t.folder_id = cpr.id",
		"COALESCE(cpr.id IS NOT NULL, false) AS is_top_level_in_current_project",
		"FROM public.system_dataset_media media",
		"media.table_uid = t.table_uid",
		"media.media_role IN ('cover', 'background')",
		") AS has_presentation_media",
	}

	for _, fragment := range requiredFragments {
		if !strings.Contains(query, fragment) {
			t.Fatalf("query missing fragment %q\n%s", fragment, query)
		}
	}
}
