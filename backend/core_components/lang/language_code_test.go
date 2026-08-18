// language_code_test.go
// Verifies browser and BCP 47 locale input normalization for UI translations.
// Bridges legacy language aliases with the canonical regional Chinese registry.
// Exists so zh-CN, zh-TW, and zh-HK never collapse into one ambiguous column.
package lang

import "testing"

func TestNormalizeRequestedLanguageCodeKeepsCanonicalChineseRegionsDistinct(t *testing.T) {
	testCases := map[string]string{
		"zh-CN":      "zh-CN",
		"zh_SG":      "zh-CN",
		"zh-Hans":    "zh-CN",
		"zh-TW":      "zh-TW",
		"zh-Hant":    "zh-TW",
		"zh-Hant-TW": "zh-TW",
		"zh-HK":      "zh-HK",
		"zh-MO":      "zh-HK",
		"zh-Hant-HK": "zh-HK",
	}

	for input, expected := range testCases {
		if actual := normalizeRequestedLanguageCode(input); actual != expected {
			t.Errorf("normalizeRequestedLanguageCode(%q) = %q, want %q", input, actual, expected)
		}
	}
}

func TestNormalizeRequestedLanguageCodePreservesLegacyAliasesAndSafeFallback(t *testing.T) {
	testCases := map[string]string{
		"en-US":         "en-US",
		"fi":            "fi",
		"yue-Hant-HK":   "yue",
		"ch":            "ch",
		"not a locale!": "en",
		"":              "en",
	}

	for input, expected := range testCases {
		if actual := normalizeRequestedLanguageCode(input); actual != expected {
			t.Errorf("normalizeRequestedLanguageCode(%q) = %q, want %q", input, actual, expected)
		}
	}
}
