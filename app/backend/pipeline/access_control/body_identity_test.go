// body_identity_test.go
// Exercises the request-body boundary before dataset permissions reach handlers.
// Connects scripted route grants with JSON and multipart request identities.
// Prevents malformed bodies or an alternate media type from bypassing identity checks.
package access_control

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDatasetBodyValidationPrecedesHandler(t *testing.T) {
	for _, test := range []struct {
		name, contentType, body string
		status                  int
	}{
		{"plain text", "text/plain", `{"table":"private"}`, 400},
		{"missing type", "", `{"table":"private"}`, 400},
		{"lookalike type", "application/jsonp", `{"table":"private"}`, 400},
		{"wrong JSON type", "application/json", `{"table":1}`, 400},
		{"broken JSON", "application/json", `{"table":`, 400},
		{"valid JSON", "application/json; charset=utf-8", `{"table":"orders"}`, 200},
	} {
		t.Run(test.name, func(t *testing.T) {
			store := setupTestStore(t)
			setupMockDB(t, acMockConfig{specificRelated: true, permissionGranted: true})
			req := buildReq(t, store, http.MethodPost, "/api/modify-columns?dataset=orders", 42, strings.NewReader(test.body), test.contentType)
			rec := httptest.NewRecorder()
			called := false
			WithAccessControl("/api/modify-columns", "test", noopHandler(&called))(rec, req)
			if rec.Code != test.status || called != (test.status == 200) {
				t.Fatalf("status=%d handler=%t; want status=%d", rec.Code, called, test.status)
			}
		})
	}
}

func TestMultipartRouteIdentityOnlyFromQuery(t *testing.T) {
	// This is the sole dataset-scoped multipart route; router's inventory test
	// asserts completeness against every registered multipart parser.
	for _, contentType := range []string{"multipart/form-data; boundary=test", "application/json", "text/plain"} {
		for _, query := range []string{"?dataset=orders&table_uid=77", ""} {
			t.Run(contentType+query, func(t *testing.T) {
				store := setupTestStore(t)
				setupMockDB(t, acMockConfig{specificRelated: true, permissionGranted: true, tableIdentityMatches: true})
				body := `{"dataset":"private","dataset_uid":88}`
				req := buildReq(t, store, http.MethodPost, "/api/add-row-multipart"+query, 42, strings.NewReader(body), contentType)
				rec := httptest.NewRecorder()
				called := false
				WithAccessControl("/api/add-row-multipart", "test", func(w http.ResponseWriter, r *http.Request) {
					called = true
					got, _ := io.ReadAll(r.Body)
					if string(got) != body {
						t.Fatal("multipart body was changed")
					}
				})(rec, req)
				if query != "" && (!called || rec.Code != 200) {
					t.Fatalf("query identity refused: %d", rec.Code)
				}
				if query == "" && (called || rec.Code != 403) {
					t.Fatalf("body supplied multipart identity: %d", rec.Code)
				}
			})
		}
	}
}

func TestTableMoveQueryBodyMismatchForbiddenBeforeHandler(t *testing.T) {
	for _, query := range []string{"?dataset_uid=77", "?table_uid=77", "?dataset=orders"} {
		t.Run(query, func(t *testing.T) {
			store := setupTestStore(t)
			setupMockDB(t, acMockConfig{specificRelated: true, permissionGranted: true})
			req := buildReq(t, store, "POST", "/api/update-table-folder"+query, 42,
				strings.NewReader(`{"dataset_uid":88,"item_id":4,"item_type":"table","new_folder_id":10}`), "application/json")
			rec := httptest.NewRecorder()
			called := false
			WithAccessControl("/api/update-table-folder", "test", noopHandler(&called))(rec, req)
			if rec.Code != 403 || called {
				t.Fatalf("status=%d handler=%t", rec.Code, called)
			}
		})
	}
}

func TestBodyAndPathDatasetSweepMatchesCheckedIdentity(t *testing.T) {
	for _, field := range []string{"dataset_name", "table_name", "dataset", "table", "referencing_dataset", "referencing_table", "source_dataset"} {
		for _, dataset := range []string{"orders", "private"} {
			t.Run(field+"/"+dataset, func(t *testing.T) {
				req := httptest.NewRequest("POST", "/api/example?dataset=orders", strings.NewReader(`{"`+field+`":"`+dataset+`"}`))
				req.Header.Set("Content-Type", "application/json")
				name, _, err := extractRouteTableTarget(req, "/api/example")
				if dataset == "private" && err == nil {
					t.Fatal("body dataset differs from checked query")
				}
				if dataset == "orders" && (err != nil || name != "orders") {
					t.Fatalf("same dataset refused: %q %v", name, err)
				}
			})
		}
	}
	for _, dataset := range []string{"orders", "private"} {
		req := httptest.NewRequest("GET", "/api/dataset-columns/"+dataset+"?dataset=orders", nil)
		name, _, err := extractRouteTableTarget(req, "/api/dataset-columns/")
		if dataset == "private" && err == nil {
			t.Fatal("path dataset differs from checked query")
		}
		if dataset == "orders" && (err != nil || name != "orders") {
			t.Fatal("matching path refused")
		}
	}
}

func TestQueryOnlyJSONPayloadRoutesKeepMediaTypeBehavior(t *testing.T) {
	for _, route := range []string{"/api/update-row", "/api/delete-rows", "/api/geocode-address"} {
		for _, contentType := range []string{"text/plain", ""} {
			t.Run(route+"/"+contentType, func(t *testing.T) {
				store := setupTestStore(t)
				setupMockDB(t, acMockConfig{specificRelated: true, permissionGranted: true})
				body := `{"row_id":7,"column":"title","value":"updated"}`
				req := buildReq(t, store, "POST", route+"?dataset=orders", 42, strings.NewReader(body), contentType)
				rec := httptest.NewRecorder()
				called := false
				WithAccessControl(route, "test", func(w http.ResponseWriter, r *http.Request) {
					called = true
					got, _ := io.ReadAll(r.Body)
					if string(got) != body {
						t.Fatal("query-only payload changed")
					}
				})(rec, req)
				if rec.Code != 200 || !called {
					t.Fatalf("query-only route changed: status=%d handler=%t", rec.Code, called)
				}
			})
		}
	}
}
