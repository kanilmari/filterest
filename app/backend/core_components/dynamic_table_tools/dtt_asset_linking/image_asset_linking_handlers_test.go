// image_asset_linking_handlers_test.go
// Verifies existing handlers and their transactional permission boundary.
// Reuses existing package fixtures for offline regression checks.
// Keeps the request and permission contracts covered without a live site.
package dtt_asset_linking

import (
	"database/sql/driver"
	"easelect/backend/core_components/runtime_grants/granttest"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBuildFileUploadSpecs(t *testing.T) {
	specs := BuildImageTargetInsertSpecs("articles", 12, []string{"png", "webp"})

	fileUpload, ok := specs["file_upload"].(map[string]interface{})
	if !ok {
		t.Fatalf("file_upload = %#v, want nested map", specs["file_upload"])
	}
	if fileUpload["enabled"] != true {
		t.Fatalf("enabled = %#v, want true", fileUpload["enabled"])
	}
	if fileUpload["max_file_size_mb"] != 12 {
		t.Fatalf("max_file_size_mb = %#v, want 12", fileUpload["max_file_size_mb"])
	}
	cacheTargets, ok := fileUpload["cache_targets"].([]map[string]string)
	if !ok || len(cacheTargets) != 1 {
		t.Fatalf("cache_targets = %#v, want one target", fileUpload["cache_targets"])
	}
	if cacheTargets[0]["table"] != "articles" || cacheTargets[0]["column"] != "cached_image" {
		t.Fatalf("cache_targets[0] = %#v, want parent table + cached_image", cacheTargets[0])
	}
}

func TestCopyTablePermissionsExecutesInsert(t *testing.T) {
	stub := &imageAssetLinkingExecStub{}
	CopyTablePermissions(stub, 11, 22)

	if !strings.Contains(stub.query, "INSERT INTO system_group_table_func_rights") {
		t.Fatalf("query = %q, want permission-copy insert", stub.query)
	}
	if len(stub.args) != 2 || stub.args[0] != 22 || stub.args[1] != 11 {
		t.Fatalf("args = %#v, want childUID then parentUID", stub.args)
	}
}

func TestEnsureCachedImageColumnRefreshesColumnMetadata(t *testing.T) {
	db, state := openImageLinkingMockDB(t, []imageAssetLinkingQueryResponse{
		{
			match: "FROM information_schema.columns",
			cols:  []string{"count"},
			rows:  [][]driver.Value{{int64(0)}},
		},
		{
			match: "WHERE parent_id IS NULL",
			cols:  []string{"id"},
			rows:  [][]driver.Value{{int64(10)}},
		},
		{
			match: "WHERE parent_id = $1",
			cols:  []string{"id"},
			rows:  [][]driver.Value{{int64(11)}},
		},
		{
			match: "SELECT c.oid, n.nspname AS schema_name",
			cols:  []string{"oid", "schema_name", "table_name"},
			rows:  nil,
		},
		{
			match: "SELECT table_name, table_uid",
			cols:  []string{"table_name", "table_uid"},
			rows:  [][]driver.Value{{"articles", int64(22)}},
		},
		{
			match: "FROM pg_attribute a",
			cols:  []string{"attname", "attnum", "data_type"},
			rows: [][]driver.Value{
				{"id", int64(1), "integer"},
				{"cached_image", int64(2), "text"},
			},
		},
		{
			match: "FROM system_column_details",
			cols:  []string{"column_name", "column_uid", "data_type"},
			rows:  nil,
		},
	}, []imageAssetLinkingExecResponse{
		{
			match:        "ALTER TABLE articles ADD COLUMN cached_image TEXT",
			rowsAffected: 1,
		},
		{
			match:        "WITH ghost_entries",
			rowsAffected: 0,
		},
		{
			match:        "UPDATE system_db_tables AS t",
			rowsAffected: 0,
		},
		{
			match:        "WITH table_oids",
			rowsAffected: 0,
		},
		{
			match:        "WITH removed_tables",
			rowsAffected: 0,
		},
		{
			match:        "DELETE FROM system_column_details",
			rowsAffected: 0,
		},
		{
			match:        "INSERT INTO system_column_details",
			rowsAffected: 1,
		},
		{
			match:        "SET card_element = 'image'",
			rowsAffected: 1,
		},
	})

	if err := EnsureCachedImageColumn(db, "articles"); err != nil {
		t.Fatalf("EnsureCachedImageColumn returned error: %v", err)
	}

	state.mu.Lock()
	defer state.mu.Unlock()

	var sawCachedImageMetadata bool
	var sawCachedImageCardRole bool
	for _, call := range state.calls {
		if strings.Contains(call.query, "SET card_element = 'image'") {
			args := namedArgsToValues(call.args)
			if len(args) == 1 && args[0] == "articles" {
				sawCachedImageCardRole = true
			}
		}
		if strings.Contains(call.query, "INSERT INTO system_column_details") {
			args := namedArgsToValues(call.args)
			if len(args) >= 2 && args[0] == int64(22) && args[1] == "cached_image" {
				sawCachedImageMetadata = true
			}
		}
	}
	if !sawCachedImageMetadata {
		t.Fatalf("system_column_details insert for cached_image was not executed; calls = %#v", state.calls)
	}
	if !sawCachedImageCardRole {
		t.Fatalf("cached_image card_element=image update was not executed; calls = %#v", state.calls)
	}
}

func TestEnsureCachedImageColumnRepairsExistingColumnCardRole(t *testing.T) {
	db, state := openImageLinkingMockDB(t, []imageAssetLinkingQueryResponse{
		{
			match: "FROM information_schema.columns",
			cols:  []string{"count"},
			rows:  [][]driver.Value{{int64(1)}},
		},
	}, []imageAssetLinkingExecResponse{
		{
			match:        "SET card_element = 'image'",
			rowsAffected: 1,
		},
	})

	if err := EnsureCachedImageColumn(db, "articles"); err != nil {
		t.Fatalf("EnsureCachedImageColumn returned error: %v", err)
	}

	state.mu.Lock()
	defer state.mu.Unlock()
	if len(state.calls) != 1 {
		t.Fatalf("exec calls = %#v, want only the targeted metadata repair", state.calls)
	}
	if !strings.Contains(state.calls[0].query, "SET card_element = 'image'") {
		t.Fatalf("query = %q, want cached_image card role repair", state.calls[0].query)
	}
	if got := namedArgsToValues(state.calls[0].args); len(got) != 1 || got[0] != "articles" {
		t.Fatalf("args = %#v, want [articles]", got)
	}
}

func TestEnableImageAssetLinkingHandlerRejectsGuardBranches(t *testing.T) {
	tests := []struct {
		name       string
		method     string
		body       string
		wantStatus int
		wantBody   string
	}{
		{
			name:       "invalid json",
			method:     http.MethodPost,
			body:       "{",
			wantStatus: http.StatusBadRequest,
			wantBody:   "invalid request body",
		},
		{
			name:       "invalid identifier",
			method:     http.MethodPost,
			body:       `{"parent_table":"bad-name"}`,
			wantStatus: http.StatusBadRequest,
			wantBody:   "invalid parent table name",
		},
		{
			name:       "missing transaction",
			method:     http.MethodPost,
			body:       `{"parent_table":"articles"}`,
			wantStatus: http.StatusInternalServerError,
			wantBody:   "permissions could not be saved",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, "/api/asset-linking/images/enable", strings.NewReader(tt.body))
			rec := httptest.NewRecorder()
			EnableImageAssetLinkingHandler(granttest.Recorder{ResponseRecorder: rec}, req)

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
			if !strings.Contains(rec.Body.String(), tt.wantBody) {
				t.Fatalf("body = %q, want substring %q", rec.Body.String(), tt.wantBody)
			}
		})
	}
}

