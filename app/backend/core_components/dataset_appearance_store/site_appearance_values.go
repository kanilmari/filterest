// site_appearance_values.go
// Reads only the two site-owned places after the storage cutover.
// Connects the public protocol and snapshot store with strict version-two maps.
// Definition defaults serve absent storage; malformed saved values are errors.
package dataset_appearance_store

import (
	"encoding/json"
	"fmt"
	"strings"

	appearance "easelect/frontend/shared/dataset_appearance"
)

// SiteAppearanceValues is the active site storage contract: no dataset covers.
type SiteAppearanceValues struct {
	SchemaVersion int            `json:"schema_version"`
	SiteValues    map[string]any `json:"site_values"`
	Defaults      map[string]any `json:"defaults"`
}

func DefaultSiteAppearanceValues() SiteAppearanceValues {
	rules := appearance.Rules()
	return SiteAppearanceValues{2, rules.DefaultsForPlace(appearance.SiteOnly), rules.DefaultsForPlace(appearance.SiteDefault)}
}

func SiteValuesFromConfig(config appearance.DatasetCoverThemeConfig) SiteAppearanceValues {
	return SiteAppearanceValues{2, ValuesForPlace(config, appearance.SiteOnly), ValuesForPlace(config, appearance.SiteDefault)}
}

// DecodeSiteAppearance keeps the nested type internal for existing renderer adapters.
func DecodeSiteAppearance(raw []byte, development bool) (appearance.DatasetCoverThemeConfig, error) {
	values := DefaultSiteAppearanceValues()
	if len(raw) != 0 {
		if err := json.Unmarshal(raw, &values); err != nil {
			return appearance.DatasetCoverThemeConfig{}, err
		}
		var keys map[string]json.RawMessage
		if err := json.Unmarshal(raw, &keys); err != nil || len(keys) != 3 || keys["site_values"] == nil || keys["defaults"] == nil || keys["schema_version"] == nil {
			return appearance.DatasetCoverThemeConfig{}, fmt.Errorf("site appearance requires version-two site_values and defaults; reload")
		}
	}
	if values.SchemaVersion != 2 {
		return appearance.DatasetCoverThemeConfig{}, fmt.Errorf("unsupported site appearance schema")
	}
	if err := appearance.ValidateSiteValuesV2(values.SiteValues, development); err != nil {
		return appearance.DatasetCoverThemeConfig{}, err
	}
	// Stored development-only layout remains portable across environments.
	// Production reads use the existing stacked fallback; writes stay strict.
	if err := appearance.ValidateDefaultsV2(values.Defaults, true); err != nil {
		return appearance.DatasetCoverThemeConfig{}, err
	}
	normalizeStoredLayout(values.Defaults, development)
	nested := appearance.Rules().Defaults()
	for _, group := range []map[string]any{values.SiteValues, values.Defaults} {
		for path, value := range group {
			owner, key, _ := strings.Cut(path, ".")
			nested[owner][key] = value
		}
	}
	data, err := json.Marshal(nested)
	if err != nil {
		return appearance.DatasetCoverThemeConfig{}, err
	}
	var config appearance.DatasetCoverThemeConfig
	err = json.Unmarshal(data, &config)
	return config, err
}

func normalizeStoredLayout(values map[string]any, development bool) {
	if !development && values["shared.label_value_layout"] == "auto" {
		values["shared.label_value_layout"] = appearance.Rules().SharedFields["label_value_layout"].Default
	}
}
