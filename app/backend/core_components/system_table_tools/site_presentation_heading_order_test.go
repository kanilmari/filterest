// site_presentation_heading_order_test.go
// Proves the category heading preference uses the existing strict site patch.
// Connects typed defaults, legacy stored reads and the revision-protected writer.
// Keeps manual storage readable by older binaries while responses stay complete.
package system_table_tools

import (
	store "easelect/backend/core_components/dataset_appearance_store"
	"easelect/backend/core_components/dbutils"
	appearance "easelect/frontend/shared/dataset_appearance"
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestSitePresentationHeadingOrderPatchContract(t *testing.T) {
	for _, value := range []any{"manual", "result_count"} {
		assertSitePatchValue(t, "shared.row_group_heading_order", value, true)
	}
	for _, value := range []any{nil, 7, true, "count", "", "RESULT_COUNT"} {
		assertSitePatchValue(t, "shared.row_group_heading_order", value, false)
	}
}

func TestSitePresentationHeadingOrderPersistencePostgres(t *testing.T) {
	db := sitePresentationDisposableDB(t)
	save := func(version string, values map[string]any) (SitePresentationSettingsResponse, error) {
		lazy := dbutils.NewLazyTx(db)
		defer lazy.Rollback()
		request := httptest.NewRequest("POST", "/", nil)
		result, err := persistSitePresentationSettings(request.WithContext(dbutils.SetLazyTx(request.Context(), lazy)),
			SitePresentationSettingsPatch{SchemaVersion: 2, Version: version, Set: values})
		if err == nil {
			err = lazy.Commit()
		}
		return result, err
	}
	initial, err := readSitePresentationSettingsWith(db)
	if err != nil || initial.SiteValues["shared.row_group_heading_order"] != "manual" {
		t.Fatal(initial, err)
	}
	saved, err := save(initial.Version, map[string]any{"shared.row_group_heading_order": "result_count"})
	if err != nil || saved.SiteValues["shared.row_group_heading_order"] != "result_count" {
		t.Fatal(saved, err)
	}
	_, err = save(initial.Version, map[string]any{"shared.row_group_heading_order": "manual"})
	assertDatasetAppearanceRefusal(t, err, 409)
	preserved, err := save(saved.Version, map[string]any{"shared.active_filter_remove_side": "end"})
	if err != nil || preserved.SiteValues["shared.row_group_heading_order"] != "result_count" {
		t.Fatal(preserved, err)
	}
	restored, err := save(preserved.Version, map[string]any{"shared.row_group_heading_order": "manual"})
	if err != nil || restored.SiteValues["shared.row_group_heading_order"] != "manual" || restored.SiteValues["shared.active_filter_remove_side"] != "end" {
		t.Fatal(restored, err)
	}
	assertStoredHeadingOrder := func(expected string) {
		t.Helper()
		var value *string
		var present bool
		if err := db.QueryRow(`SELECT json_value->'site_values'->>'shared.row_group_heading_order',
 json_value->'site_values' ? 'shared.row_group_heading_order'
 FROM system_config WHERE key='dataset_cover_theme_config'`).Scan(&value, &present); err != nil {
			t.Fatal(err)
		}
		if expected == "" && present || expected != "" && (!present || value == nil || *value != expected) {
			t.Fatalf("stored heading preference: %v, expected %q (empty means absent)", value, expected)
		}
	}
	assertStoredHeadingOrder("")
	read, err := readSitePresentationSettingsWith(db)
	if err != nil || read.SiteValues["shared.row_group_heading_order"] != "manual" {
		t.Fatal(read, err)
	}
	unchanged, err := save(read.Version, sitePresentationPatchFromSettings(read).Set)
	if err != nil || unchanged.SiteValues["shared.row_group_heading_order"] != "manual" {
		t.Fatal(unchanged, err)
	}
	assertStoredHeadingOrder("")
	_, err = save(unchanged.Version, map[string]any{"shared.row_group_heading_order": "result_count"})
	if err != nil {
		t.Fatal(err)
	}
	assertStoredHeadingOrder("result_count")
}

func TestSitePresentationHeadingOrderAbsentDefault(t *testing.T) {
	values := store.DefaultSiteAppearanceValues()
	delete(values.SiteValues, "shared.row_group_heading_order")
	values.SiteValues["shared.active_filter_remove_side"] = "end"
	raw, err := json.Marshal(values)
	if err != nil {
		t.Fatal(err)
	}
	config, err := store.DecodeSiteAppearance(raw, false)
	if err != nil || config.Shared.RowGroupHeadingOrder != "manual" || config.Shared.ActiveFilterRemoveSide != "end" {
		t.Fatalf("old site choice changed: %+v, %v", config.Shared, err)
	}
	if appearance.NormalizeStoredConfig(`{}`, false).Shared.RowGroupHeadingOrder != "manual" {
		t.Fatal("legacy absent value did not read as manual")
	}
}