func TestRemoveImageAssetLinkingHandlerRejectsGuardBranches(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		wantStatus int
		wantBody   string
	}{
		{
			name:       "invalid json",
			body:       "{",
			wantStatus: http.StatusBadRequest,
			wantBody:   "invalid request body",
		},
		{
			name:       "confirm required",
			body:       `{"parent_table":"articles","confirm":false}`,
			wantStatus: http.StatusBadRequest,
			wantBody:   "destructive operation requires 'confirm': true",
		},
		{
			name:       "invalid identifier",
			body:       `{"parent_table":"bad-name","confirm":true}`,
			wantStatus: http.StatusBadRequest,
			wantBody:   "invalid parent table name",
		},
		{
			name:       "missing transaction",
			body:       `{"parent_table":"articles","confirm":true}`,
			wantStatus: http.StatusInternalServerError,
			wantBody:   "permissions could not be saved",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/api/asset-linking/images/remove", strings.NewReader(tt.body))
			rec := httptest.NewRecorder()
			RemoveImageAssetLinkingHandler(granttest.Recorder{ResponseRecorder: rec}, req)

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
			if !strings.Contains(rec.Body.String(), tt.wantBody) {
				t.Fatalf("body = %q, want substring %q", rec.Body.String(), tt.wantBody)
			}
		})
	}
}

