// site_presentation_revision_test.go
// Supplies loaded revisions and checks revisionless legacy save refusals.
// Connects the existing shared-settings regressions to the revision-protected writer.
// Compares persisted values and update stamps so refused saves cannot change storage.
package system_table_tools

import (
	"database/sql"
	store "easelect/backend/core_components/dataset_appearance_store"
	appearance "easelect/frontend/shared/dataset_appearance"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"easelect/backend/core_components/dbutils"
)

func sitePresentationTestInputWithLoadedRevision(t *testing.T, input SitePresentationSettingsPatch) SitePresentationSettingsPatch {
	t.Helper()
	stored, err := readSitePresentationSettingsFromDB()
	if err != nil {
		t.Fatal(err)
	}
	input.Version = stored.Version
	return input
}

func assertRevisionlessSitePresentationSaveRefused(t *testing.T, db *sql.DB, input SitePresentationSettingsPatch) {
	t.Helper()
	readStorage := func() string {
		t.Helper()
		var stored string
		if err := db.QueryRow(`SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.key),'[]'::jsonb)::text
 FROM public.system_config c`).Scan(&stored); err != nil {
			t.Fatal(err)
		}
		return stored
	}
	before := readStorage()
	input.Version = ""
	lazy := dbutils.NewLazyTx(db)
	defer lazy.Rollback()
	r := httptest.NewRequest(http.MethodPost, "/api/admin/site-presentation-settings", nil)
	_, err := persistSitePresentationSettings(r.WithContext(dbutils.SetLazyTx(r.Context(), lazy)), input)
	assertDatasetAppearanceRefusal(t, err, http.StatusConflict)
	// Even committing the refused writer's transaction must leave every row unchanged.
	if err := lazy.Commit(); err != nil {
		t.Fatal(err)
	}
	if after := readStorage(); after != before {
		t.Fatalf("revisionless save changed stored configuration: before=%s after=%s", before, after)
	}
}

// Explicit test adapter for revision-based patch tests; production never accepts
// the old whole-object request contract.
func sitePresentationPatchFromSettings(settings SitePresentationSettingsResponse) SitePresentationSettingsPatch {
	set := map[string]any{}
	for path, value := range settings.SiteValues {
		set[path] = value
	}
	for path, value := range settings.Defaults {
		set[path] = value
	}
	return SitePresentationSettingsPatch{SchemaVersion: 2, Version: settings.Version, Set: set}
}
func siteConfigForTest(t *testing.T, settings SitePresentationSettingsResponse) appearance.DatasetCoverThemeConfig {
	t.Helper()
	raw, _ := json.Marshal(settings)
	var value map[string]any
	_ = json.Unmarshal(raw, &value)
	delete(value, "version")
	delete(value, "row_article_timestamp_display_mode")
	raw, _ = json.Marshal(value)
	config, err := store.DecodeSiteAppearance(raw, false)
	if err != nil {
		t.Fatal(err)
	}
	return config
}
