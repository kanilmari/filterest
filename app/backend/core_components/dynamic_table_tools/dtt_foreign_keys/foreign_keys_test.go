// foreign_keys_test.go
// Verifies existing handlers and their transactional permission boundary.
// Reuses existing package fixtures for offline regression checks.
// Keeps the request and permission contracts covered without a live site.
package dtt_foreign_keys

import (
	"database/sql/driver"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/runtime_grants/granttest"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAddForeignKeyHandlerRejectsInvalidJSONAndMissingFields(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/add-foreign-key", strings.NewReader("{"))
	rec := httptest.NewRecorder()
	AddForeignKeyHandler(granttest.Recorder{ResponseRecorder: rec}, withForeignKeyRequestTx(t, req))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid-json status = %d, want 400", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/add-foreign-key", strings.NewReader(`{"referencing_dataset":"posts"}`))
	rec = httptest.NewRecorder()
	AddForeignKeyHandler(granttest.Recorder{ResponseRecorder: rec}, withForeignKeyRequestTx(t, req))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("missing-fields status = %d, want 400", rec.Code)
	}
}

func TestAddForeignKeyHandlerHandlesTableColumnAndSuccessBranches(t *testing.T) {
	t.Run("missing table", func(t *testing.T) {
		db, _ := openForeignKeyMockDB(t, []foreignKeyQueryResponse{
			{
				match: "FROM information_schema.tables",
				args:  []driver.Value{"posts"},
				cols:  []string{"exists"},
				rows:  [][]driver.Value{{false}},
			},
		}, nil)
		withForeignKeyDB(t, db)

		req := httptest.NewRequest(http.MethodPost, "/api/add-foreign-key", strings.NewReader(`{
			"referencing_dataset":"posts",
			"referencing_column":"author_id",
			"referenced_dataset":"users",
			"referenced_column":"id"
		}`))
		rec := httptest.NewRecorder()
		AddForeignKeyHandler(granttest.Recorder{ResponseRecorder: rec}, withForeignKeyRequestTx(t, req))

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "does not exist") {
			t.Fatalf("body = %q, want missing-table error", rec.Body.String())
		}
	})

	t.Run("missing column", func(t *testing.T) {
		db, _ := openForeignKeyMockDB(t, []foreignKeyQueryResponse{
			{
				match: "FROM information_schema.tables",
				args:  []driver.Value{"posts"},
				cols:  []string{"exists"},
				rows:  [][]driver.Value{{true}},
			},
			{
				match: "FROM information_schema.tables",
				args:  []driver.Value{"users"},
				cols:  []string{"exists"},
				rows:  [][]driver.Value{{true}},
			},
			{
				match: "FROM information_schema.columns",
				args:  []driver.Value{"posts", "author_id"},
				cols:  []string{"exists"},
				rows:  [][]driver.Value{{false}},
			},
		}, nil)
		withForeignKeyDB(t, db)

		req := httptest.NewRequest(http.MethodPost, "/api/add-foreign-key", strings.NewReader(`{
			"referencing_dataset":"posts",
			"referencing_column":"author_id",
			"referenced_dataset":"users",
			"referenced_column":"id"
		}`))
		rec := httptest.NewRecorder()
		AddForeignKeyHandler(granttest.Recorder{ResponseRecorder: rec}, withForeignKeyRequestTx(t, req))

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "columns does not exist") &&
			!strings.Contains(rec.Body.String(), "columns do not exist") &&
			!strings.Contains(rec.Body.String(), "columns") {
			t.Fatalf("body = %q, want missing-column error", rec.Body.String())
		}
	})

	t.Run("success", func(t *testing.T) {
		db, state := openForeignKeyMockDB(t, []foreignKeyQueryResponse{
			{
				match: "FROM information_schema.tables",
				args:  []driver.Value{"posts"},
				cols:  []string{"exists"},
				rows:  [][]driver.Value{{true}},
			},
			{
				match: "FROM information_schema.tables",
				args:  []driver.Value{"users"},
				cols:  []string{"exists"},
				rows:  [][]driver.Value{{true}},
			},
			{
				match: "FROM information_schema.columns",
				args:  []driver.Value{"posts", "author_id"},
				cols:  []string{"exists"},
				rows:  [][]driver.Value{{true}},
			},
			{
				match: "FROM information_schema.columns",
				args:  []driver.Value{"users", "id"},
				cols:  []string{"exists"},
				rows:  [][]driver.Value{{true}},
			},
		}, []foreignKeyExecResponse{
			{
				match:        "ALTER TABLE",
				rowsAffected: 1,
			},
		})
		withForeignKeyDB(t, db)

		req := httptest.NewRequest(http.MethodPost, "/api/add-foreign-key", strings.NewReader(`{
			"referencing_dataset":"posts",
			"referencing_column":"author_id",
			"referenced_dataset":"users",
			"referenced_column":"id"
		}`))
		rec := httptest.NewRecorder()
		AddForeignKeyHandler(granttest.Recorder{ResponseRecorder: rec}, withForeignKeyRequestTx(t, req))

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		body := decodeForeignKeyJSONMap(t, rec)
		if body["message"] != "Foreign key added successfully" {
			t.Fatalf("message = %#v, want success text", body["message"])
		}
		if len(state.execCalls) != 1 {
			t.Fatalf("exec calls = %d, want 1", len(state.execCalls))
		}
		query := state.execCalls[0].query
		for _, want := range []string{`"posts"`, `"fk_posts_author_id"`, `"author_id"`, `"users"`, `"id"`} {
			if !strings.Contains(query, want) {
				t.Fatalf("exec query = %q, want substring %q", query, want)
			}
		}
	})
}

