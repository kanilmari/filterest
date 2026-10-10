// dataset_appearance_normalization_test.go
// Answers the migration's shared fixture through the existing Go normalizer.
// Python checks those same expected values in PostgreSQL, including legacy blur.
package system_table_tools

import (
	store "easelect/backend/core_components/dataset_appearance_store"
	appearance "easelect/frontend/shared/dataset_appearance"
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

func TestDatasetAppearanceMigrationNormalizationFixtures(t *testing.T) {
	data, err := os.ReadFile("../../../testing/shared_contracts/dataset_appearance_migration_v2.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Cases []struct {
			Name        string
			Development bool
			Raw         json.RawMessage
			Normalized  map[string]any
		}
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	for _, tc := range fixture.Cases {
		t.Run(tc.Name, func(t *testing.T) {
			config := appearance.NormalizeStoredConfig(string(tc.Raw), tc.Development)
			want := map[string]any{}
			got := map[string]any{}
			for _, place := range []appearance.Place{appearance.TabOnly, appearance.SiteOnly, appearance.SiteDefault} {
				for path, value := range appearance.Rules().DefaultsForPlace(place) {
					want[path] = value
				}
				for path, value := range store.ValuesForPlace(config, place) {
					got[path] = value
				}
			}
			for path, value := range tc.Normalized {
				want[path] = value
			}
			if !reflect.DeepEqual(got, want) {
				t.Fatal(got, want)
			}
		})
	}
}
