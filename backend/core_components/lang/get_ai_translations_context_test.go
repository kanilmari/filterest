// Verifies that runtime-created dataset header keys receive semantic context
// and that unexplained keys cannot trigger guess-based AI translations.
package lang

import (
	"strings"
	"testing"
)

func TestBuildDynamicDatasetTranslationContextsExplainsHeaderKeys(t *testing.T) {
	contexts := buildDynamicDatasetTranslationContexts(
		[]string{
			"travel_info_front_page",
			"search_slogan_travel_info",
			"search_for_travel_info",
			"unrelated_key",
		},
		[]datasetTranslationIdentity{{
			TableName:   "travel_info",
			DisplayName: "Travel info",
		}},
	)

	if len(contexts) != 3 {
		t.Fatalf("contexts = %#v, want three dataset-header contexts", contexts)
	}
	for _, context := range contexts {
		if !strings.Contains(context.UsageExplanation, "Travel info") {
			t.Fatalf("context for %s omitted display name: %q", context.LangKey, context.UsageExplanation)
		}
		if strings.TrimSpace(context.FieldName) == "" || strings.TrimSpace(context.DatasetName) == "" {
			t.Fatalf("context lacks durable source identity: %#v", context)
		}
	}
	if strings.Contains(contexts[0].UsageExplanation, "technical identifiers") == false {
		t.Fatalf("title context does not guard against literal key translation: %q", contexts[0].UsageExplanation)
	}
}

func TestFilterTranslationKeysWithUsageExplanationSkipsUnknownMeaning(t *testing.T) {
	contextual, skipped := filterTranslationKeysWithUsageExplanation(
		[]string{"known_key", "unknown_key"},
		map[string]string{"known_key": "Button that opens the saved views panel."},
	)
	if len(contextual) != 1 || contextual[0] != "known_key" {
		t.Fatalf("contextual = %#v, want known_key", contextual)
	}
	if len(skipped) != 1 || skipped[0] != "unknown_key" {
		t.Fatalf("skipped = %#v, want unknown_key", skipped)
	}
}

func TestFilterAIEligibleMissingKeysSkipsSyntheticTestDatasets(t *testing.T) {
	filtered, skipped := filterAIEligibleMissingKeys([]string{
		"test_perm_table_desktop_card_1786923499508_assets",
		"search_slogan_test_perm_table_desktop_card_1786923499508",
		"add_row_e2e_dataset_123",
		"sort_newest",
	})

	if skipped != 3 {
		t.Fatalf("skipped = %d, want 3 synthetic test keys", skipped)
	}
	if len(filtered) != 1 || filtered[0] != "sort_newest" {
		t.Fatalf("filtered = %#v, want only sort_newest", filtered)
	}
}
