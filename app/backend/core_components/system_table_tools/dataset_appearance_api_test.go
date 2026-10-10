// dataset_appearance_api_test.go
// Verifies consistent read shape, translated refusals and immutable sparse values.
// Connects SQL queue fixtures with API response sources and optimistic revisions.
// Supplements PostgreSQL concurrency proofs without needing a database socket.
package system_table_tools

import (
	"database/sql/driver"
	"encoding/json"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	store "easelect/backend/core_components/dataset_appearance_store"
	appearance "easelect/frontend/shared/dataset_appearance"
)

func TestDatasetAppearanceSnapshotOneStatementAndAllSources(t *testing.T) {
	resetOrphanQueues()
	defer resetOrphanQueues()
	db := newSystemTableToolsTestDB(t)
	defer db.Close()
	shared := appearance.DefaultConfig()
	shared.Dark.ImageBlur = 7
	raw, _ := json.Marshal(store.SiteValuesFromConfig(shared))
	tab := appearance.Rules().DefaultsForPlace(appearance.TabOnly)
	tab["light.image_blur"] = 0
	tab["light.oval_enabled"] = false
	tab["dark.image_blur"] = 7
	tabRaw, _ := json.Marshal(tab)
	pushOrphanQuery(orphanQueuedQuery{cols: []string{"shared", "stamp", "schema", "tab_values", "overrides", "revision"}, rows: [][]driver.Value{{string(raw), "stamp-1", int64(2), tabRaw, []byte(`{"shared.card_detail_columns":2}`), "9"}}})
	snapshot, err := store.ReadAppearance(db, 42, false)
	if err != nil || snapshot.DatasetUID != 42 || snapshot.Version != "9" || snapshot.SharedVersion != store.SharedRevision(raw, "stamp-1") || snapshot.Effective.Light.ImageBlur != 0 || snapshot.Effective.Light.OvalEnabled || snapshot.Effective.Dark.ImageBlur != 7 || len(snapshot.Sources) != 44 {
		t.Fatal(snapshot, err)
	}
	if len(snapshotOrphanCalls()) != 1 || snapshot.Sources["light.image_blur"] != "tab" || snapshot.Sources["dark.image_blur"] != "tab" || snapshot.Sources["shared.card_detail_columns"] != "override" {
		t.Fatal(snapshot)
	}
}

// Exercise the PostgreSQL regression's expected settings through JSON and the
// real snapshot reader, without needing a socket. Every read must see the latest
// shared defaults/token while retaining the owned tab values, override and revision.
func TestDatasetAppearanceSnapshotReadsLatestSharedDefaultsAndRevision(t *testing.T) {
	resetOrphanQueues()
	defer resetOrphanQueues()
	db := newSystemTableToolsTestDB(t)
	defer db.Close()
	settings := defaultSitePresentationSettings()
	tab := appearance.Rules().DefaultsForPlace(appearance.TabOnly)
	tabRaw, _ := json.Marshal(tab)
	previousVersion := ""
	for index := 0; index < 5; index++ {
		setAppearanceResultsTestDefaults(settings, index)
		raw, err := json.Marshal(store.SiteAppearanceValues{SchemaVersion: 2, SiteValues: settings.SiteValues, Defaults: settings.Defaults})
		if err != nil {
			t.Fatal(err)
		}
		pushOrphanQuery(orphanQueuedQuery{cols: []string{"shared", "stamp", "schema", "tab_values", "overrides", "revision"}, rows: [][]driver.Value{{raw, "saved-stamp", int64(2), tabRaw, []byte(`{"shared.card_style_variant":"modern"}`), "9"}}})
		snapshot, err := store.ReadAppearanceForName(db, 42, "wl143_content", false)
		if err != nil {
			t.Fatal(err)
		}
		wire, err := json.Marshal(snapshot)
		if err != nil {
			t.Fatal(err)
		}
		var response store.AppearanceResponse
		if err := json.Unmarshal(wire, &response); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(response.SiteValues, settings.SiteValues) || !reflect.DeepEqual(response.Defaults, settings.Defaults) || response.Version != "9" {
			t.Fatalf("latest shared settings or dataset revision lost: defaults=%v want=%v revision=%s", response.Defaults, settings.Defaults, response.Version)
		}
		if response.SharedVersion != store.SharedRevision(raw, "saved-stamp") || response.SharedVersion == previousVersion {
			t.Fatal("shared revision did not follow the saved defaults", response.SharedVersion)
		}
		previousVersion = response.SharedVersion
		if !reflect.DeepEqual(response.TabValues, tab) || response.Overrides["shared.card_style_variant"] != "modern" || response.Sources["shared.card_style_variant"] != "override" || response.Effective.Shared.CardStyleVariant != "modern" {
			t.Fatal("shared defaults replaced owned values", response)
		}
		if len(snapshotOrphanCalls()) != index+1 {
			t.Fatal("snapshot read did not use one fresh statement per request")
		}
	}
}

func TestDatasetAppearanceHandlerRejectsMalformedAndMissingRevisions(t *testing.T) {
	for _, input := range []struct {
		body   string
		status int
		key    string
	}{
		{`null`, 400, "dataset_appearance_invalid"},
		{`{"dataset_uid":42,"unknown":1}`, 400, "dataset_appearance_invalid"},
		{`{"dataset_uid":42} trailing`, 400, "dataset_appearance_invalid"},
		{`{"dataset_uid":42}`, 400, "dataset_appearance_reload"},
		{`{"schema_version":2,"dataset_uid":42}`, 409, "dataset_appearance_conflict"},
	} {
		w := httptest.NewRecorder()
		AdminDatasetAppearanceHandler(w, httptest.NewRequest("POST", "/api/admin/dataset-appearance", strings.NewReader(input.body)))
		assertAppearanceHTTPRefusal(t, w, input.status, input.key)
	}
}
