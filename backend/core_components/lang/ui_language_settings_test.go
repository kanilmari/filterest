// ui_language_settings_test.go
// Verifies the canonical site-language validation and public-selector gate.
// Bridges administrator payloads with the immutable language registry contract.
// Exists to prevent invalid defaults, fallback cycles, or incomplete public languages.
package lang

import (
	"strings"
	"testing"
)

func canonicalLanguageSettingsFixture() []uiLanguageSetting {
	return []uiLanguageSetting{
		{LanguageCode: "en", IsEnabled: true, IsDefault: true, CoverageStatus: "complete", ReviewStatus: "approved", PublicSelectorReady: true, SortOrder: 10},
		{LanguageCode: "fi", IsEnabled: true, FallbackLanguageCode: stringPointer("en"), CoverageStatus: "complete", ReviewStatus: "approved", PublicSelectorReady: true, SortOrder: 20},
		{LanguageCode: "zh-CN", FallbackLanguageCode: stringPointer("en"), CoverageStatus: "partial", ReviewStatus: "needs_review", SortOrder: 30},
		{LanguageCode: "zh-TW", FallbackLanguageCode: stringPointer("en"), CoverageStatus: "not_started", ReviewStatus: "unreviewed", SortOrder: 40},
		{LanguageCode: "zh-HK", FallbackLanguageCode: stringPointer("en"), CoverageStatus: "not_started", ReviewStatus: "unreviewed", SortOrder: 50},
	}
}

func TestValidateAndNormalizeUILanguageSettingsAcceptsCanonicalInitialState(t *testing.T) {
	current := canonicalLanguageSettingsFixture()
	normalized, err := validateAndNormalizeUILanguageSettings(current, current)
	if err != nil {
		t.Fatalf("expected canonical settings to pass: %v", err)
	}
	if len(normalized) != 5 || normalized[0].LanguageCode != "en" || normalized[4].LanguageCode != "zh-HK" {
		t.Fatalf("unexpected normalized order: %#v", normalized)
	}
	if got := filterPublicUILanguages(normalized); len(got) != 2 {
		t.Fatalf("expected only en and fi in public selector, got %#v", got)
	}
}

func TestValidateAndNormalizeUILanguageSettingsRejectsMultipleDefaults(t *testing.T) {
	current := canonicalLanguageSettingsFixture()
	requested := canonicalLanguageSettingsFixture()
	requested[1].IsDefault = true
	if _, err := validateAndNormalizeUILanguageSettings(requested, current); err == nil || !strings.Contains(err.Error(), "exactly one") {
		t.Fatalf("expected exactly-one-default error, got %v", err)
	}
}

func TestValidateAndNormalizeUILanguageSettingsRejectsFallbackCycle(t *testing.T) {
	current := canonicalLanguageSettingsFixture()
	requested := canonicalLanguageSettingsFixture()
	requested[2].IsEnabled = true
	requested[1].FallbackLanguageCode = stringPointer("zh-CN")
	requested[2].FallbackLanguageCode = stringPointer("fi")
	if _, err := validateAndNormalizeUILanguageSettings(requested, current); err == nil || !strings.Contains(err.Error(), "cycle") {
		t.Fatalf("expected fallback-cycle error, got %v", err)
	}
}

func TestValidateAndNormalizeUILanguageSettingsRejectsIncompletePublicLanguage(t *testing.T) {
	current := canonicalLanguageSettingsFixture()
	requested := canonicalLanguageSettingsFixture()
	requested[2].IsEnabled = true
	requested[2].PublicSelectorReady = true
	if _, err := validateAndNormalizeUILanguageSettings(requested, current); err == nil || !strings.Contains(err.Error(), "not complete") {
		t.Fatalf("expected completeness gate error, got %v", err)
	}
}

func TestValidateAndNormalizeUILanguageSettingsPreservesRegistryMetadata(t *testing.T) {
	current := canonicalLanguageSettingsFixture()
	current[0].EnglishName = "English"
	requested := canonicalLanguageSettingsFixture()
	requested[0].EnglishName = "tampered"
	normalized, err := validateAndNormalizeUILanguageSettings(requested, current)
	if err != nil {
		t.Fatalf("unexpected validation error: %v", err)
	}
	if normalized[0].EnglishName != "English" {
		t.Fatalf("immutable registry metadata was not preserved: %#v", normalized[0])
	}
}
