// dataset_appearance_resolver.go
// Resolves the three owned places into the nested renderer projection.
// Connects complete tab storage and public site defaults with sparse overrides.
// Preserves explicit zero, false and equality and validates masks within each tab.
package dataset_appearance_store

import (
	"encoding/json"
	"strings"

	appearance "easelect/frontend/shared/dataset_appearance"
)

// ResolveDatasetAppearance has no shared cover inheritance: tab values are complete.
// The nested config is only a renderer projection, never another storage authority.
func ResolveDatasetAppearance(site appearance.DatasetCoverThemeConfig, tabValues, overrides map[string]any, development bool) (appearance.DatasetCoverThemeConfig, error) {
	if err := appearance.ValidateTabValuesV2(tabValues, development); err != nil {
		return appearance.DatasetCoverThemeConfig{}, err
	}
	values, err := validatedDatasetAppearanceOverrides(overrides, development)
	if err != nil {
		return appearance.DatasetCoverThemeConfig{}, err
	}
	merged := appearance.Rules().Defaults()
	for _, group := range []map[string]any{ValuesForPlace(site, appearance.SiteOnly), ValuesForPlace(site, appearance.SiteDefault), tabValues, values} {
		for path, value := range group {
			owner, key, _ := strings.Cut(path, ".")
			merged[owner][key] = value
		}
	}
	// Legacy shared blur is derived from the owning tab's light theme.
	merged["shared"]["image_blur"] = merged["light"]["image_blur"]
	if err := appearance.Validate(merged, development); err != nil {
		return appearance.DatasetCoverThemeConfig{}, err
	}
	data, err := json.Marshal(merged)
	if err != nil {
		return appearance.DatasetCoverThemeConfig{}, err
	}
	var effective appearance.DatasetCoverThemeConfig
	err = json.Unmarshal(data, &effective)
	return effective, err
}

// ValuesForPlace projects canonical flat maps using the shared definition inventory.
func ValuesForPlace(config appearance.DatasetCoverThemeConfig, place appearance.Place) map[string]any {
	data, _ := json.Marshal(config)
	var nested map[string]map[string]any
	_ = json.Unmarshal(data, &nested)
	values := map[string]any{}
	for _, path := range appearance.Rules().PathsForPlace(place) {
		owner, key, _ := strings.Cut(path, ".")
		values[path] = nested[owner][key]
	}
	return values
}

func normalizedValues(values map[string]any) (map[string]any, error) {
	data, err := json.Marshal(values)
	if err != nil {
		return nil, err
	}
	result := map[string]any{}
	if values != nil {
		err = json.Unmarshal(data, &result)
	}
	return result, err
}

func validatedDatasetAppearanceOverrides(overrides map[string]any, development bool) (map[string]any, error) {
	values, err := normalizedValues(overrides)
	if err != nil {
		return nil, err
	}
	if err := appearance.ValidateOverridesV2(values, development); err != nil {
		return nil, err
	}
	return values, nil
}
