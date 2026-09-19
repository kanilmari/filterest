// served_translation_map_test.go
// Verifies which store each interface language is served from, and that copy
// authored only in the normalized translation table reaches the interface.
// Bridges the translation endpoint's two stores with deterministic assertions.
// Exists because a seed migration that wrote only the normalized table appeared
// to succeed while its Finnish and English copy never reached a single screen.
package lang

import "testing"

func TestFinnishAndEnglishAreServedFromTheirOwnColumns(t *testing.T) {
	// This is the routing that made the seeded chat-attachment copy invisible:
	// these four languages never consult the normalized table on their own.
	for _, languageCode := range []string{"fi", "en", "ch", "yue"} {
		if _, servedFromColumn := legacyLanguageColumns[languageCode]; !servedFromColumn {
			t.Fatalf("language %q is expected to be served from its own column", languageCode)
		}
	}
	if _, servedFromColumn := legacyLanguageColumns["zh-CN"]; servedFromColumn {
		t.Fatal("zh-CN has no column of its own and must come from the normalized table")
	}
}

func TestAuthoredTranslationsFillGapsWithoutChangingServedCopy(t *testing.T) {
	served := map[string]string{
		"save":              "Tallenna",
		"chat_attach_image": "",
		"dataset_symbol":    "   ",
	}
	authored := map[string]string{
		"save":               "Talleta",
		"chat_attach_image":  "Liitä kuva",
		"dataset_symbol":     "Symboli",
		"site_assistant_new": "Uusi",
		"blank_authored":     "  ",
	}

	result := fillGapsFromAuthoredTranslations(served, authored)

	if result["save"] != "Tallenna" {
		t.Fatalf("a value the site already shows must win, got %q", result["save"])
	}
	if result["chat_attach_image"] != "Liitä kuva" {
		t.Fatalf("authored copy should fill an empty column, got %q", result["chat_attach_image"])
	}
	if result["dataset_symbol"] != "Symboli" {
		t.Fatalf("a whitespace-only column counts as empty, got %q", result["dataset_symbol"])
	}
	if result["site_assistant_new"] != "Uusi" {
		t.Fatalf("a key present only in the normalized table should be served, got %q", result["site_assistant_new"])
	}
	if value, present := result["blank_authored"]; present && value != "" {
		t.Fatalf("blank authored copy should not be introduced, got %q", value)
	}
}
