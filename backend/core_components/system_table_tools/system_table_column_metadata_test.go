// system_table_column_metadata_test.go
// Verifies the grouped-table metadata query used by the system table metadata handler.
// Bridges the current-project folder semantics and the SQL builder without requiring a live database.
// Exists to lock in ancestor-aware current-project detection for tables placed in subfolders.

package system_table_tools

import (
	"strings"
	"testing"
)

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
	}

	for _, fragment := range requiredFragments {
		if !strings.Contains(query, fragment) {
			t.Fatalf("query missing fragment %q\n%s", fragment, query)
		}
	}
}
