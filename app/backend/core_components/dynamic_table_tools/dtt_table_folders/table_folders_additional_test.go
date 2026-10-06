// table_folders_additional_test.go
// Verifies existing handlers and their transactional permission boundary.
// Reuses existing package fixtures for offline regression checks.
// Keeps the request and permission contracts covered without a live site.
package dtt_system_table_folders

import (
	"database/sql/driver"
	"easelect/backend/core_components/runtime_grants/granttest"
	"github.com/lib/pq"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHandleUpdateTableFolderGuardsAndBoundUpdate(t *testing.T) {
	t.Run("rejects missing dataset uid", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/update-table-folder", strings.NewReader(`{"item_id":4,"item_type":"table","new_folder_id":10}`))
		rec := httptest.NewRecorder()
		HandleUpdateTableFolder(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", rec.Code)
		}
	})

	t.Run("success binds item id and dataset uid", func(t *testing.T) {
		db, state := openFolderMockDB(t, []folderQueryResponse{
			{
				match: "SELECT table_name, folder_id",
				args:  []driver.Value{4, 77},
				cols:  []string{"table_name", "folder_id"},
				rows:  [][]driver.Value{{"app_service_catalog", int64(18)}},
			},
			{
				match: "WITH RECURSIVE folder_ancestors AS",
				args:  []driver.Value{18},
				cols:  []string{"id", "folder_name"},
				rows:  [][]driver.Value{{int64(18), "serlog"}},
			},
			{
				match: "WITH RECURSIVE folder_ancestors AS",
				args:  []driver.Value{10},
				cols:  []string{"id", "folder_name"},
				rows:  [][]driver.Value{{int64(18), "serlog"}},
			},
		}, []folderExecResponse{
			{
				match:        "UPDATE system_db_tables",
				rowsAffected: 1,
			},
		})
		withFolderDB(t, db)

		req := httptest.NewRequest(http.MethodPost, "/api/update-table-folder", strings.NewReader(`{"item_id":4,"item_type":"table","new_folder_id":10,"dataset_uid":77,"confirm_tab_visibility_change":true}`))
		rec := httptest.NewRecorder()
		HandleUpdateTableFolder(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		state.mu.Lock()
		got := namedArgsToFolderValues(state.calls[0].args)
		state.mu.Unlock()
		if len(got) != 3 || got[0] != int64(10) || got[1] != int64(4) || got[2] != int64(77) {
			t.Fatalf("exec args = %#v, want [10 4 77]", got)
		}
	})

	t.Run("dataset uid mismatch returns not found", func(t *testing.T) {
		db, _ := openFolderMockDB(t, []folderQueryResponse{
			{
				match: "SELECT table_name, folder_id",
				args:  []driver.Value{4, 77},
				cols:  []string{"table_name", "folder_id"},
				rows:  [][]driver.Value{{"app_service_catalog", int64(18)}},
			},
			{
				match: "WITH RECURSIVE folder_ancestors AS",
				args:  []driver.Value{18},
				cols:  []string{"id", "folder_name"},
				rows:  [][]driver.Value{{int64(18), "serlog"}},
			},
			{
				match: "WITH RECURSIVE folder_ancestors AS",
				args:  []driver.Value{10},
				cols:  []string{"id", "folder_name"},
				rows:  [][]driver.Value{{int64(18), "serlog"}},
			},
		}, []folderExecResponse{
			{
				match:        "UPDATE system_db_tables",
				rowsAffected: 0,
			},
		})
		withFolderDB(t, db)

		req := httptest.NewRequest(http.MethodPost, "/api/update-table-folder", strings.NewReader(`{"item_id":4,"item_type":"table","new_folder_id":10,"dataset_uid":77,"confirm_tab_visibility_change":true}`))
		rec := httptest.NewRecorder()
		HandleUpdateTableFolder(rec, req)

		if rec.Code != http.StatusNotFound {
			t.Fatalf("status = %d, want 404", rec.Code)
		}
	})

	t.Run("cross-project move requires confirmation", func(t *testing.T) {
		db, _ := openFolderMockDB(t, []folderQueryResponse{
			{
				match: "SELECT table_name, folder_id",
				args:  []driver.Value{4, 77},
				cols:  []string{"table_name", "folder_id"},
				rows:  [][]driver.Value{{"app_service_catalog", int64(18)}},
			},
			{
				match: "WITH RECURSIVE folder_ancestors AS",
				args:  []driver.Value{18},
				cols:  []string{"id", "folder_name"},
				rows:  [][]driver.Value{{int64(18), "serlog"}},
			},
			{
				match: "WITH RECURSIVE folder_ancestors AS",
				args:  []driver.Value{21},
				cols:  []string{"id", "folder_name"},
				rows:  [][]driver.Value{{int64(21), "another_project"}},
			},
		}, nil)
		withFolderDB(t, db)

		req := httptest.NewRequest(http.MethodPost, "/api/update-table-folder", strings.NewReader(`{"item_id":4,"item_type":"table","new_folder_id":21,"dataset_uid":77}`))
		rec := httptest.NewRecorder()
		HandleUpdateTableFolder(rec, req)

		if rec.Code != http.StatusConflict {
			t.Fatalf("status = %d, want 409", rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "Confirm moving table") {
			t.Fatalf("body = %q, want confirmation error", rec.Body.String())
		}
	})

	t.Run("top-tab visibility change requires confirmation", func(t *testing.T) {
		db, _ := openFolderMockDB(t, []folderQueryResponse{
			{
				match: "SELECT table_name, folder_id",
				args:  []driver.Value{4, 77},
				cols:  []string{"table_name", "folder_id"},
				rows:  [][]driver.Value{{"app_service_catalog", int64(18)}},
			},
			{
				match: "WITH RECURSIVE folder_ancestors AS",
				args:  []driver.Value{18},
				cols:  []string{"id", "folder_name"},
				rows:  [][]driver.Value{{int64(18), "serlog"}},
			},
			{
				match: "WITH RECURSIVE folder_ancestors AS",
				args:  []driver.Value{19},
				cols:  []string{"id", "folder_name"},
				rows:  [][]driver.Value{{int64(18), "serlog"}},
			},
		}, nil)
		withFolderDB(t, db)

		req := httptest.NewRequest(http.MethodPost, "/api/update-table-folder", strings.NewReader(`{"item_id":4,"item_type":"table","new_folder_id":19,"dataset_uid":77}`))
		rec := httptest.NewRecorder()
		HandleUpdateTableFolder(rec, req)

		if rec.Code != http.StatusConflict {
			t.Fatalf("status = %d, want 409", rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "main SVG tabs") {
			t.Fatalf("body = %q, want tab-visibility warning", rec.Body.String())
		}
	})

	t.Run("confirmed cross-project move succeeds", func(t *testing.T) {
		db, _ := openFolderMockDB(t, []folderQueryResponse{
			{
				match: "SELECT table_name, folder_id",
				args:  []driver.Value{4, 77},
				cols:  []string{"table_name", "folder_id"},
				rows:  [][]driver.Value{{"app_service_catalog", int64(18)}},
			},
			{
				match: "WITH RECURSIVE folder_ancestors AS",
				args:  []driver.Value{18},
				cols:  []string{"id", "folder_name"},
				rows:  [][]driver.Value{{int64(18), "serlog"}},
			},
			{
				match: "WITH RECURSIVE folder_ancestors AS",
				args:  []driver.Value{21},
				cols:  []string{"id", "folder_name"},
				rows:  [][]driver.Value{{int64(21), "another_project"}},
			},
		}, []folderExecResponse{
			{
				match:        "UPDATE system_db_tables",
				rowsAffected: 1,
			},
		})
		withFolderDB(t, db)

		req := httptest.NewRequest(http.MethodPost, "/api/update-table-folder", strings.NewReader(`{"item_id":4,"item_type":"table","new_folder_id":21,"dataset_uid":77,"confirm_cross_project_move":true}`))
		rec := httptest.NewRecorder()
		HandleUpdateTableFolder(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
	})
}

func TestHandleUpdateFolderRequiresCrossProjectConfirmation(t *testing.T) {
	db, _ := openFolderMockDB(t, []folderQueryResponse{
		{
			match: "WITH RECURSIVE folder_ancestors AS",
			args:  []driver.Value{3},
			cols:  []string{"id", "folder_name"},
			rows:  [][]driver.Value{{int64(18), "serlog"}},
		},
		{
			match: "WITH RECURSIVE folder_ancestors AS",
			args:  []driver.Value{9},
			cols:  []string{"id", "folder_name"},
			rows:  [][]driver.Value{{int64(21), "another_project"}},
		},
	}, nil)
	withFolderDB(t, db)

	req := httptest.NewRequest(http.MethodPost, "/api/update-folder", strings.NewReader(`{"item_id":3,"item_type":"folder","new_folder_id":9}`))
	rec := httptest.NewRecorder()
	HandleUpdateFolder(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "Confirm moving folder") {
		t.Fatalf("body = %q, want confirmation error", rec.Body.String())
	}
}

func TestHandleSetCurrentProjectFolder(t *testing.T) {
	t.Run("rejects invalid JSON", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/set-current-project-folder", strings.NewReader("{"))
		rec := httptest.NewRecorder()
		HandleSetCurrentProjectFolder(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", rec.Code)
		}
	})

	t.Run("rejects non-project-root folders", func(t *testing.T) {
		db, _ := openFolderMockDB(t, []folderQueryResponse{
			{
				match: "WITH RECURSIVE folder_ancestors AS",
				args:  []driver.Value{19},
				cols:  []string{"id", "folder_name"},
				rows:  [][]driver.Value{{int64(18), "serlog"}},
			},
		}, nil)
		withFolderDB(t, db)

		req := httptest.NewRequest(http.MethodPost, "/api/set-current-project-folder", strings.NewReader(`{"folder_id":19}`))
		rec := httptest.NewRecorder()
		HandleSetCurrentProjectFolder(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "project root folder") {
			t.Fatalf("body = %q, want project-root validation error", rec.Body.String())
		}
	})

	t.Run("marks selected project root as current", func(t *testing.T) {
		db, state := openFolderMockDB(t, []folderQueryResponse{
			{
				match: "WITH RECURSIVE folder_ancestors AS",
				args:  []driver.Value{18},
				cols:  []string{"id", "folder_name"},
				rows:  [][]driver.Value{{int64(18), "serlog"}},
			},
		}, []folderExecResponse{
			{
				match:        "SET is_current_project = false",
				rowsAffected: 1,
			},
			{
				match:        "SET is_current_project = true",
				rowsAffected: 2,
			},
		})
		withFolderDB(t, db)

		req := httptest.NewRequest(http.MethodPost, "/api/set-current-project-folder", strings.NewReader(`{"folder_id":18}`))
		rec := httptest.NewRecorder()
		HandleSetCurrentProjectFolder(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}

		body := decodeFolderJSON(t, rec)
		if got := body["project_name"]; got != "serlog" {
			t.Fatalf("project_name = %v, want serlog", got)
		}
		if len(state.calls) != 2 {
			t.Fatalf("exec call count = %d, want 2", len(state.calls))
		}
	})
}

func TestHandleRenameTreeNodeRejectsInvalidInputs(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/rename-tree-node", strings.NewReader("{"))
	rec := httptest.NewRecorder()
	HandleRenameTreeNode(granttest.Recorder{ResponseRecorder: rec}, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid-json status = %d, want 400", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/rename-tree-node", strings.NewReader(`{"item_id":1,"item_type":"folder","new_name":"   "}`))
	rec = httptest.NewRecorder()
	HandleRenameTreeNode(granttest.Recorder{ResponseRecorder: rec}, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("empty-name status = %d, want 400", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/rename-tree-node", strings.NewReader(`{"item_id":0,"item_type":"folder","new_name":"Docs"}`))
	rec = httptest.NewRecorder()
	HandleRenameTreeNode(granttest.Recorder{ResponseRecorder: rec}, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid-id status = %d, want 400", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/rename-tree-node", strings.NewReader(`{"item_id":1,"item_type":"folder","new_name":"Docs"}`))
	rec = httptest.NewRecorder()
	HandleRenameTreeNode(granttest.Recorder{ResponseRecorder: rec}, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("missing-tx status = %d, want 500", rec.Code)
	}
}

func TestHandleRenameTreeNodeRejectsUnknownTypeWithTransaction(t *testing.T) {
	db, _ := openFolderMockDB(t, nil, nil)
	req := httptest.NewRequest(http.MethodPost, "/api/rename-tree-node", strings.NewReader(`{"item_id":1,"item_type":"weird","new_name":"Docs"}`))
	req = withFolderTx(req, db)
	rec := httptest.NewRecorder()

	HandleRenameTreeNode(granttest.Recorder{ResponseRecorder: rec}, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "item_type must be 'folder' or 'table'") {
		t.Fatalf("body = %q, want unknown item_type error", rec.Body.String())
	}
}

func TestHandleRenameTreeNodeRejectsDatasetRouteConflictBeforeAlterTable(t *testing.T) {
	db, state := openFolderMockDB(t, []folderQueryResponse{
		{
			match: "FROM system_db_table_aliases",
			err:   &pq.Error{Code: "42P01"},
		},
		{
			match: "SELECT table_uid, table_name",
			cols:  []string{"table_uid", "table_name"},
			rows:  [][]driver.Value{},
		},
		{
			match: "SELECT table_name FROM system_db_tables WHERE id = $1",
			args:  []driver.Value{int64(5)},
			cols:  []string{"table_name"},
			rows:  [][]driver.Value{{"app_demo"}},
		},
	}, nil)
	req := httptest.NewRequest(http.MethodPost, "/api/rename-tree-node", strings.NewReader(`{"item_id":5,"item_type":"table","new_name":"service_catalog"}`))
	req = withFolderTx(req, db)
	rec := httptest.NewRecorder()

	HandleRenameTreeNode(granttest.Recorder{ResponseRecorder: rec}, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `dataset route segment \"service_catalog\" is already in use`) {
		t.Fatalf("body = %q, want route-conflict message", rec.Body.String())
	}
	if len(state.calls) != 0 {
		t.Fatalf("exec call count = %d, want 0", len(state.calls))
	}
}
