// dataset_appearance_resolver.go
// Resolves sparse dataset overrides against the current shared appearance.
// Connects per-dataset persistence with the canonical browser/server definition.
// Preserves presence, including zero, false and explicit choices equal to shared values.
package system_table_tools

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	appearance "easelect/frontend/shared/dataset_appearance"
)

// ResolveDatasetAppearance returns independent effective values, validating every
// present canonical leaf and the complete merged mask ordering in both themes.
// The caller supplies current shared values; inherited values are never persisted.
func ResolveDatasetAppearance(shared DatasetCoverThemeConfig, overrides map[string]any, development bool) (DatasetCoverThemeConfig, error) {
	values, err := validatedDatasetAppearanceOverrides(overrides, development)
	if err != nil {
		return DatasetCoverThemeConfig{}, err
	}
	data, err := json.Marshal(shared)
	if err != nil {
		return DatasetCoverThemeConfig{}, err
	}
	var merged map[string]map[string]any
	if err := json.Unmarshal(data, &merged); err != nil {
		return DatasetCoverThemeConfig{}, err
	}
	for path, value := range values {
		owner, key, _ := strings.Cut(path, ".")
		merged[owner][key] = value
	}
	if err := appearance.Validate(merged, development); err != nil {
		return DatasetCoverThemeConfig{}, err
	}
	data, err = json.Marshal(merged)
	if err != nil {
		return DatasetCoverThemeConfig{}, err
	}
	var effective DatasetCoverThemeConfig
	err = json.Unmarshal(data, &effective)
	return effective, err
}

// JSON normalization gives integer Go inputs the same number representation as
// stored JSON and rejects non-finite numbers before they can reach PostgreSQL.
func validatedDatasetAppearanceOverrides(overrides map[string]any, development bool) (map[string]any, error) {
	values := map[string]any{}
	if overrides != nil {
		data, err := json.Marshal(overrides)
		if err != nil {
			return nil, err
		}
		if err := json.Unmarshal(data, &values); err != nil {
			return nil, err
		}
	}
	rules := appearance.Rules()
	paths := rules.CanonicalPaths()
	for path, value := range values {
		if !slices.Contains(paths, path) {
			return nil, fmt.Errorf("unknown canonical appearance path %s", path)
		}
		if err := rules.ValidateLeaf(path, value, development); err != nil {
			return nil, err
		}
	}
	return values, nil
}
