// dataset_appearance_write_gate_postgres_test.go
// Proves publication-gate refusals preserve storage and valid saves preserve reads.
// Connects HTTP handlers, caller-owned transactions and authorized result requests.
// Uses only opt-in disposable PostgreSQL; never an installation database.
package system_table_tools

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	store "easelect/backend/core_components/dataset_appearance_store"
	read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
)

func readAppearanceWriteStorage(t *testing.T, db *sql.DB) string {
	t.Helper()
	var storage string
	// Include every row, revision and timestamp that these routes could touch.
	err := db.QueryRow(`SELECT jsonb_build_object(
 'shared', (SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.key),'[]'::jsonb) FROM system_config c),
 'overrides', (SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.table_uid),'[]'::jsonb) FROM system_dataset_appearance a),
 'datasets', (SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.table_uid),'[]'::jsonb) FROM system_db_tables d),
 'columns', (SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.column_uid),'[]'::jsonb) FROM system_column_details c)
 )::text`).Scan(&storage)
	if err != nil {
		t.Fatal(err)
	}
	return storage
}

func sharedAppearanceHTTPInput(t *testing.T, settings SitePresentationSettingsResponse) appearanceHTTPRefusalRequest {
	t.Helper()
	raw, err := json.Marshal(settings)
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatal(err)
	}
	return appearanceHTTPRefusalRequest{path: "/api/admin/site-presentation-settings", body: body, handler: AdminSitePresentationSettingsHandler}
}

func commitAppearanceHTTP(t *testing.T, db *sql.DB, input appearanceHTTPRefusalRequest) {
	t.Helper()
	w, lazy := invokeAppearanceHandler(t, db, input)
	if w.Code != http.StatusOK {
		t.Fatalf("save refused: %d %s", w.Code, w.Body.String())
	}
	if err := lazy.Commit(); err != nil {
		t.Fatal(err)
	}
}

func TestDatasetAppearancePostgresMaskHTTPRefusalLeavesStorageUnchanged(t *testing.T) {
	db, uid := datasetAppearanceFixture(t)
	for _, existing := range []bool{false, true} {
		if existing {
			if _, err := datasetAppearanceTestSave(db, uid, DatasetAppearancePatch{Set: map[string]any{"shared.card_style_variant": "standard"}}, "none"); err != nil {
				t.Fatal(err)
			}
		}
		current, err := store.ReadAppearance(db, uid, false)
		if err != nil {
			t.Fatal(err)
		}
		for _, patch := range []DatasetAppearancePatch{
			{Set: map[string]any{"light.center_opacity": 0.6, "shared.card_detail_columns": 4}},
			{Unset: []string{"light.center_opacity", "shared.card_style_variant"}},
		} {
			before := readAppearanceWriteStorage(t, db)
			input := appearanceHTTPRefusalRequest{path: "/api/admin/dataset-appearance", handler: AdminDatasetAppearanceHandler, body: map[string]any{
				"dataset_uid": uid, "set": patch.Set, "unset": patch.Unset,
				"shared_version": current.SharedVersion, "version": current.Version,
			}}
			w, lazy := invokeAppearanceHandler(t, db, input)
			assertAppearanceHTTPRefusal(t, w, http.StatusBadRequest, "dataset_appearance_invalid")
			if lazy.WasStarted() {
				t.Fatal("mask patch opened a transaction")
			}
			if err := lazy.Commit(); err != nil {
				t.Fatal(err)
			}
			if after := readAppearanceWriteStorage(t, db); after != before {
				t.Fatal("refused mask patch changed storage")
			}
		}
	}
}

func TestDatasetAppearancePostgresHTTPMissingAndEmptyRevisionsLeaveStorageUnchanged(t *testing.T) {
	db, uid := datasetAppearanceFixture(t)
	registerAppearanceTestColumns(t)
	var columnUID int
	if err := db.QueryRow(`SELECT column_uid FROM system_column_details WHERE table_uid=$1 AND column_name='id'`, uid).Scan(&columnUID); err != nil {
		t.Fatal(err)
	}
	for _, populated := range []bool{false, true} {
		if populated {
			settings, err := readSitePresentationSettingsFromDB()
			if err != nil {
				t.Fatal(err)
			}
			settings.DatasetCoverTheme.Light.ImageBlur = 8
			commitAppearanceHTTP(t, db, sharedAppearanceHTTPInput(t, settings))
			if _, err := datasetAppearanceTestSave(db, uid, DatasetAppearancePatch{Set: map[string]any{"shared.card_style_variant": "standard", "shared.card_detail_columns": 2}}, "none"); err != nil {
				t.Fatal(err)
			}
		}
		current, err := store.ReadAppearance(db, uid, false)
		if err != nil {
			t.Fatal(err)
		}
		for _, input := range appearanceRevisionRefusalRequests(t, uid, columnUID, current.SharedVersion, current.Version) {
			t.Run(input.name+map[bool]string{true: "/populated", false: "/absent"}[populated], func(t *testing.T) {
				before := readAppearanceWriteStorage(t, db)
				w, lazy := invokeAppearanceHandler(t, db, input)
				assertAppearanceHTTPRefusal(t, w, http.StatusConflict, "dataset_appearance_conflict")
				if lazy.WasStarted() {
					t.Fatal("missing revision opened a transaction")
				}
				// Committing even a refused request must leave all storage unchanged.
				if err := lazy.Commit(); err != nil {
					t.Fatal(err)
				}
				if after := readAppearanceWriteStorage(t, db); after != before {
					t.Fatal("revisionless HTTP refusal changed storage")
				}
			})
		}
	}
}

