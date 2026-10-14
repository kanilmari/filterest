// shell_boot_translation_reader_test.go
// Checks authored recovery copy and emergency language fallback without a database.
// Bridges request locale normalization and the same served-reader contract as production.
// Prevents broken language reads from breaking the asset-independent notice.
package lang

import (
	"errors"
	"net/http/httptest"
	"testing"
)

func TestShellBootTextsPreserveAuthoredCopyAndFillMissingKeys(t *testing.T) {
	texts := readShellBootTexts("fi", func(code string) (map[string]string, error) {
		if code != "fi" {
			t.Fatalf("language = %q", code)
		}
		return map[string]string{"shell_boot_failed_title": "<script>site wording</script>", "shell_boot_reload": "  "}, nil
	})
	if texts.FailedTitle != "<script>site wording</script>" || texts.Reload != "Lataa sivu uudelleen" || texts.Loading != "Sivua ladataan…" {
		t.Fatalf("texts = %+v", texts)
	}
	for _, code := range []string{"fi", "en", "fr"} {
		fallback := readShellBootTexts(code, func(string) (map[string]string, error) { return nil, errors.New("unavailable") })
		expected := "Loading the page…"
		if code == "fi" {
			expected = "Sivua ladataan…"
		}
		if fallback.Loading != expected || fallback.JavaScriptRequired == "" || fallback.BrowserUnsupported == "" {
			t.Fatalf("fallback %s = %+v", code, fallback)
		}
	}
}

func TestShellBootHomeCopyUsesOneTranslationReadWithoutInventedFallbacks(t *testing.T) {
	for _, code := range []string{"fi", "en", "yue"} {
		t.Run(code, func(t *testing.T) {
			reads := 0
			texts := readShellBootTexts(code, func(requested string) (map[string]string, error) {
				reads++
				if requested != code {
					t.Fatalf("language = %q, want %q", requested, code)
				}
				return map[string]string{
					"site_front_page_slogan":      code + " slogan",
					"site_front_page_description": code + " description",
				}, nil
			})
			if reads != 1 || texts.HomeSlogan != code+" slogan" || texts.HomeDescription != code+" description" {
				t.Fatalf("reads = %d, texts = %+v", reads, texts)
			}
			for _, reader := range []func(string) (map[string]string, error){
				func(string) (map[string]string, error) { return map[string]string{}, nil },
				func(string) (map[string]string, error) { return nil, errors.New("unavailable") },
			} {
				empty := readShellBootTexts(code, reader)
				if empty.HomeSlogan != "" || empty.HomeDescription != "" {
					t.Fatalf("Home copy invented a fallback: %+v", empty)
				}
			}
		})
	}
}

func TestShellBootRequestLanguage(t *testing.T) {
	for _, tc := range []struct{ query, header, expected string }{
		{"?lang=fi", "en-US", "fi"}, {"", "fi-FI, en;q=0.5", "fi"}, {"", "en-US", "en"},
		{"?lang=zh-HK", "fi", "fi"}, {"", "", "en"}, {"?lang=not%20a%20locale", "fi", "fi"},
		{"", "sv-SE, fi;q=0.9", "fi"}, {"?lang=sv", "fi", "fi"},
		{"?lang=sv&lang=fi", "en", "fi"}, {"", "invalid!, fi;q=0.9", "fi"},
		{"", "sv;q=1, en;q=0, fi;q=0.9", "fi"}, {"", "fi;q=invalid, en", "en"},
		{"", "fi;q=0.1,en;q=1", "en"}, {"", "fi;q=0,en;q=0.5", "en"},
		{"", "en;q=0,fi;q=0.5", "fi"}, {"", "fi;q=0.5,en;q=0.5", "fi"},
		{"", "en;q=0.5,fi;q=0.5", "en"}, {"", "fi;q=0,en;q=0", "en"},
		{"?lang=en%3Bpassword", "not a locale, fi", "fi"}, {"", "*", "en"},
	} {
		r := httptest.NewRequest("GET", "/"+tc.query, nil)
		r.Header.Set("Accept-Language", tc.header)
		if got := ResolvePageLanguage(r); got != tc.expected {
			t.Errorf("language(%s, %s) = %s, want %s", tc.query, tc.header, got, tc.expected)
		}
	}
}

func TestShellBootLanguageUsesCanonicalAvailabilityAndDefault(t *testing.T) {
	languages := []uiLanguageSetting{
		{LanguageCode: "fi", IsEnabled: true, IsDefault: true},
		{LanguageCode: "en", IsEnabled: true},
		{LanguageCode: "zh-HK", IsEnabled: true},
		{LanguageCode: "sv", IsEnabled: false},
	}
	for _, tc := range []struct{ query, header, expected string }{
		{"?lang=zh-Hant-HK", "en", "zh-HK"}, {"?lang=invalid!", "sv, zh-HK", "zh-HK"},
		{"?lang=sv", "sv-SE, en-US;q=0.9", "en"}, {"", "unknown!", "fi"}, {"", "", "fi"},
	} {
		r := httptest.NewRequest("GET", "/"+tc.query, nil)
		r.Header.Set("Accept-Language", tc.header)
		if got := resolvePageLanguage(r, languages); got != tc.expected {
			t.Errorf("language(%s, %s) = %s, want %s", tc.query, tc.header, got, tc.expected)
		}
	}
}