func TestDisableImageAssetLinkingHandlerRejectsInvalidJSON(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/asset-linking/images/disable", strings.NewReader("{"))
	rec := httptest.NewRecorder()
	DisableImageAssetLinkingHandler(granttest.Recorder{ResponseRecorder: rec}, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid-json status = %d, want 400", rec.Code)
	}
}

func TestDisableImageAssetLinkingHandlerHandlesLookupMissAndSuccess(t *testing.T) {
	t.Run("parent not found", func(t *testing.T) {
		db, _ := openImageLinkingMockDB(t, []imageAssetLinkingQueryResponse{
			{
				match: "SELECT table_uid FROM system_db_tables",
				cols:  []string{"table_uid"},
				rows:  nil,
			},
		}, nil)
		withImageLinkingDB(t, db)

		req := httptest.NewRequest(http.MethodPost, "/api/asset-linking/images/disable", strings.NewReader(`{"parent_table":"articles"}`))
		rec := httptest.NewRecorder()
		DisableImageAssetLinkingHandler(granttest.Recorder{ResponseRecorder: rec}, withImageLinkingTx(req, db))

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", rec.Code)
		}
	})

	t.Run("no image assets found", func(t *testing.T) {
		db, _ := openImageLinkingMockDB(t, []imageAssetLinkingQueryResponse{
			{
				match: "SELECT table_uid FROM system_db_tables",
				cols:  []string{"table_uid"},
				rows:  [][]driver.Value{{int64(21)}},
			},
			{
				match: "FROM system_foreign_key_relations_1_m",
				cols:  []string{"id", "child_table", "parent_table", "source_column_name", "target_insert_specs"},
				rows:  [][]driver.Value{},
			},
		}, []imageAssetLinkingExecResponse{
			{
				match:        "UPDATE system_foreign_key_relations_1_m",
				rowsAffected: 0,
			},
		})
		withImageLinkingDB(t, db)

		req := httptest.NewRequest(http.MethodPost, "/api/asset-linking/images/disable", strings.NewReader(`{"parent_table":"articles"}`))
		rec := httptest.NewRecorder()
		DisableImageAssetLinkingHandler(granttest.Recorder{ResponseRecorder: rec}, withImageLinkingTx(req, db))

		if rec.Code != http.StatusNotFound {
			t.Fatalf("status = %d, want 404", rec.Code)
		}
	})

	t.Run("success", func(t *testing.T) {
		db, state := openImageLinkingMockDB(t, []imageAssetLinkingQueryResponse{
			{
				match: "SELECT table_uid FROM system_db_tables",
				cols:  []string{"table_uid"},
				rows:  [][]driver.Value{{int64(21)}},
			},
			{
				match: "FROM system_foreign_key_relations_1_m",
				cols:  []string{"id", "child_table", "parent_table", "source_column_name", "target_insert_specs"},
				rows: [][]driver.Value{{
					int64(17),
					"articles_gallery",
					"articles",
					"articles_id",
					[]byte(`{"file_upload":{"enabled":true,"profile_key":"image","target_directory":"media","cache_targets":[{"table":"articles","column":"cached_image"}],"max_file_size_mb":10,"allowed_file_types":["png"]}}`),
				}},
			},
		}, []imageAssetLinkingExecResponse{
			{
				match:        "UPDATE system_foreign_key_relations_1_m",
				rowsAffected: 1,
			},
		})
		withImageLinkingDB(t, db)

		req := httptest.NewRequest(http.MethodPost, "/api/asset-linking/images/disable", strings.NewReader(`{"parent_table":"articles"}`))
		rec := httptest.NewRecorder()
		DisableImageAssetLinkingHandler(granttest.Recorder{ResponseRecorder: rec}, withImageLinkingTx(req, db))

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		body := decodeJSONBody(t, rec)
		if body["parent_table"] != "articles" {
			t.Fatalf("body[parent_table] = %#v, want articles", body["parent_table"])
		}

		state.mu.Lock()
		defer state.mu.Unlock()
		if len(state.calls) != 1 {
			t.Fatalf("exec call count = %d, want 1", len(state.calls))
		}
		if got := namedArgsToValues(state.calls[0].args); len(got) != 2 || got[1] != int64(17) {
			t.Fatalf("exec args = %#v, want [updated JSON, 17]", got)
		}
	})
}

