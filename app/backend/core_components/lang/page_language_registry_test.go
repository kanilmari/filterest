// page_language_registry_test.go
// Pins which languages get a public address and which one a site falls back to.
package lang

import (
	"reflect"
	"testing"
)

func TestPageLanguagesPublishOnlySelectorReadyEnabledLanguages(t *testing.T) {
	languages := pageLanguagesFromSettings([]uiLanguageSetting{
		{LanguageCode: "fi", IsEnabled: true, IsDefault: true, PublicSelectorReady: true},
		{LanguageCode: "en", IsEnabled: true, PublicSelectorReady: true},
		{LanguageCode: "sv", IsEnabled: true},
		{LanguageCode: "yue", IsEnabled: false, PublicSelectorReady: true},
	})
	if !reflect.DeepEqual(languages.Enabled, []string{"fi", "en", "sv"}) || !reflect.DeepEqual(languages.Published, []string{"fi", "en"}) ||
		languages.Default != "fi" {
		t.Fatalf("languages = %+v", languages)
	}
	if !languages.Publishes("en") || languages.Publishes("sv") || languages.Publishes("yue") || !languages.Has("sv") {
		t.Fatalf("membership wrong: %+v", languages)
	}
}

func TestPageLanguagesWithoutADefaultFallBackToEnglishOrTheFirst(t *testing.T) {
	if got := pageLanguagesFromSettings([]uiLanguageSetting{{LanguageCode: "fi", IsEnabled: true}, {LanguageCode: "en", IsEnabled: true}}).Default; got != "en" {
		t.Fatalf("default = %q, want en", got)
	}
	if got := pageLanguagesFromSettings([]uiLanguageSetting{{LanguageCode: "fi", IsEnabled: true}, {LanguageCode: "sv", IsEnabled: true}}).Default; got != "fi" {
		t.Fatalf("default = %q, want fi", got)
	}
}