func TestGetTableNamesHandlerHandlesQueryErrorAndSuccess(t *testing.T) {
	t.Run("query error", func(t *testing.T) {
		db, _ := openForeignKeyMockDB(t, []foreignKeyQueryResponse{
			{
				match: "FROM information_schema.tables",
				err:   fmt.Errorf("boom"),
			},
		}, nil)
		withForeignKeyDB(t, db)

		req := httptest.NewRequest(http.MethodGet, "/api/table-names", nil)
		rec := httptest.NewRecorder()
		GetTableNamesHandler(rec, req)

		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", rec.Code)
		}
	})

	t.Run("success", func(t *testing.T) {
		db, _ := openForeignKeyMockDB(t, []foreignKeyQueryResponse{
			{
				match: "FROM information_schema.tables",
				cols:  []string{"table_name"},
				rows:  [][]driver.Value{{"posts"}, {"users"}},
			},
		}, nil)
		withForeignKeyDB(t, db)

		req := httptest.NewRequest(http.MethodGet, "/api/table-names", nil)
		rec := httptest.NewRecorder()
		GetTableNamesHandler(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		tableNames := decodeForeignKeyJSONArray(t, rec)
		if len(tableNames) != 2 || tableNames[0] != "posts" || tableNames[1] != "users" {
			t.Fatalf("tableNames = %#v, want [posts users]", tableNames)
		}
	})

	t.Run("success with aliases", func(t *testing.T) {
		db, _ := openForeignKeyMockDB(t, []foreignKeyQueryResponse{
			{
				match: "FROM information_schema.tables",
				cols:  []string{"table_name"},
				rows:  [][]driver.Value{{"app_service_catalog"}, {"system_users"}},
			},
			{
				match: "FROM system_db_table_aliases",
				cols:  []string{"table_name", "alias_slug"},
				rows:  [][]driver.Value{{"app_service_catalog", "service_directory"}},
			},
		}, nil)
		withForeignKeyDB(t, db)

		req := httptest.NewRequest(http.MethodGet, "/api/table-names?with_aliases=1", nil)
		rec := httptest.NewRecorder()
		GetTableNamesHandler(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}

		var payload struct {
			Names       []string          `json:"names"`
			RawToPublic map[string]string `json:"raw_to_public"`
			PublicToRaw map[string]string `json:"public_to_raw"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
			t.Fatalf("unmarshal alias payload: %v", err)
		}
		if len(payload.Names) != 2 || payload.Names[0] != "app_service_catalog" || payload.Names[1] != "system_users" {
			t.Fatalf("payload.Names = %#v, want [app_service_catalog system_users]", payload.Names)
		}
		if got := payload.RawToPublic["app_service_catalog"]; got != "service_directory" {
			t.Fatalf("payload.RawToPublic[app_service_catalog] = %q, want service_directory", got)
		}
		if got := payload.PublicToRaw["service_directory"]; got != "app_service_catalog" {
			t.Fatalf("payload.PublicToRaw[service_directory] = %q, want app_service_catalog", got)
		}
	})
}

// Permissions attach to a catalogued table_uid, so a physical table missing from
// system_db_tables (such as the media registry) must not be listed: one such name
// in a multi-dataset request denied the foreign-keys page to every administrator.
func TestGetTableNamesHandlerListsOnlyCataloguedDatasets(t *testing.T) {
	db, state := openForeignKeyMockDB(t, []foreignKeyQueryResponse{
		{
			match: "FROM information_schema.tables",
			cols:  []string{"table_name"},
			rows:  [][]driver.Value{{"posts"}},
		},
	}, nil)
	withForeignKeyDB(t, db)

	rec := httptest.NewRecorder()
	GetTableNamesHandler(rec, httptest.NewRequest(http.MethodGet, "/api/dataset-names", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if len(state.queryCalls) != 1 {
		t.Fatalf("query calls = %d, want 1", len(state.queryCalls))
	}
	query := state.queryCalls[0].query
	for _, want := range []string{"EXISTS", "FROM system_db_tables sdt", "sdt.table_name = t.table_name"} {
		if !strings.Contains(query, want) {
			t.Fatalf("table-name query = %q, want catalogue condition %q", query, want)
		}
	}
}

func TestGetForeignKeysHandlesQueryErrorAndDatasetFilterSuccess(t *testing.T) {
	t.Run("query error", func(t *testing.T) {
		db, _ := openForeignKeyMockDB(t, []foreignKeyQueryResponse{
			{
				match: "tc.constraint_type = 'FOREIGN KEY'",
				err:   fmt.Errorf("boom"),
			},
		}, nil)
		withForeignKeyDB(t, db)

		req := httptest.NewRequest(http.MethodGet, "/api/foreign-keys", nil)
		rec := httptest.NewRecorder()
		GetForeignKeys(rec, req)

		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", rec.Code)
		}
	})

	t.Run("dataset filter success", func(t *testing.T) {
		db, state := openForeignKeyMockDB(t, []foreignKeyQueryResponse{
			{
				match: "FROM information_schema.tables",
				args:  []driver.Value{"posts"},
				cols:  []string{"exists"},
				rows:  [][]driver.Value{{true}},
			},
			{
				match: "FROM information_schema.tables",
				args:  []driver.Value{"ghosts"},
				cols:  []string{"exists"},
				rows:  [][]driver.Value{{false}},
			},
			{
				match: "tc.constraint_type = 'FOREIGN KEY'",
				cols: []string{
					"constraint_name",
					"referencing_table",
					"referencing_column",
					"referenced_table",
					"referenced_column",
				},
				rows: [][]driver.Value{{"fk_posts_author_id", "posts", "author_id", "users", "id"}},
			},
		}, nil)
		withForeignKeyDB(t, db)

		req := httptest.NewRequest(http.MethodGet, "/api/foreign-keys?datasets=posts,ghosts", nil)
		rec := httptest.NewRecorder()
		GetForeignKeys(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		body := decodeForeignKeyJSONMap(t, rec)
		columns, ok := body["columns"].([]interface{})
		if !ok || len(columns) != 4 {
			t.Fatalf("columns = %#v, want 4 response columns", body["columns"])
		}
		data, ok := body["data"].([]interface{})
		if !ok || len(data) != 1 {
			t.Fatalf("data = %#v, want one row", body["data"])
		}
		if len(state.queryCalls) != 3 {
			t.Fatalf("query calls = %d, want 3", len(state.queryCalls))
		}
		if !strings.Contains(state.queryCalls[2].query, "ANY($1)") {
			t.Fatalf("final query = %q, want dataset filter clause", state.queryCalls[2].query)
		}
	})
}

func TestDeleteForeignKeyHandlerRejectsInvalidJSONAndHandlesExecBranches(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/delete-foreign-key", strings.NewReader("{"))
	rec := httptest.NewRecorder()
	DeleteForeignKeyHandler(granttest.Recorder{ResponseRecorder: rec}, withForeignKeyRequestTx(t, req))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid-json status = %d, want 400", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/delete-foreign-key", strings.NewReader(`{"constraint_name":"fk_posts_author_id"}`))
	rec = httptest.NewRecorder()
	DeleteForeignKeyHandler(granttest.Recorder{ResponseRecorder: rec}, withForeignKeyRequestTx(t, req))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("missing-fields status = %d, want 400", rec.Code)
	}

	t.Run("exec error", func(t *testing.T) {
		db, _ := openForeignKeyMockDB(t, nil, []foreignKeyExecResponse{
			{
				match: "ALTER TABLE",
				err:   fmt.Errorf("boom"),
			},
		})
		withForeignKeyDB(t, db)

		req := httptest.NewRequest(http.MethodPost, "/api/delete-foreign-key", strings.NewReader(`{
			"constraint_name":"fk_posts_author_id",
			"referencing_dataset":"posts"
		}`))
		rec := httptest.NewRecorder()
		DeleteForeignKeyHandler(granttest.Recorder{ResponseRecorder: rec}, withForeignKeyRequestTx(t, req))

		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", rec.Code)
		}
	})

	t.Run("success", func(t *testing.T) {
		db, state := openForeignKeyMockDB(t, nil, []foreignKeyExecResponse{
			{
				match:        "ALTER TABLE",
				rowsAffected: 1,
			},
		})
		withForeignKeyDB(t, db)

		req := httptest.NewRequest(http.MethodPost, "/api/delete-foreign-key", strings.NewReader(`{
			"constraint_name":"fk_posts_author_id",
			"referencing_dataset":"posts"
		}`))
		rec := httptest.NewRecorder()
		DeleteForeignKeyHandler(granttest.Recorder{ResponseRecorder: rec}, withForeignKeyRequestTx(t, req))

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		body := decodeForeignKeyJSONMap(t, rec)
		if body["message"] != "Vierasavain poistettu onnistuneesti" {
			t.Fatalf("message = %#v, want delete success text", body["message"])
		}
		if len(state.execCalls) != 1 {
			t.Fatalf("exec calls = %d, want 1", len(state.execCalls))
		}
		query := state.execCalls[0].query
		for _, want := range []string{`"posts"`, `"fk_posts_author_id"`} {
			if !strings.Contains(query, want) {
				t.Fatalf("exec query = %q, want substring %q", query, want)
			}
		}
	})
}

func TestActorForeignKeyHandlersRefuseWithoutDDL(t *testing.T) {
	for _, column := range []string{"created_by", "user_id"} {
		queries := make([]foreignKeyQueryResponse, 4)
		for i := range queries {
			queries[i] = foreignKeyQueryResponse{cols: []string{"exists"}, rows: [][]driver.Value{{true}}}
		}
		db, state := openForeignKeyMockDB(t, queries, nil)
		old := backend.Db
		backend.Db = db
		state.actorRows = [][]driver.Value{{"created_by", "creator"}, {"user_id", "owner"}}
		rec := httptest.NewRecorder()
		AddForeignKeyHandler(granttest.Recorder{ResponseRecorder: rec}, withForeignKeyRequestTx(t, httptest.NewRequest("POST", "/", strings.NewReader(fmt.Sprintf(`{"referencing_dataset":"notes","referencing_column":%q,"referenced_dataset":"system_users","referenced_column":"id"}`, column)))))
		if rec.Code != 400 || !strings.Contains(rec.Body.String(), "error_owner_column_protected") || len(state.execCalls) != 0 {
			t.Fatalf("add %s: %d %s writes=%v", column, rec.Code, rec.Body, state.execCalls)
		}
		state.constraintColumns = "{title," + column + "}"
		rec = httptest.NewRecorder()
		DeleteForeignKeyHandler(granttest.Recorder{ResponseRecorder: rec}, withForeignKeyRequestTx(t, httptest.NewRequest("POST", "/", strings.NewReader(`{"referencing_dataset":"notes","constraint_name":"composite_actor_fk"}`))))
		backend.Db = old
		if rec.Code != 400 || !strings.Contains(rec.Body.String(), "error_owner_column_protected") || len(state.execCalls) != 0 {
			t.Fatalf("drop: %d %s writes=%v", rec.Code, rec.Body, state.execCalls)
		}
	}
}

// Use the same lazy request transaction as the route pipeline. The driver rejects
// actor checks and DDL that escape onto a separate pool connection.
func withForeignKeyRequestTx(t *testing.T, req *http.Request) *http.Request {
	t.Helper()
	tx := dbutils.NewLazyTx(backend.Db)
	t.Cleanup(func() { _ = tx.Rollback() })
	return req.WithContext(dbutils.SetLazyTx(req.Context(), tx))
}
