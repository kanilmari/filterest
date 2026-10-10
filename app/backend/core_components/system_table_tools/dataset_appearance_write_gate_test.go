// dataset_appearance_write_gate_test.go
// Proves slice 3a's leaf gate and missing-revision HTTP refusal contract.
// Connects administrator/shared/compatibility handlers with the lazy transaction boundary.
// Checks translated status codes and zero storage work without PostgreSQL sockets.
package system_table_tools

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	store "easelect/backend/core_components/dataset_appearance_store"
	"easelect/backend/core_components/dbutils"
	appearance "easelect/frontend/shared/dataset_appearance"
)

type appearanceHTTPRefusalRequest struct {
	name    string
	path    string
	body    map[string]any
	handler http.HandlerFunc
}

func appearanceRevisionRefusalRequests(t *testing.T, uid, columnUID int, sharedVersion, version string) []appearanceHTTPRefusalRequest {
	t.Helper()
	sharedBody := map[string]any{"schema_version": 2, "version": sharedVersion, "set": map[string]any{}}
	requests := []appearanceHTTPRefusalRequest{}
	for _, endpoint := range []struct {
		name    string
		path    string
		body    map[string]any
		keys    []string
		handler http.HandlerFunc
	}{
		{"shared", "/api/admin/site-presentation-settings", sharedBody, []string{"version"}, AdminSitePresentationSettingsHandler},
		{"administrator", "/api/admin/dataset-appearance", map[string]any{
			"schema_version": 2, "dataset_uid": uid, "set": map[string]any{"shared.card_detail_columns": 3},
			"shared_version": sharedVersion, "version": version,
		}, []string{"shared_version", "version"}, AdminDatasetAppearanceHandler},
		{"scoped compatibility", "/api/card-visibility/update", map[string]any{
			"scope": "dataset_presentation", "table_name": "wl143_content", "card_style_variant": nil,
			"card_detail_columns": 3, "shared_version": sharedVersion, "version": version,
		}, []string{"shared_version", "version"}, UpdateCardVisibilityHandler},
		{"full compatibility", "/api/card-visibility/update", map[string]any{
			"table_name": "wl143_content", "card_style_variant": nil, "card_detail_columns": 3,
			"columns":        []map[string]any{{"column_uid": columnUID, "client_delivery_mode": "include"}},
			"shared_version": sharedVersion, "version": version,
		}, []string{"shared_version", "version"}, UpdateCardVisibilityHandler},
	} {
		for _, key := range endpoint.keys {
			for _, omitted := range []bool{true, false} {
				body := map[string]any{}
				for name, value := range endpoint.body {
					body[name] = value
				}
				kind := "empty"
				body[key] = ""
				if omitted {
					kind = "omitted"
					delete(body, key)
				}
				requests = append(requests, appearanceHTTPRefusalRequest{endpoint.name + "/" + key + "/" + kind, endpoint.path, body, endpoint.handler})
			}
		}
	}
	return requests
}

