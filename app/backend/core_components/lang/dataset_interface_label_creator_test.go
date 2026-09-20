// dataset_interface_label_creator_test.go
// Verifies deterministic labels and synchronized persistence for created schema names.
// Bridges pure label derivation with the two-store database write contract.
// Exists to keep new datasets readable without overwriting authored translations.
package lang

import (
	"database/sql"
	"errors"
	"strings"
	"testing"
)

type interfaceLabelExecCall struct {
	query string
	args  []interface{}
}

type interfaceLabelExecStub struct {
	calls []interfaceLabelExecCall
	err   error
}

func (stub *interfaceLabelExecStub) Exec(query string, args ...interface{}) (sql.Result, error) {
	stub.calls = append(stub.calls, interfaceLabelExecCall{query: query, args: args})
	return nil, stub.err
}

func TestDatasetInterfaceLabelsCoverDatasetOwnedKeys(t *testing.T) {
	labels := datasetInterfaceLabels("subscriptions")
	byKey := make(map[string]datasetInterfaceLabel, len(labels))
	for _, label := range labels {
		byKey[label.LangKey] = label
	}

	wants := map[string][2]string{
		"subscriptions":               {"Subscriptions", "Subscriptions"},
		"add_row_subscriptions":       {"Lisää rivi: Subscriptions", "Add row: Subscriptions"},
		"search_for_subscriptions":    {"Etsi: Subscriptions", "Search: Subscriptions"},
		"search_slogan_subscriptions": {"Selaa aineistoa Subscriptions.", "Browse Subscriptions."},
		"subscriptions_front_page":    {"Subscriptions", "Subscriptions"},
	}
	for key, want := range wants {
		got, exists := byKey[key]
		if !exists {
			t.Fatalf("missing derived label %q", key)
		}
		if got.Finnish != want[0] || got.English != want[1] {
			t.Fatalf("label %q = fi:%q en:%q, want fi:%q en:%q", key, got.Finnish, got.English, want[0], want[1])
		}
	}
}

func TestColumnInterfaceLabelsMakeNamesSearchAndSortReadable(t *testing.T) {
	labels := columnInterfaceLabels("subscriptions", []string{"re_examine_date", "subscriber_id"})
	byKey := make(map[string]datasetInterfaceLabel, len(labels))
	for _, label := range labels {
		byKey[label.LangKey] = label
	}

	if got := byKey["re_examine_date"].English; got != "Re examine date" {
		t.Fatalf("direct label = %q", got)
	}
	if got := byKey["search_for_subscriber_id"].English; got != "Search: Subscriber ID" {
		t.Fatalf("search label = %q", got)
	}
	if got := byKey["re_examine_date_desc"].Finnish; got != "Re examine date, laskeva" {
		t.Fatalf("descending label = %q", got)
	}
}

func TestPersistDerivedInterfaceLabelsWritesBothStoresAndEnabledLanguages(t *testing.T) {
	stub := &interfaceLabelExecStub{}
	err := persistDerivedInterfaceLabels(stub, []datasetInterfaceLabel{
		newDerivedInterfaceLabel(
			"re_examine_date", "Re examine date", "Re examine date",
			"column", "subscriptions", "re_examine_date", "Readable column label.",
		),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(stub.calls) != 1 {
		t.Fatalf("exec calls = %d, want 1 atomic write", len(stub.calls))
	}
	query := stub.calls[0].query
	for _, required := range []string{
		"INSERT INTO system_lang_keys",
		"INSERT INTO system_lang_key_translations",
		"INSERT INTO system_lang_key_sources",
		"languages.is_enabled",
		"VALUES ('fi', keys.fi), ('en', keys.en)",
	} {
		if !strings.Contains(query, required) {
			t.Fatalf("persistence query missing %q", required)
		}
	}
	if strings.Contains(query, "'sv'") || strings.Contains(query, "'de'") {
		t.Fatalf("persistence query must not invent Swedish or German: %s", query)
	}
}

func TestPersistDerivedInterfaceLabelsReturnsWriteError(t *testing.T) {
	stub := &interfaceLabelExecStub{err: errors.New("write failed")}
	err := persistDerivedInterfaceLabels(stub, []datasetInterfaceLabel{
		newDerivedInterfaceLabel("subscriptions", "Subscriptions", "Subscriptions", "table", "subscriptions", "subscriptions", "Dataset label."),
	})
	if err == nil || !strings.Contains(err.Error(), "write failed") {
		t.Fatalf("error = %v, want wrapped write failure", err)
	}
}
