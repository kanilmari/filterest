// dataset_appearance_resolver_test.go
// Proves complete owned tabs, nine sparse overrides and strict corruption checks.
// Connects definition inventories with stored snapshots and resolved projections.
package system_table_tools

import (
	store "easelect/backend/core_components/dataset_appearance_store"
	appearance "easelect/frontend/shared/dataset_appearance"
	"encoding/json"
	"testing"
)

func TestDatasetAppearanceAllCanonicalLeavesAndPresence(t *testing.T) {
	rules := appearance.Rules()
	site := appearance.DefaultConfig()
	tab := rules.DefaultsForPlace(appearance.TabOnly)
	overrides := rules.DefaultsForPlace(appearance.SiteDefault)
	tab["light.image_blur"] = 0
	tab["light.oval_enabled"] = false
	overrides["shared.card_show_all_fields"] = false
	overrides["shared.filterbar_content_top_space"] = 0
	site.Light.ImageBlur = 9
	site.Dark.ImageBlur = 12
	site.Shared.CardDetailColumns = 4
	result, err := ResolveDatasetAppearance(site, tab, overrides, false)
	if err != nil || result.Light.ImageBlur != 0 || result.Light.OvalEnabled || result.Dark.ImageBlur != 1 || result.Shared.CardShowAllFields || result.Shared.FilterbarContentTopSpace != 0 || result.Shared.CardDetailColumns != 2 {
		t.Fatal(result, err)
	}
	delete(overrides, "shared.card_detail_columns")
	result, err = ResolveDatasetAppearance(site, tab, overrides, false)
	if err != nil || result.Shared.CardDetailColumns != 4 || len(tab) != 28 || len(overrides) != 8 {
		t.Fatal(result, err)
	}
	for _, path := range rules.CanonicalPaths() {
		field, _ := rules.Field(path)
		_, err := ResolveDatasetAppearance(site, tab, map[string]any{path: field.Default}, false)
		if (err == nil) != (field.Place == appearance.SiteDefault) {
			t.Fatal(path, err)
		}
	}
}

func TestDatasetAppearanceMergedMaskOrders(t *testing.T) {
	for _, theme := range []string{"light", "dark"} {
		for key, value := range map[string]any{"center_opacity": .8, "mid_opacity": .3, "edge_opacity": .6, "center_stop": 60, "mid_stop": 90, "edge_stop": 50} {
			tab := appearance.Rules().DefaultsForPlace(appearance.TabOnly)
			tab[theme+"."+key] = value
			if _, err := ResolveDatasetAppearance(appearance.DefaultConfig(), tab, nil, false); err == nil {
				t.Fatal(theme, key)
			}
		}
	}
}

func TestDatasetAppearanceStoredSnapshotRejectsCorruption(t *testing.T) {
	valid := store.DefaultDatasetAppearanceSnapshot()
	raw, _ := json.Marshal(valid.TabValues)
	for _, tc := range []struct {
		version                  int
		tab, overrides, revision string
	}{
		{1, string(raw), "{}", "1"}, {2, "{}", "{}", "1"}, {2, "null", "{}", "1"}, {2, string(raw), "null", "1"},
		{2, string(raw), `{"shared.brand_color":"#abcdef"}`, "1"}, {2, string(raw), `{"light.image_blur":0}`, "1"},
		{2, string(raw), `{"shared.card_detail_columns":null}`, "1"}, {2, string(raw), "{}", "0"}, {2, string(raw), "{}", "none"},
	} {
		if _, err := decodeDatasetAppearanceSnapshot(tc.version, []byte(tc.tab), []byte(tc.overrides), tc.revision, false); err == nil {
			t.Fatal(tc)
		}
	}
}

func TestDatasetAppearanceStoredDevelopmentLayoutIsPortable(t *testing.T) {
	site := store.DefaultSiteAppearanceValues()
	site.Defaults["shared.label_value_layout"] = "auto"
	raw, _ := json.Marshal(site)
	tab, _ := json.Marshal(store.DefaultDatasetAppearanceSnapshot().TabValues)
	for _, development := range []bool{false, true} {
		want := "stacked"
		if development {
			want = "auto"
		}
		config, err := store.DecodeSiteAppearance(raw, development)
		if err != nil || config.Shared.LabelValueLayout != want {
			t.Fatal(config, err)
		}
		snapshot, err := decodeDatasetAppearanceSnapshot(2, tab, []byte(`{"shared.label_value_layout":"auto"}`), "1", development)
		if err != nil || snapshot.Overrides["shared.label_value_layout"] != want {
			t.Fatal(snapshot, err)
		}
		if !development {
			_, err = store.SaveDatasetAppearance(nil, 1, store.DatasetAppearancePatch{Set: map[string]any{"shared.label_value_layout": "auto"}}, "1", "1", false)
			if err == nil {
				t.Fatal("production write accepted development layout")
			}
		}
	}
}
