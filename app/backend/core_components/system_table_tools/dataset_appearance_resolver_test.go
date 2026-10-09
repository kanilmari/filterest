// dataset_appearance_resolver_test.go
// Proves canonical sparse leaves, presence semantics and merged mask validation.
// Connects the slice 1 definition with the internal slice 2 resolver.
// Keeps inheritance dynamic and rejects aliases, null and invalid complete results.
package system_table_tools

import (
	"math"
	"reflect"
	"testing"

	appearance "easelect/frontend/shared/dataset_appearance"
)

func TestDatasetAppearanceAllCanonicalLeavesAndPresence(t *testing.T) {
	shared := defaultSitePresentationSettings().DatasetCoverTheme
	defaults := appearance.Rules().Defaults()
	values := map[string]any{}
	for _, path := range appearance.Rules().CanonicalPaths() {
		field, _ := appearance.Rules().Field(path)
		values[path] = field.Default
	}
	if len(values) != 44 {
		t.Fatal("canonical inventory changed", len(values))
	}
	all, err := ResolveDatasetAppearance(shared, values, false)
	if err != nil || !reflect.DeepEqual(all, shared) {
		t.Fatal("canonical default overrides", err)
	}
	values = map[string]any{"light.image_blur": 0, "light.oval_enabled": false, "shared.card_detail_columns": 2}
	effective, err := ResolveDatasetAppearance(shared, values, false)
	if err != nil || effective.Light.ImageBlur != 0 || effective.Light.OvalEnabled || effective.Shared.CardDetailColumns != 2 {
		t.Fatal("presence lost", effective, err)
	}
	shared.Light.ImageBlur = 9
	shared.Dark.ImageBlur = 12
	shared.Shared.CardDetailColumns = 4
	effective, err = ResolveDatasetAppearance(shared, values, false)
	if err != nil || effective.Light.ImageBlur != 0 || effective.Dark.ImageBlur != 12 || effective.Shared.CardDetailColumns != 2 {
		t.Fatal("override/inheritance changed", effective, err)
	}
	delete(values, "shared.card_detail_columns")
	effective, err = ResolveDatasetAppearance(shared, values, false)
	if err != nil || effective.Shared.CardDetailColumns != 4 || shared.Light.ImageBlur != 9 || len(values) != 2 || defaults["light"]["image_blur"] != float64(1) {
		t.Fatal("resolution changed inputs or removal failed", err)
	}
}

func TestDatasetAppearanceInvalidLeaves(t *testing.T) {
	for _, tc := range []struct {
		name, path string
		value      any
	}{
		{"null", "light.image_blur", nil}, {"string number", "light.image_blur", "0"},
		{"boolean number", "light.image_blur", false}, {"numeric boolean", "light.oval_enabled", 0},
		{"unknown", "light.extra", 0}, {"alias", "light.show_cover_photo", false},
		{"derived", "shared.image_blur", 0}, {"unknown theme", "sepia.image_blur", 0},
		{"below bound", "light.image_blur", -1}, {"above bound", "light.image_blur", 25},
		{"fractional integer", "shared.card_detail_columns", 2.5}, {"enum", "shared.card_style_variant", "wide"},
		{"nested", "light.image_blur", map[string]any{"value": 1}}, {"colour", "shared.brand_color", "red"},
		{"nan", "light.image_blur", math.NaN()}, {"infinity", "light.image_blur", math.Inf(1)},
		{"production layout", "shared.label_value_layout", "auto"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := ResolveDatasetAppearance(defaultSitePresentationSettings().DatasetCoverTheme, map[string]any{tc.path: tc.value}, false); err == nil {
				t.Fatal("invalid leaf accepted")
			}
		})
	}
	for _, values := range []map[string]any{{"light.image_blur": 1.25}, {"shared.label_value_layout": "auto"}} {
		if _, err := ResolveDatasetAppearance(defaultSitePresentationSettings().DatasetCoverTheme, values, true); err != nil {
			t.Fatal("valid off-step/development value refused", err)
		}
	}
}

func TestDatasetAppearanceMergedMaskOrders(t *testing.T) {
	for _, theme := range []string{"light", "dark"} {
		for _, tc := range []struct {
			key   string
			value float64
		}{
			{"center_opacity", .8}, {"mid_opacity", .3}, {"edge_opacity", .6},
			{"center_stop", 60}, {"mid_stop", 90}, {"edge_stop", 50},
		} {
			t.Run(theme+"."+tc.key, func(t *testing.T) {
				if _, err := ResolveDatasetAppearance(defaultSitePresentationSettings().DatasetCoverTheme, map[string]any{theme + "." + tc.key: tc.value}, false); err == nil {
					t.Fatal("invalid inherited mask ordering accepted")
				}
			})
		}
		values := map[string]any{theme + ".center_opacity": .8, theme + ".mid_opacity": .8, theme + ".edge_opacity": .8,
			theme + ".center_stop": 60, theme + ".mid_stop": 60, theme + ".edge_stop": 60}
		if _, err := ResolveDatasetAppearance(defaultSitePresentationSettings().DatasetCoverTheme, values, false); err != nil {
			t.Fatal("equal ascending triple refused", err)
		}
	}
	shared := defaultSitePresentationSettings().DatasetCoverTheme
	shared.Dark.MidStop = 99
	if _, err := ResolveDatasetAppearance(shared, nil, false); err == nil {
		t.Fatal("invalid complete shared result accepted")
	}
}

func TestDatasetAppearanceStoredSnapshotRejectsCorruption(t *testing.T) {
	for _, tc := range []struct {
		version       int
		raw, revision string
	}{{2, `{}`, "1"}, {1, `null`, "1"}, {1, `[]`, "1"}, {1, `{"light.image_blur":null}`, "1"},
		{1, `{"shared.image_blur":1}`, "1"}, {1, `{}`, "none"}, {1, `{}`, "0"}} {
		if _, err := decodeDatasetAppearanceSnapshot(tc.version, []byte(tc.raw), tc.revision, false); err == nil {
			t.Fatal("corrupt stored snapshot accepted", tc)
		}
	}
}