func assertAppearanceHTTPRefusal(t *testing.T, response *httptest.ResponseRecorder, status int, key string) {
	t.Helper()
	var body struct {
		ErrorLangKey string `json:"error_lang_key"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil || response.Code != status || body.ErrorLangKey != key {
		t.Fatalf("expected translated %d %s: status=%d body=%s err=%v", status, key, response.Code, response.Body.String(), err)
	}
}

func invokeAppearanceHandler(t *testing.T, db *sql.DB, input appearanceHTTPRefusalRequest) (*httptest.ResponseRecorder, *dbutils.LazyTx) {
	t.Helper()
	body, err := json.Marshal(input.body)
	if err != nil {
		t.Fatal(err)
	}
	lazy := dbutils.NewLazyTx(db)
	t.Cleanup(func() { lazy.Rollback() })
	r := httptest.NewRequest(http.MethodPost, input.path, strings.NewReader(string(body)))
	w := httptest.NewRecorder()
	input.handler(w, r.WithContext(dbutils.SetLazyTx(r.Context(), lazy)))
	return w, lazy
}

func TestDatasetAppearanceHandlersMissingAndEmptyRevisionsBeforeTransaction(t *testing.T) {
	resetOrphanQueues()
	defer resetOrphanQueues()
	db := newSystemTableToolsTestDB(t)
	defer db.Close()
	for _, input := range appearanceRevisionRefusalRequests(t, 42, 1, "loaded-shared", "loaded-dataset") {
		t.Run(input.name, func(t *testing.T) {
			response, lazy := invokeAppearanceHandler(t, db, input)
			assertAppearanceHTTPRefusal(t, response, http.StatusConflict, "dataset_appearance_conflict")
			if lazy.WasStarted() || len(snapshotOrphanCalls()) != 0 {
				t.Fatal("revisionless HTTP request reached storage")
			}
		})
	}
}

func TestDatasetAppearanceHandlerAndAllWritersRefuseUnmigratedLeavesBeforeTransaction(t *testing.T) {
	resetOrphanQueues()
	defer resetOrphanQueues()
	db := newSystemTableToolsTestDB(t)
	defer db.Close()
	rules := appearance.Rules()
	for _, path := range rules.CanonicalPaths() {
		if place, _ := rules.PlaceForPath(path); place == appearance.SiteDefault {
			continue
		}
		owner, key, _ := strings.Cut(path, ".")
		value := rules.ThemeFields[key].Default
		if owner == "shared" {
			value = rules.SharedFields[key].Default
		}
		if path == "light.center_opacity" {
			value = 0.6 // The gate's otherwise-valid initial mask override.
		}
		for _, patch := range []DatasetAppearancePatch{
			{Set: map[string]any{"shared.card_detail_columns": 3, path: value}},
			{Unset: []string{path}},
		} {
			t.Run(path+map[bool]string{true: "/set", false: "/unset"}[patch.Set != nil], func(t *testing.T) {
				input := appearanceHTTPRefusalRequest{path: "/api/admin/dataset-appearance", handler: AdminDatasetAppearanceHandler, body: map[string]any{
					"schema_version": 2, "dataset_uid": 42, "set": patch.Set, "unset": patch.Unset, "shared_version": "none", "version": "none",
				}}
				response, lazy := invokeAppearanceHandler(t, db, input)
				assertAppearanceHTTPRefusal(t, response, http.StatusBadRequest, "dataset_appearance_invalid")
				// This shared saver is also used by compatibility and generic writers.
				_, err := store.SaveDatasetAppearance(nil, 42, patch, "none", "none", false)
				assertDatasetAppearanceRefusal(t, err, http.StatusBadRequest)
				if lazy.WasStarted() || len(snapshotOrphanCalls()) != 0 {
					t.Fatal("unmigrated leaf reached transaction work")
				}
			})
		}
	}
}

func TestSharedAppearanceHandlerMalformedBodiesRemainBadRequests(t *testing.T) {
	for _, body := range []string{`null`, `{}`, `[]`, `{"schema_version":2,"set":{}} {}`, `{"schema_version":2,"set":{"light.center_opacity":0.9}}`, `{"dataset_cover_theme":{}}`} {
		w := httptest.NewRecorder()
		AdminSitePresentationSettingsHandler(w, httptest.NewRequest(http.MethodPost, "/api/admin/site-presentation-settings", strings.NewReader(body)))
		key := "dataset_appearance_invalid"
		if body == `{}` || body == `{"dataset_cover_theme":{}}` {
			key = "dataset_appearance_reload"
		}
		assertAppearanceHTTPRefusal(t, w, http.StatusBadRequest, key)
	}
}

func TestCardAdaptersRefuseSiteOnlyPathsBeforeTransaction(t *testing.T) {
	for _, path := range appearance.Rules().PathsForPlace(appearance.SiteOnly) {
		_, key, _ := strings.Cut(path, ".")
		field, _ := appearance.Rules().Field(path)
		for _, name := range []string{path, key} {
			for _, scope := range []bool{false, true} {
				body := map[string]any{"table_name": "fixture", "columns": []map[string]any{{"column_uid": 1}}, "card_style_variant": "modern", "shared_version": "loaded", "version": "1", name: field.Default}
				if scope {
					body["scope"] = "dataset_presentation"
					delete(body, "columns")
				}
				raw, _ := json.Marshal(body)
				w := httptest.NewRecorder()
				UpdateCardVisibilityHandler(w, httptest.NewRequest(http.MethodPost, "/api/card-visibility/update", strings.NewReader(string(raw))))
				assertAppearanceHTTPRefusal(t, w, 400, "dataset_appearance_invalid")
			}
		}
	}
}
