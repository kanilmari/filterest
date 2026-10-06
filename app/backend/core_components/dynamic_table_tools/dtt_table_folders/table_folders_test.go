// table_folders_test.go
// Verifies existing handlers and their transactional permission boundary.
// Reuses existing package fixtures for offline regression checks.
// Keeps the request and permission contracts covered without a live site.
package dtt_system_table_folders

import (
	"database/sql"
	"database/sql/driver"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHandleCreateFolderRejectsInvalidJSONAndEmptyName(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/create-folder", strings.NewReader("{"))
	rec := httptest.NewRecorder()
	HandleCreateFolder(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid-json status = %d, want 400", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/create-folder", strings.NewReader(`{"folder_name":"   "}`))
	rec = httptest.NewRecorder()
	HandleCreateFolder(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("empty-name status = %d, want 400", rec.Code)
	}
}

func TestHandleCreateFolderHandlesParentMissingAndSuccess(t *testing.T) {
	t.Run("parent missing", func(t *testing.T) {
		db, _ := openFolderMockDB(t, []folderQueryResponse{
			{
				match: "SELECT EXISTS(SELECT 1 FROM system_table_folders",
				cols:  []string{"exists"},
				rows:  [][]driver.Value{{false}},
			},
		}, nil)
		withFolderDB(t, db)

		req := httptest.NewRequest(http.MethodPost, "/api/create-folder", strings.NewReader(`{"folder_name":"Docs","parent_id":7}`))
		rec := httptest.NewRecorder()
		HandleCreateFolder(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "parent folder 7 not found") {
			t.Fatalf("body = %q, want parent-missing error", rec.Body.String())
		}
	})

	t.Run("root success", func(t *testing.T) {
		db, _ := openFolderMockDB(t, []folderQueryResponse{
			{
				match: "INSERT INTO system_table_folders",
				cols:  []string{"id"},
				rows:  [][]driver.Value{{int64(41)}},
			},
		}, nil)
		withFolderDB(t, db)

		req := httptest.NewRequest(http.MethodPost, "/api/create-folder", strings.NewReader(`{"folder_name":"Docs"}`))
		rec := httptest.NewRecorder()
		HandleCreateFolder(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		body := decodeFolderJSON(t, rec)
		if body["folder_id"] != float64(41) {
			t.Fatalf("folder_id = %#v, want 41", body["folder_id"])
		}
	})
}

func TestEnsureRootFolderByNameReturnsExistingFolderOrCreatesIt(t *testing.T) {
	t.Run("returns existing root folder", func(t *testing.T) {
		db, _ := openFolderMockDB(t, []folderQueryResponse{
			{
				match: "SELECT id",
				args:  []driver.Value{"other_tables"},
				cols:  []string{"id"},
				rows:  [][]driver.Value{{int64(15)}},
			},
		}, nil)

		folderID, err := EnsureRootFolderByName(db, "other_tables")
		if err != nil {
			t.Fatalf("EnsureRootFolderByName returned error: %v", err)
		}
		if folderID != 15 {
			t.Fatalf("folderID = %d, want 15", folderID)
		}
	})

	t.Run("creates missing root folder", func(t *testing.T) {
		db, _ := openFolderMockDB(t, []folderQueryResponse{
			{
				match: "SELECT id",
				args:  []driver.Value{"other_tables"},
				err:   sql.ErrNoRows,
			},
			{
				match: "INSERT INTO system_table_folders",
				args:  []driver.Value{"other_tables"},
				cols:  []string{"id"},
				rows:  [][]driver.Value{{int64(29)}},
			},
		}, nil)

		folderID, err := EnsureRootFolderByName(db, "other_tables")
		if err != nil {
			t.Fatalf("EnsureRootFolderByName returned error: %v", err)
		}
		if folderID != 29 {
			t.Fatalf("folderID = %d, want 29", folderID)
		}
	})
}

func TestEnsureDatabaseOtherTablesFolderReturnsExistingChildOrCreatesIt(t *testing.T) {
	t.Run("returns existing database child folder", func(t *testing.T) {
		db, _ := openFolderMockDB(t, []folderQueryResponse{
			{
				match: "SELECT id",
				args:  []driver.Value{DatabaseFolderName},
				cols:  []string{"id"},
				rows:  [][]driver.Value{{int64(15)}},
			},
			{
				match: "SELECT id",
				args:  []driver.Value{int64(15), OtherTablesFolderName},
				cols:  []string{"id"},
				rows:  [][]driver.Value{{int64(150)}},
			},
		}, nil)

		folderID, err := EnsureDatabaseOtherTablesFolder(db)
		if err != nil {
			t.Fatalf("EnsureDatabaseOtherTablesFolder returned error: %v", err)
		}
		if folderID != 150 {
			t.Fatalf("folderID = %d, want 150", folderID)
		}
	})

	t.Run("creates missing database child folder", func(t *testing.T) {
		db, _ := openFolderMockDB(t, []folderQueryResponse{
			{
				match: "SELECT id",
				args:  []driver.Value{DatabaseFolderName},
				cols:  []string{"id"},
				rows:  [][]driver.Value{{int64(15)}},
			},
			{
				match: "SELECT id",
				args:  []driver.Value{int64(15), OtherTablesFolderName},
				err:   sql.ErrNoRows,
			},
			{
				match: "SELECT EXISTS(SELECT 1 FROM system_table_folders",
				args:  []driver.Value{int64(15)},
				cols:  []string{"exists"},
				rows:  [][]driver.Value{{true}},
			},
			{
				match: "INSERT INTO system_table_folders",
				args:  []driver.Value{OtherTablesFolderName, int64(15)},
				cols:  []string{"id"},
				rows:  [][]driver.Value{{int64(151)}},
			},
		}, nil)

		folderID, err := EnsureDatabaseOtherTablesFolder(db)
		if err != nil {
			t.Fatalf("EnsureDatabaseOtherTablesFolder returned error: %v", err)
		}
		if folderID != 151 {
			t.Fatalf("folderID = %d, want 151", folderID)
		}
	})
}

func TestReconcileLegacyOtherTablesFolder(t *testing.T) {
	t.Run("noops when no legacy root exists", func(t *testing.T) {
		db, state := openFolderMockDB(t, []folderQueryResponse{
			{
				match: "WHERE parent_id IS NULL",
				args:  []driver.Value{OtherTablesFolderName},
				cols:  []string{"id"},
				rows:  nil,
			},
		}, nil)

		result, err := ReconcileLegacyOtherTablesFolder(db)
		if err != nil {
			t.Fatalf("ReconcileLegacyOtherTablesFolder returned error: %v", err)
		}
		if result.CanonicalFolderID != 0 {
			t.Fatalf("CanonicalFolderID = %d, want 0", result.CanonicalFolderID)
		}
		if len(result.LegacyRootFolderIDs) != 0 {
			t.Fatalf("LegacyRootFolderIDs = %#v, want empty", result.LegacyRootFolderIDs)
		}

		state.mu.Lock()
		defer state.mu.Unlock()
		if len(state.calls) != 0 {
			t.Fatalf("exec call count = %d, want 0", len(state.calls))
		}
	})

	t.Run("moves tables to canonical folder and deletes the legacy root", func(t *testing.T) {
		db, state := openFolderMockDB(t, []folderQueryResponse{
			{
				match: "WHERE parent_id IS NULL",
				args:  []driver.Value{OtherTablesFolderName},
				cols:  []string{"id"},
				rows:  [][]driver.Value{{int64(151)}},
			},
			{
				match: "WHERE parent_id IS NULL",
				args:  []driver.Value{DatabaseFolderName},
				cols:  []string{"id"},
				rows:  [][]driver.Value{{int64(15)}},
			},
			{
				match: "WHERE parent_id = $1",
				args:  []driver.Value{int64(15), OtherTablesFolderName},
				cols:  []string{"id"},
				rows:  [][]driver.Value{{int64(150)}},
			},
		}, []folderExecResponse{
			{
				match:        "UPDATE system_table_folders",
				rowsAffected: 0,
			},
			{
				match:        "UPDATE system_db_tables",
				rowsAffected: 2,
			},
			{
				match:        "DELETE FROM system_table_folders WHERE id = $1",
				rowsAffected: 1,
			},
		})

		result, err := ReconcileLegacyOtherTablesFolder(db)
		if err != nil {
			t.Fatalf("ReconcileLegacyOtherTablesFolder returned error: %v", err)
		}
		if result.CanonicalFolderID != 150 {
			t.Fatalf("CanonicalFolderID = %d, want 150", result.CanonicalFolderID)
		}
		if len(result.LegacyRootFolderIDs) != 1 || result.LegacyRootFolderIDs[0] != 151 {
			t.Fatalf("LegacyRootFolderIDs = %#v, want [151]", result.LegacyRootFolderIDs)
		}
		if result.ReparentedChildFolderCount != 0 {
			t.Fatalf("ReparentedChildFolderCount = %d, want 0", result.ReparentedChildFolderCount)
		}
		if result.ReassignedTableCount != 2 {
			t.Fatalf("ReassignedTableCount = %d, want 2", result.ReassignedTableCount)
		}
		if result.DeletedFolderCount != 1 {
			t.Fatalf("DeletedFolderCount = %d, want 1", result.DeletedFolderCount)
		}

		state.mu.Lock()
		defer state.mu.Unlock()
		if len(state.calls) != 3 {
			t.Fatalf("exec call count = %d, want 3", len(state.calls))
		}

		gotReparentArgs := namedArgsToFolderValues(state.calls[0].args)
		if len(gotReparentArgs) != 2 || gotReparentArgs[0] != int64(150) || gotReparentArgs[1] != int64(151) {
			t.Fatalf("reparent args = %#v, want [150 151]", gotReparentArgs)
		}

		gotTableArgs := namedArgsToFolderValues(state.calls[1].args)
		if len(gotTableArgs) != 2 || gotTableArgs[0] != int64(150) || gotTableArgs[1] != int64(151) {
			t.Fatalf("table move args = %#v, want [150 151]", gotTableArgs)
		}

		gotDeleteArgs := namedArgsToFolderValues(state.calls[2].args)
		if len(gotDeleteArgs) != 1 || gotDeleteArgs[0] != int64(151) {
			t.Fatalf("delete args = %#v, want [151]", gotDeleteArgs)
		}
	})
}

func TestCreateFolderWithQuerierValidatesAndCreatesFolders(t *testing.T) {
	t.Run("creates folder under existing parent", func(t *testing.T) {
		db, _ := openFolderMockDB(t, []folderQueryResponse{
			{
				match: "SELECT EXISTS(SELECT 1 FROM system_table_folders",
				cols:  []string{"exists"},
				rows:  [][]driver.Value{{true}},
			},
			{
				match: "INSERT INTO system_table_folders",
				cols:  []string{"id"},
				rows:  [][]driver.Value{{int64(81)}},
			},
		}, nil)

		parentID := 12
		folderID, err := CreateFolderWithQuerier(db, CreateFolderRequest{
			FolderName: "Reports",
			ParentID:   &parentID,
		})
		if err != nil {
			t.Fatalf("CreateFolderWithQuerier returned error: %v", err)
		}
		if folderID != 81 {
			t.Fatalf("folderID = %d, want 81", folderID)
		}
	})

	t.Run("rejects missing name", func(t *testing.T) {
		db, _ := openFolderMockDB(t, nil, nil)
		if _, err := CreateFolderWithQuerier(db, CreateFolderRequest{FolderName: "   "}); err == nil {
			t.Fatalf("expected missing-name validation error")
		}
	})

	t.Run("rejects missing parent", func(t *testing.T) {
		db, _ := openFolderMockDB(t, []folderQueryResponse{
			{
				match: "SELECT EXISTS(SELECT 1 FROM system_table_folders",
				cols:  []string{"exists"},
				rows:  [][]driver.Value{{false}},
			},
		}, nil)

		parentID := 5
		if _, err := CreateFolderWithQuerier(db, CreateFolderRequest{
			FolderName: "Reports",
			ParentID:   &parentID,
		}); err == nil || !strings.Contains(err.Error(), "parent folder 5 not found") {
			t.Fatalf("err = %v, want parent-missing error", err)
		}
	})
}

func TestHandleDeleteFolderRejectsInvalidJSONAndInvalidID(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/delete-folder", strings.NewReader("{"))
	rec := httptest.NewRecorder()
	HandleDeleteFolder(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid-json status = %d, want 400", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/delete-folder", strings.NewReader(`{"folder_id":0}`))
	rec = httptest.NewRecorder()
	HandleDeleteFolder(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid-id status = %d, want 400", rec.Code)
	}
}

func TestHandleDeleteFolderHandlesNotFoundConflictAndSuccess(t *testing.T) {
	t.Run("folder not found", func(t *testing.T) {
		db, _ := openFolderMockDB(t, []folderQueryResponse{
			{
				match: "SELECT folder_name FROM system_table_folders",
				cols:  []string{"folder_name"},
				rows:  nil,
			},
		}, nil)
		withFolderDB(t, db)

		req := httptest.NewRequest(http.MethodPost, "/api/delete-folder", strings.NewReader(`{"folder_id":5}`))
		rec := httptest.NewRecorder()
		HandleDeleteFolder(rec, req)

		if rec.Code != http.StatusNotFound {
			t.Fatalf("status = %d, want 404", rec.Code)
		}
	})

	t.Run("child folders conflict", func(t *testing.T) {
		db, _ := openFolderMockDB(t, []folderQueryResponse{
			{
				match: "SELECT folder_name FROM system_table_folders",
				cols:  []string{"folder_name"},
				rows:  [][]driver.Value{{"Docs"}},
			},
			{
				match: "SELECT COUNT(*) FROM system_table_folders WHERE parent_id",
				cols:  []string{"count"},
				rows:  [][]driver.Value{{int64(2)}},
			},
		}, nil)
		withFolderDB(t, db)

		req := httptest.NewRequest(http.MethodPost, "/api/delete-folder", strings.NewReader(`{"folder_id":5}`))
		rec := httptest.NewRecorder()
		HandleDeleteFolder(rec, req)

		if rec.Code != http.StatusConflict {
			t.Fatalf("status = %d, want 409", rec.Code)
		}
	})

	t.Run("tables conflict", func(t *testing.T) {
		db, _ := openFolderMockDB(t, []folderQueryResponse{
			{
				match: "SELECT folder_name FROM system_table_folders",
				cols:  []string{"folder_name"},
				rows:  [][]driver.Value{{"Docs"}},
			},
			{
				match: "SELECT COUNT(*) FROM system_table_folders WHERE parent_id",
				cols:  []string{"count"},
				rows:  [][]driver.Value{{int64(0)}},
			},
			{
				match: "SELECT COUNT(*) FROM system_db_tables WHERE folder_id",
				cols:  []string{"count"},
				rows:  [][]driver.Value{{int64(3)}},
			},
		}, nil)
		withFolderDB(t, db)

		req := httptest.NewRequest(http.MethodPost, "/api/delete-folder", strings.NewReader(`{"folder_id":5}`))
		rec := httptest.NewRecorder()
		HandleDeleteFolder(rec, req)

		if rec.Code != http.StatusConflict {
			t.Fatalf("status = %d, want 409", rec.Code)
		}
	})

	t.Run("success", func(t *testing.T) {
		db, state := openFolderMockDB(t, []folderQueryResponse{
			{
				match: "SELECT folder_name FROM system_table_folders",
				cols:  []string{"folder_name"},
				rows:  [][]driver.Value{{"Docs"}},
			},
			{
				match: "SELECT COUNT(*) FROM system_table_folders WHERE parent_id",
				cols:  []string{"count"},
				rows:  [][]driver.Value{{int64(0)}},
			},
			{
				match: "SELECT COUNT(*) FROM system_db_tables WHERE folder_id",
				cols:  []string{"count"},
				rows:  [][]driver.Value{{int64(0)}},
			},
			{
				match: "SELECT DISTINCT lang_key_id",
				cols:  []string{"lang_key_id"},
				rows:  nil,
			},
		}, []folderExecResponse{
			{
				match:        "DELETE FROM system_table_folders WHERE id = $1",
				rowsAffected: 1,
			},
		})
		withFolderDB(t, db)

		req := httptest.NewRequest(http.MethodPost, "/api/delete-folder", strings.NewReader(`{"folder_id":5}`))
		rec := httptest.NewRecorder()
		HandleDeleteFolder(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		body := decodeFolderJSON(t, rec)
		if body["folder_name"] != "Docs" {
			t.Fatalf("folder_name = %#v, want Docs", body["folder_name"])
		}

		state.mu.Lock()
		defer state.mu.Unlock()
		if len(state.calls) != 1 {
			t.Fatalf("exec call count = %d, want 1", len(state.calls))
		}
		got := namedArgsToFolderValues(state.calls[0].args)
		if len(got) != 1 || got[0] != int64(5) {
			t.Fatalf("exec args = %#v, want [5]", got)
		}
	})
}

func TestHandleUpdateFolderRejectsInvalidJSONAndNonFolderType(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/update-folder", strings.NewReader("{"))
	rec := httptest.NewRecorder()
	HandleUpdateFolder(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid-json status = %d, want 400", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/update-folder", strings.NewReader(`{"item_id":1,"item_type":"table","new_folder_id":2,"dataset_uid":99}`))
	rec = httptest.NewRecorder()
	HandleUpdateFolder(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("non-folder type status = %d, want 400", rec.Code)
	}
}

func TestHandleUpdateFolderHandlesFolderSuccess(t *testing.T) {
	db, state := openFolderMockDB(t, []folderQueryResponse{
		{
			match: "WITH RECURSIVE folder_ancestors AS",
			args:  []driver.Value{3},
			cols:  []string{"id", "folder_name"},
			rows:  nil,
		},
		{
			match: "WITH RECURSIVE folder_ancestors AS",
			args:  []driver.Value{9},
			cols:  []string{"id", "folder_name"},
			rows:  nil,
		},
	}, []folderExecResponse{
		{
			match:        "UPDATE system_table_folders",
			rowsAffected: 1,
		},
	})
	withFolderDB(t, db)

	req := httptest.NewRequest(http.MethodPost, "/api/update-folder", strings.NewReader(`{"item_id":3,"item_type":"folder","new_folder_id":9}`))
	rec := httptest.NewRecorder()
	HandleUpdateFolder(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	state.mu.Lock()
	got := namedArgsToFolderValues(state.calls[0].args)
	state.mu.Unlock()
	if len(got) != 2 || got[0] != int64(9) || got[1] != int64(3) {
		t.Fatalf("exec args = %#v, want [9 3]", got)
	}
}
