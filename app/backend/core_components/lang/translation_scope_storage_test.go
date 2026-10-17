// translation_scope_storage_test.go
// Separates storage provenance from the domain objects a translation labels.
// Exercises real filtering with scanner-shaped sources and the shared key names.
// Keeps offline regressions independent of the opt-in bootstrap PostgreSQL proof.
package lang

import (
	"context"
	"database/sql/driver"
	"testing"

	"easelect/backend/core_components/lang_key_naming"
)

func TestTranslationStorageReferencesDoNotOwnLabels(t *testing.T) {
	for _, storage := range []string{
		"system_lang_keys", "system_lang_keys_archive", "system_lang_key_sources",
		"system_lang_key_translations", "system_lang_key_types", "system_languages",
	} {
		t.Run(storage, func(t *testing.T) {
			installTranslationDB(t, []queuedCleanupQuery{{
				cols: []string{"key", "type", "dataset", "uid", "visible"},
				rows: [][]driver.Value{
					{"login", "foreign_key", storage, int64(90), true},
					{"reader_label", "foreign_key", storage, int64(90), true},
					{"reader_label", "column", "app_reader", int64(11), true},
					{"private_label", "foreign_key", storage, int64(90), true},
					{"private_label", "foreign_key", "app_private", int64(22), true},
					{"shared_label", "foreign_key", "app_reader", int64(11), true},
					{"shared_label", "foreign_key", "app_private", int64(22), true},
					{"unknown_label", "foreign_key", "system_lang_domain_fixture", int64(23), true},
					{"storage_column_label", "column", storage, int64(90), true},
					{"retired_label", "foreign_key", storage, int64(90), true},
					{"retired_label", "unresolved", "", int64(0), false},
					{"reader_label", "unresolved", "", int64(0), false},
				},
			}})
			values := map[string]string{
				"login": "Login", "reader_label": "Reader", "private_label": "Private",
				"shared_label": "Shared", "unknown_label": "Unknown",
				"storage_column_label": "Storage field", "retired_label": "Retired",
			}
			filtered, err := filterTranslationMap(context.Background(), values, translationReadScope{datasets: map[int]bool{11: true}})
			if err != nil {
				t.Fatal(err)
			}
			if filtered["login"] != "Login" || filtered["reader_label"] != "Reader" || len(filtered) != 3 || filtered["shared_label"] != "Shared" {
				t.Fatalf("storage denied interface/reader copy or a real owner leaked: %v", filtered)
			}
		})
	}
}

func TestUnassociatedGeneratedSuffixesAreWithheld(t *testing.T) {
	for _, suffix := range lang_key_naming.DynamicSuffixes() {
		t.Run(suffix, func(t *testing.T) {
			installTranslationDB(t, []queuedCleanupQuery{{cols: []string{"key", "type", "dataset", "uid", "visible"}}})
			key := "confidential_mergers" + suffix
			values := map[string]string{"login": "Login", key: "Private sorting label"}
			filtered, err := filterTranslationMap(context.Background(), values, translationReadScope{})
			if err != nil || len(filtered) != 1 || filtered["login"] != "Login" {
				t.Fatalf("unassociated generated label exposed: %v, error=%v", filtered, err)
			}
			admin, err := filterTranslationMap(context.Background(), values, translationReadScope{admin: true})
			if err != nil || admin[key] != values[key] {
				t.Fatal("administrator lost unresolved label", admin, err)
			}
		})
	}
}
