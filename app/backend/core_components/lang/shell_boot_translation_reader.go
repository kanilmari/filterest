// shell_boot_translation_reader.go
// Reads the small recovery vocabulary before frontend assets are available.
// Bridges request language, the served translation model and emergency fi/en copy.
// Keeps translated text out of executable script and preserves authored site wording.
package lang

import (
	backend "easelect/backend/core_components"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// ShellBootTexts is plain text: html/template must escape every member.
type ShellBootTexts struct {
	Loading            string
	FailedTitle        string
	FailedMessage      string
	Reload             string
	JavaScriptRequired string
	BrowserUnsupported string
}

var shellBootFallbacks = map[string][2]string{
	"shell_boot_loading":             {"Sivua ladataan…", "Loading the page…"},
	"shell_boot_failed_title":        {"Sivu ei latautunut.", "The page could not load."},
	"shell_boot_failed_message":      {"Kokeile ladata sivu uudelleen.", "Try reloading the page."},
	"shell_boot_reload":              {"Lataa sivu uudelleen", "Reload page"},
	"shell_boot_javascript_required": {"Sovelluksen käyttö vaatii JavaScriptin. Ota JavaScript käyttöön ja lataa sivu uudelleen.", "JavaScript is required to use this application. Enable JavaScript and reload the page."},
	"shell_boot_browser_unsupported": {"Tätä selainta ei tueta. Avaa sivu ajan tasalla olevalla selaimella.", "This browser is not supported. Open the page in an up-to-date browser."},
}

var pageLanguageTagRegexp = regexp.MustCompile(`(?i)^[a-z]{2,3}(-[a-z0-9]{2,8})*$`)

// ResolvePageLanguage selects recovery and standalone-auth copy independently of SEO.
// Availability and the default come from the existing canonical registry. When
// it cannot be read, the emergency vocabulary supports Finnish and English.
func ResolvePageLanguage(r *http.Request) string {
	languages := []uiLanguageSetting{{LanguageCode: "en", IsEnabled: true, IsDefault: true}, {LanguageCode: "fi", IsEnabled: true}}
	if backend.Db != nil {
		if configured, err := readUILanguageSettings(r.Context(), backend.Db); err == nil && len(configured) > 0 {
			languages = configured
		}
	}
	return resolvePageLanguage(r, languages)
}

func resolvePageLanguage(r *http.Request, languages []uiLanguageSetting) string {
	available := make(map[string]bool, len(languages))
	defaultCode := "en"
	for _, setting := range languages {
		if !setting.IsEnabled {
			continue
		}
		available[setting.LanguageCode] = true
		if setting.IsDefault {
			defaultCode = setting.LanguageCode
		}
	}
	match := func(value string) string {
		raw := strings.TrimSpace(strings.ReplaceAll(value, "_", "-"))
		if raw == "" || raw == "*" {
			return ""
		}
		if !pageLanguageTagRegexp.MatchString(raw) {
			return ""
		}
		code := normalizeRequestedLanguageCode(raw)
		// The translation reader maps unknown syntax to English; negotiation must
		// skip it instead, so it cannot obscure the next supported preference.
		if code == "en" && strings.SplitN(strings.ToLower(raw), "-", 2)[0] != "en" {
			return ""
		}
		if available[code] {
			return code
		}
		if base, _, regional := strings.Cut(code, "-"); regional && available[base] {
			return base
		}
		return ""
	}
	for _, requested := range r.URL.Query()["lang"] {
		if code := match(requested); code != "" {
			return code
		}
	}
	type preference struct {
		code    string
		quality float64
	}
	preferences := make([]preference, 0)
	for _, part := range strings.Split(r.Header.Get("Accept-Language"), ",") {
		parts := strings.SplitN(part, ";", 2)
		quality := 1.0
		if len(parts) == 2 {
			weight := strings.TrimSpace(parts[1])
			if !strings.HasPrefix(weight, "q=") {
				continue
			}
			var err error
			quality, err = strconv.ParseFloat(strings.TrimPrefix(weight, "q="), 64)
			if err != nil || !(quality > 0 && quality <= 1) {
				continue
			}
		}
		if code := match(parts[0]); code != "" {
			preferences = append(preferences, preference{code: code, quality: quality})
		}
	}
	sort.SliceStable(preferences, func(i, j int) bool { return preferences[i].quality > preferences[j].quality })
	if len(preferences) > 0 {
		return preferences[0].code
	}
	return defaultCode
}

// ReadShellBootTexts uses the same authored/legacy model as the translation endpoint.
// Database failure or absent copy keeps a self-contained Finnish/English notice.
func ReadShellBootTexts(languageCode string) ShellBootTexts {
	return readShellBootTexts(languageCode, func(code string) (map[string]string, error) {
		if backend.Db == nil {
			return nil, nil
		}
		return readServedTranslationMap(code)
	})
}

func readShellBootTexts(languageCode string, reader func(string) (map[string]string, error)) ShellBootTexts {
	values, _ := reader(languageCode)
	fallbackIndex := 1
	if languageCode == "fi" {
		fallbackIndex = 0
	}
	text := func(key string) string {
		if value := values[key]; strings.TrimSpace(value) != "" {
			return value
		}
		return shellBootFallbacks[key][fallbackIndex]
	}
	return ShellBootTexts{
		Loading: text("shell_boot_loading"), FailedTitle: text("shell_boot_failed_title"),
		FailedMessage: text("shell_boot_failed_message"), Reload: text("shell_boot_reload"),
		JavaScriptRequired: text("shell_boot_javascript_required"), BrowserUnsupported: text("shell_boot_browser_unsupported"),
	}
}
