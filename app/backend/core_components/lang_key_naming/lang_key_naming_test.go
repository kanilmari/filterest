// lang_key_naming_test.go
// Verifies the one rule that names dynamically generated language keys.
// Bridges the startup source scan and the runtime ownership resolver, which
// previously carried separate copies of this list.
// Uses no database and no network.
package lang_key_naming

import (
	"reflect"
	"testing"
)

func TestDynamicListsAreCopiesSoNoCallerCanChangeTheSharedRule(t *testing.T) {
	prefixes := DynamicPrefixes()
	prefixes[0] = "tampered_"
	if DynamicPrefixes()[0] == "tampered_" {
		t.Fatal("a caller changed the shared prefixes")
	}

	suffixes := DynamicSuffixes()
	suffixes[0] = "_tampered"
	if DynamicSuffixes()[0] == "_tampered" {
		t.Fatal("a caller changed the shared suffixes")
	}
}

func TestTrimDynamicPrefixReportsTheNameTheKeyWasBuiltFrom(t *testing.T) {
	for key, want := range map[string]string{
		"add_row_customers":     "customers",
		"search_for_name":       "name",
		"search_slogan_tickets": "tickets",
	} {
		got, ok := TrimDynamicPrefix(key)
		if !ok || got != want {
			t.Errorf("TrimDynamicPrefix(%q) = %q, %v; want %q, true", key, got, ok, want)
		}
	}
	if _, ok := TrimDynamicPrefix("chat_attach_image"); ok {
		t.Error("an ordinary key must not look dynamic")
	}
}

func TestTrimDynamicSuffixReportsTheNameTheKeyWasBuiltFrom(t *testing.T) {
	for key, want := range map[string]string{
		"name_asc":             "name",
		"name_desc":            "name",
		"customers_front_page": "customers",
	} {
		got, ok := TrimDynamicSuffix(key)
		if !ok || got != want {
			t.Errorf("TrimDynamicSuffix(%q) = %q, %v; want %q, true", key, got, ok, want)
		}
	}
	if _, ok := TrimDynamicSuffix("dataset_symbol_label"); ok {
		t.Error("an ordinary key must not look dynamic")
	}
}

func TestDatasetOwnedKeyNamesCoverEveryKeyADatasetOwnsByName(t *testing.T) {
	got := DatasetOwnedKeyNames("  customers  ")
	want := []string{
		"add_row_customers",
		"search_for_customers",
		"search_slogan_customers",
		"customers_front_page",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("DatasetOwnedKeyNames = %v, want %v", got, want)
	}
	if DatasetOwnedKeyNames("   ") != nil {
		t.Error("a dataset without a name owns no keys")
	}
	if SearchPlaceholderKey("customers") != "search_for_customers" {
		t.Error("the search placeholder must follow the same rule")
	}
}
