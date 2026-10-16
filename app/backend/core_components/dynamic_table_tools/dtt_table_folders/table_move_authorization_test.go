// table_move_authorization_test.go
// Proves the folder mover authorizes the dataset UID it actually changes.
// Connects request identity to scripted grants and recorded metadata writes.
// Prevents a query grant on A from being reused to move B.
package dtt_system_table_folders

import (
	"database/sql/driver"
	"easelect/backend/core_components/dbutils"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTableMoveRechecksBodyUIDBeforeAnyChange(t *testing.T) {
	db, state := openFolderMockDB(t, []folderQueryResponse{
		{match: "FROM system_group_table_func_rights", args: []driver.Value{"/api/update-table-folder", 42, "77"}, cols: []string{"allowed"}, rows: [][]driver.Value{{int64(1)}}},
		{match: "FROM system_group_table_func_rights", args: []driver.Value{"/api/update-table-folder", 42, "88"}, cols: []string{"allowed"}},
		{match: "SELECT table_name, folder_id", args: []driver.Value{4, 88}, cols: []string{"table_name", "folder_id"}, rows: [][]driver.Value{{"private_rows", nil}}},
		{match: "WITH RECURSIVE folder_ancestors AS", cols: []string{"id", "folder_name"}},
	}, []folderExecResponse{{match: "UPDATE system_db_tables", rowsAffected: 1}})
	withFolderDB(t, db)
	req := httptest.NewRequest(http.MethodPost, "/api/update-table-folder?dataset_uid=77", strings.NewReader(`{"item_id":4,"item_type":"table","dataset_uid":88,"new_folder_id":10}`))
	req = req.WithContext(dbutils.SetRequestActorContext(req.Context(), dbutils.NewRequestActorContext(42, "basic")))
	rec := httptest.NewRecorder()
	HandleUpdateTableFolder(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status=%d want=403: %s", rec.Code, rec.Body.String())
	}
	if len(state.calls) != 0 {
		t.Fatal("denied move wrote metadata")
	}
}
