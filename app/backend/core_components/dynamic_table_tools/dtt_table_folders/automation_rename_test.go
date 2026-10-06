// automation_rename_test.go
// Checks a failed automation metadata rename stops the tree rename workflow.
// Reuses the folder driver with the same optional-table guard as production.
// Registry and translation writes cannot continue after the automation failure.
package dtt_system_table_folders

import (
	"database/sql/driver"
	"errors"
	"strings"
	"testing"
)

func TestRenameTableStopsOnAutomationMetadataFailure(t *testing.T) {
	failure := errors.New("automation rename failed")
	db, state := openFolderMockDB(t, []folderQueryResponse{
		{match: "SELECT table_name FROM system_db_tables", cols: []string{"table_name"}, rows: [][]driver.Value{{"automation_before"}}},
		{match: "FROM system_db_table_aliases", cols: []string{"table_name", "alias_slug"}},
		{match: "SELECT table_uid, table_name", cols: []string{"table_uid", "table_name"}},
		{match: "SELECT id, table_name", cols: []string{"id", "table_name"}},
		{match: "SELECT to_regclass('public.system_triggers')", cols: []string{"present"}, rows: [][]driver.Value{{true}}},
	}, []folderExecResponse{
		{match: "ALTER TABLE", rowsAffected: 1},
		{match: "UPDATE public.system_triggers", err: failure},
	})
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	err = renameTable(tx, RenameTreeNodeRequest{ItemID: 5, NewName: "automation_after"})
	if !errors.Is(err, failure) || len(state.calls) != 2 {
		t.Fatal("rename continued after automation failure", err, state.calls)
	}
	if !strings.HasPrefix(state.calls[1].query, "UPDATE public.system_triggers") {
		t.Fatal("tree rename did not maintain automation metadata")
	}
	args := namedArgsToFolderValues(state.calls[1].args)
	if len(args) != 2 || args[0] != "automation_before" || args[1] != "automation_after" {
		t.Fatal("tree rename used incorrect endpoint names", args)
	}
}
