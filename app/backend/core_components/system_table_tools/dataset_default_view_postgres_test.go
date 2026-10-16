// dataset_default_view_postgres_test.go
// Proves administrator-only default saves and canonical results readback on disposable PostgreSQL.
// Reuses the package's public-bootstrap Unix-socket fixture and session helper.
// Never connects to installation data; the entire fixture cluster is removed afterwards.
package system_table_tools

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"easelect/backend/core_components/dbutils"
	read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
)

func defaultViewTestRequest(t *testing.T, db *sql.DB, user int, body string) *httptest.ResponseRecorder {
	t.Helper()
	method, address := http.MethodPost, "/api/admin/dataset-default-view"
	if body == "" {
		method = http.MethodGet
		address += "?dataset=wl143_content"
	}
	request := frontPageSessionRequest(t, user, "admin", method, address)
	if body != "" {
		request = datasetSortRequestWithUser(t, method, address, body, user)
	}
	lazy := dbutils.NewLazyTx(db)
	defer lazy.Rollback()
	request = request.WithContext(dbutils.SetLazyTx(request.Context(), lazy))
	response := httptest.NewRecorder()
	DatasetDefaultViewHandler(response, request)
	if response.Code == http.StatusOK {
		if err := lazy.Commit(); err != nil {
			t.Fatal(err)
		}
	}
	return response
}

func TestDatasetDefaultViewAuthorizationValidationAndReadbackPostgres(t *testing.T) {
	db := frontPageDisposableDB(t)
	frontPageExec(t, db, `UPDATE system_users SET admin_access_allowed=true WHERE id=42;
	 DELETE FROM system_group_table_func_rights rights USING system_functions functions
	 WHERE rights.function_id=functions.id AND rights.user_group_id=2 AND functions.url_route_endpoint='/ui/view/card';
	 INSERT INTO public.system_column_details(table_uid,column_name,data_type,co_number)
	 SELECT registry.table_uid,c.column_name,c.data_type,c.ordinal_position FROM information_schema.columns c
	 JOIN system_db_tables registry ON registry.table_name=c.table_name
	 WHERE c.table_schema='public' AND c.table_name='wl143_content';`)
	// Copy migration replays preserve authored translations and never create route grants.
	copySQL, err := os.ReadFile("../../../server_tools/migrations/20261015000003_seed_dataset_default_view_language_keys.sql")
	if err != nil {
		t.Fatal(err)
	}
	frontPageExec(t, db, string(copySQL))
	frontPageExec(t, db, string(copySQL))
	for _, user := range []int{1, 73} {
		response := defaultViewTestRequest(t, db, user, `{"dataset":"wl143_content","view_key":"calendar"}`)
		if response.Code != http.StatusForbidden && response.Code != http.StatusUnauthorized {
			t.Fatal(user, response.Code, response.Body.String())
		}
	}
	for _, view := range []string{"unknown", "map", "tree", "settings", "cloud_management", "price_chart"} {
		response := defaultViewTestRequest(t, db, 42, `{"dataset":"wl143_content","view_key":"`+view+`"}`)
		if response.Code != http.StatusBadRequest {
			t.Fatal(view, response.Code, response.Body.String())
		}
	}
	read.InvalidateSchemaCache("wl143_content")
	read.InvalidatePermissionsCache("wl143_content")
	t.Cleanup(func() { read.InvalidateSchemaCache("wl143_content"); read.InvalidatePermissionsCache("wl143_content") })
	readMetadata := func() map[string]any {
		t.Helper()
		request := frontPageSessionRequest(t, 42, "admin", "GET", "/api/get-results?dataset=wl143_content&view_key=card&support_profile=card")
		result := httptest.NewRecorder()
		read.GetResults(result, request)
		var payload map[string]json.RawMessage
		if result.Code != 200 || json.Unmarshal(result.Body.Bytes(), &payload) != nil {
			t.Fatal(result.Code, result.Body.String())
		}
		var metadata map[string]any
		if err := json.Unmarshal(payload["table_meta"], &metadata); err != nil {
			t.Fatal(err, result.Body.String())
		}
		return metadata
	}
	// Prime the real results cache before mutation; per-save test invalidation
	// would hide a missing production post-commit invalidation hook.
	readMetadata()
	for _, view := range []string{`"card"`, `"calendar"`, `null`} {
		response := defaultViewTestRequest(t, db, 42, `{"dataset":"wl143_content","view_key":`+view+`}`)
		if response.Code != http.StatusOK {
			t.Fatal(response.Code, response.Body.String())
		}
		var saved map[string]any
		if err := json.Unmarshal(response.Body.Bytes(), &saved); err != nil {
			t.Fatal(err)
		}
		want := any("calendar")
		if view == `"card"` {
			want = "card"
		}
		if view == "null" {
			want = nil
		}
		if actual, present := saved["default_view_name"]; !present || actual != want {
			t.Fatal(saved)
		}
		if _, present := saved["default_view_id"]; !present {
			t.Fatal("missing cleared id", saved)
		}
		get := defaultViewTestRequest(t, db, 42, "")
		if get.Code != 200 {
			t.Fatal(get.Body.String())
		}
		metadata := readMetadata()
		if actual, present := metadata["default_view_name"]; !present || actual != want {
			t.Fatal("canonical metadata disagrees", metadata, want)
		}
	}
	// Chart's shape fits (created + id), but its capability remains an explicit requirement.
	frontPageExec(t, db, `INSERT INTO system_functions(id,name,url_route_endpoint,disabled,specific_table_related,ui_only)
	 VALUES(500001,'wl162_chart','/ui/view/price_chart',false,false,true);
	 INSERT INTO system_group_table_func_rights(user_group_id,function_id,target_table_uid) VALUES(2,500001,NULL);`)
	response := defaultViewTestRequest(t, db, 42, `{"dataset":"wl143_content","view_key":"price_chart"}`)
	if response.Code != 200 {
		t.Fatal(response.Code, response.Body.String())
	}
	frontPageExec(t, db, `DELETE FROM system_group_table_func_rights WHERE function_id=500001`)
	response = defaultViewTestRequest(t, db, 42, `{"dataset":"wl143_content","view_key":"price_chart"}`)
	if response.Code != 400 {
		t.Fatal("saved Chart bypassed its revoked capability", response.Body.String())
	}
}