func TestUpdateImageAssetLinkingHandlerHandlesMalformedSpecsAndSuccess(t *testing.T) {
	t.Run("malformed file_upload specs behave like missing image assets", func(t *testing.T) {
		db, _ := openImageLinkingMockDB(t, []imageAssetLinkingQueryResponse{
			{
				match: "SELECT table_uid FROM system_db_tables",
				cols:  []string{"table_uid"},
				rows:  [][]driver.Value{{int64(21)}},
			},
			{
				match: "FROM system_foreign_key_relations_1_m",
				cols:  []string{"id", "child_table", "parent_table", "source_column_name", "target_insert_specs"},
				rows: [][]driver.Value{{
					int64(17),
					"articles_gallery",
					"articles",
					"articles_id",
					[]byte(`{"other":true}`),
				}},
			},
		}, nil)
		withImageLinkingDB(t, db)

		req := httptest.NewRequest(http.MethodPost, "/api/asset-linking/images/update", strings.NewReader(`{"parent_table":"articles"}`))
		rec := httptest.NewRecorder()
		UpdateImageAssetLinkingHandler(granttest.Recorder{ResponseRecorder: rec}, withImageLinkingTx(req, db))

		if rec.Code != http.StatusNotFound {
			t.Fatalf("status = %d, want 404", rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "no image assets found") {
			t.Fatalf("body = %q, want missing image asset error", rec.Body.String())
		}
	})

	t.Run("success", func(t *testing.T) {
		db, state := openImageLinkingMockDB(t, []imageAssetLinkingQueryResponse{
			{
				match: "SELECT table_uid FROM system_db_tables",
				cols:  []string{"table_uid"},
				rows:  [][]driver.Value{{int64(21)}},
			},
			{
				match: "FROM system_foreign_key_relations_1_m",
				cols:  []string{"id", "child_table", "parent_table", "source_column_name", "target_insert_specs"},
				rows: [][]driver.Value{{
					int64(17),
					"articles_gallery",
					"articles",
					"articles_id",
					[]byte(`{"file_upload":{"enabled":true,"profile_key":"image","target_directory":"media","cache_targets":[{"table":"articles","column":"cached_image"}],"max_file_size_mb":10,"allowed_file_types":["png"]}}`),
				}},
			},
		}, []imageAssetLinkingExecResponse{
			{
				match:        "UPDATE system_foreign_key_relations_1_m",
				rowsAffected: 1,
			},
		})
		withImageLinkingDB(t, db)

		req := httptest.NewRequest(http.MethodPost, "/api/asset-linking/images/update", strings.NewReader(`{
			"parent_table":"articles",
			"enabled":false,
			"max_file_size_mb":15,
			"allowed_file_types":["png","webp"]
		}`))
		rec := httptest.NewRecorder()
		UpdateImageAssetLinkingHandler(granttest.Recorder{ResponseRecorder: rec}, withImageLinkingTx(req, db))

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}

		state.mu.Lock()
		defer state.mu.Unlock()
		if len(state.calls) != 1 {
			t.Fatalf("exec call count = %d, want 1", len(state.calls))
		}
		got := namedArgsToValues(state.calls[0].args)
		if len(got) != 2 || got[1] != int64(17) {
			t.Fatalf("exec args = %#v, want updated JSON and relation id", got)
		}

		updatedJSON, ok := got[0].([]byte)
		if !ok {
			t.Fatalf("updated specs arg = %#v, want []byte", got[0])
		}

		var updated map[string]interface{}
		if err := json.Unmarshal(updatedJSON, &updated); err != nil {
			t.Fatalf("json.Unmarshal(updatedJSON) returned error: %v", err)
		}
		fileUpload := updated["file_upload"].(map[string]interface{})
		if fileUpload["enabled"] != false {
			t.Fatalf("enabled = %#v, want false", fileUpload["enabled"])
		}
		if fileUpload["max_file_size_mb"] != float64(15) {
			t.Fatalf("max_file_size_mb = %#v, want 15", fileUpload["max_file_size_mb"])
		}
	})
}