func TestDatasetAppearancePostgresCardOverridesKeepResultsReadableAfterValidSharedSaves(t *testing.T) {
	db, uid := datasetAppearanceFixture(t)
	registerAppearanceTestColumns(t)
	frontPageRuntimeDB(t, db)
	frontPageExec(t, db, `INSERT INTO wl143_content(id,title) VALUES(1,'Gate regression')`)
	choices := []map[string]any{{}}
	for _, style := range []string{"standard", "modern"} {
		choices = append(choices, map[string]any{"shared.card_style_variant": style})
		for columns := 1; columns <= 4; columns++ {
			choices = append(choices, map[string]any{"shared.card_style_variant": style, "shared.card_detail_columns": columns})
		}
	}
	for columns := 1; columns <= 4; columns++ {
		choices = append(choices, map[string]any{"shared.card_detail_columns": columns})
	}
	for _, overrides := range choices {
		current, err := store.ReadAppearance(db, uid, false)
		if err != nil {
			t.Fatal(err)
		}
		unset := []string{}
		for _, path := range []string{"shared.card_style_variant", "shared.card_detail_columns"} {
			if _, set := overrides[path]; !set {
				unset = append(unset, path)
			}
		}
		commitAppearanceHTTP(t, db, appearanceHTTPRefusalRequest{path: "/api/admin/dataset-appearance", handler: AdminDatasetAppearanceHandler, body: map[string]any{
			"dataset_uid": uid, "set": overrides, "unset": unset, "version": current.Version, "shared_version": current.SharedVersion,
		}})
		stored, err := ReadDatasetAppearance(db, uid, false)
		if err != nil {
			t.Fatal(err)
		}
		// Cover the gate's .7 -> .5 middle-opacity change, equal boundaries,
		// and simultaneous changes in both mask orders and both themes.
		for index, mask := range [][3]float64{{.4, .7, 1}, {.4, .5, 1}, {0, 0, 0}, {1, 1, 1}, {.8, .9, 1}} {
			settings, err := readSitePresentationSettingsFromDB()
			if err != nil {
				t.Fatal(err)
			}
			for _, theme := range []*DatasetCoverThemeValues{&settings.DatasetCoverTheme.Light, &settings.DatasetCoverTheme.Dark} {
				theme.CenterOpacity, theme.MidOpacity, theme.EdgeOpacity = mask[0], mask[1], mask[2]
				theme.CenterStop, theme.MidStop, theme.EdgeStop = mask[0]*100, mask[1]*100, mask[2]*100
			}
			settings.DatasetCoverTheme.Shared.CardDetailColumns = 1 + index%4
			settings.DatasetCoverTheme.Shared.CardStyleVariant = []string{"standard", "modern"}[index%2]
			if err := validateSitePresentationSettings(settings); err != nil {
				t.Fatal("invalid shared regression fixture", err)
			}
			commitAppearanceHTTP(t, db, sharedAppearanceHTTPInput(t, settings))
			after, err := ReadDatasetAppearance(db, uid, false)
			if err != nil || !reflect.DeepEqual(after, stored) {
				t.Fatal("shared save changed overrides or revision", after, err)
			}
			for _, role := range []string{"basic", "guest"} {
				w := httptest.NewRecorder()
				read.GetResults(w, frontPageSessionRequest(t, 42, role, "GET", "/api/get-results?dataset=wl143_content"))
				if w.Code != http.StatusOK {
					t.Fatalf("valid shared save made dataset unreadable: role=%s overrides=%v mask=%v status=%d body=%s", role, overrides, mask, w.Code, w.Body.String())
				}
				var response struct {
					Appearance store.AppearanceResponse `json:"dataset_appearance"`
				}
				if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil || !reflect.DeepEqual(response.Appearance.Overrides, stored.Overrides) || response.Appearance.Effective.Light.CenterOpacity != mask[0] || response.Appearance.Effective.Dark.MidOpacity != mask[1] {
					t.Fatal("results lost overrides or shared mask", response, err)
				}
				if response.Appearance.Shared != settings.DatasetCoverTheme || response.Appearance.Version != stored.Revision {
					t.Fatal("results returned stale shared settings or dataset revision", response)
				}
				for path, value := range stored.Overrides {
					if response.Appearance.Sources[path] != "override" ||
						(path == "shared.card_style_variant" && response.Appearance.Effective.Shared.CardStyleVariant != value) ||
						(path == "shared.card_detail_columns" && float64(response.Appearance.Effective.Shared.CardDetailColumns) != value) {
						t.Fatal("shared save replaced an effective card override", response)
					}
				}
			}
		}
	}
}