func TestGetImageAssetLinkingStatusHandlerReturnsParsedRows(t *testing.T) {
	specs := []byte(`{"file_upload":{"enabled":true,"profile_key":"image","target_directory":"media","cache_targets":[{"table":"articles","column":"cached_image"}],"max_file_size_mb":10,"allowed_file_types":["png","webp"]}}`)
	db, _ := openImageLinkingMockDB(t, []imageAssetLinkingQueryResponse{
		{
			match: "FROM system_foreign_key_relations_1_m",
			cols:  []string{"id", "child_table", "parent_table", "source_column_name", "target_insert_specs"},
			rows: [][]driver.Value{
				{int64(1), "articles_gallery", "articles", "articles_id", specs},
				{int64(2), "broken_gallery", "broken", "broken_id", []byte(`{`)},
			},
		},
	}, nil)
	withImageLinkingDB(t, db)

	req := httptest.NewRequest(http.MethodGet, "/api/asset-linking/images/status?table=articles", nil)
	rec := httptest.NewRecorder()
	GetImageAssetLinkingStatusHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	body := decodeJSONBody(t, rec)
	imageAssetLinkings, ok := body["asset_linkings"].([]interface{})
	if !ok || len(imageAssetLinkings) != 1 {
		t.Fatalf("asset_linkings = %#v, want one parsed result", body["asset_linkings"])
	}
	first := imageAssetLinkings[0].(map[string]interface{})
	if first["parent_table"] != "articles" || first["child_table"] != "articles_gallery" {
		t.Fatalf("first result = %#v, want articles mapping", first)
	}
	if first["foreign_key_column"] != "articles_id" {
		t.Fatalf("foreign_key_column = %#v, want articles_id", first["foreign_key_column"])
	}
	if first["relation_kind"] != "image_asset" {
		t.Fatalf("relation_kind = %#v, want image_asset", first["relation_kind"])
	}
	if first["enabled"] != true {
		t.Fatalf("enabled = %#v, want true", first["enabled"])
	}
}

func TestGetImageAssetLinkingStatusHandlerHandlesQueryFailure(t *testing.T) {
	db, _ := openImageLinkingMockDB(t, []imageAssetLinkingQueryResponse{
		{
			match: "FROM system_foreign_key_relations_1_m",
			err:   fmt.Errorf("boom"),
		},
	}, nil)
	withImageLinkingDB(t, db)

	req := httptest.NewRequest(http.MethodGet, "/api/asset-linking/images/status", nil)
	rec := httptest.NewRecorder()
	GetImageAssetLinkingStatusHandler(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("query-failure status = %d, want 500", rec.Code)
	}
}

func TestCopyTablePermissionsReturnsExecError(t *testing.T) {
	stub := &imageAssetLinkingExecStub{err: fmt.Errorf("copy failed")}
	if err := CopyTablePermissions(stub, 11, 22); err == nil || !strings.Contains(err.Error(), "copy failed") {
		t.Fatal(err)
	}
}
