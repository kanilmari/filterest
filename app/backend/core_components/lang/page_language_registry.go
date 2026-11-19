// page_language_registry.go
// Answers which languages a site publishes and reads one interface text for server-rendered pages.
// Between the language registry (system_languages, system_lang_keys) and page heads, sitemaps and public documents.
// Exists so those pages use the site's own languages instead of a fixed fi/en/yue list.
package lang

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	backend "easelect/backend/core_components"

	"github.com/lib/pq"
)

// PageLanguages is the site's enabled interface languages in their configured
// order, with the one the site falls back to. Published are those of them the
// application also offers in its public language selector: only these get an
// address language (?lang=) of their own, the same rule as the browser's
// lang_preference_reader.js, so a page's head and its application agree.
type PageLanguages struct {
	Enabled   []string
	Published []string
	Default   string
}

// Publishes reports whether code is a language with its own public address.
func (languages PageLanguages) Publishes(code string) bool {
	for _, published := range languages.Published {
		if published == code {
			return true
		}
	}
	return false
}

// Has reports whether code is one of the site's enabled languages.
func (languages PageLanguages) Has(code string) bool {
	for _, enabled := range languages.Enabled {
		if enabled == code {
			return true
		}
	}
	return false
}

// ReadPageLanguages reads the enabled languages from the same registry
// ResolvePageLanguage negotiates against. When it cannot be read, the emergency
// vocabulary's English and Finnish stand in, English first, as there.
func ReadPageLanguages(ctx context.Context) PageLanguages {
	settings := []uiLanguageSetting{{LanguageCode: "en", IsEnabled: true, IsDefault: true, PublicSelectorReady: true},
		{LanguageCode: "fi", IsEnabled: true, PublicSelectorReady: true}}
	if backend.Db != nil {
		if configured, err := readUILanguageSettings(ctx, backend.Db); err == nil && len(configured) > 0 {
			settings = configured
		}
	}
	return pageLanguagesFromSettings(settings)
}

func pageLanguagesFromSettings(settings []uiLanguageSetting) PageLanguages {
	languages := PageLanguages{Default: "en"}
	defaultSeen := false
	for _, setting := range settings {
		if !setting.IsEnabled {
			continue
		}
		languages.Enabled = append(languages.Enabled, setting.LanguageCode)
		if setting.PublicSelectorReady {
			languages.Published = append(languages.Published, setting.LanguageCode)
		}
		if setting.IsDefault {
			languages.Default = setting.LanguageCode
			defaultSeen = true
		}
	}
	if !defaultSeen && len(languages.Enabled) > 0 && !languages.Has("en") {
		languages.Default = languages.Enabled[0]
	}
	return languages
}

// ReadDisplayTranslation returns the copy one language is served for one key, or
// "" when the key has none or cannot be read. It reads the same two sources
// ReadDisplayTranslations combines (the language's own column, then the
// normalized translation table), for one key only. Callers must already be
// allowed to show the key.
func ReadDisplayTranslation(languageCode string, langKey string) string {
	value, _ := ReadDisplayTranslationContext(context.Background(), languageCode, langKey)
	return value
}

// ReadDisplayTranslationContext is ReadDisplayTranslation bounded by ctx, and it
// reports a failed read instead of answering "", so a caller with a deadline can
// tell "no copy" from "could not ask".
func ReadDisplayTranslationContext(ctx context.Context, languageCode string, langKey string) (string, error) {
	if backend.Db == nil || strings.TrimSpace(langKey) == "" {
		return "", nil
	}
	code := normalizeRequestedLanguageCode(languageCode)
	if column, legacy := legacyLanguageColumns[code]; legacy {
		var value sql.NullString
		query := fmt.Sprintf(`SELECT %s FROM system_lang_keys WHERE lang_key = $1`, pq.QuoteIdentifier(column))
		err := backend.Db.QueryRowContext(ctx, query, langKey).Scan(&value)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return "", err
		}
		if strings.TrimSpace(value.String) != "" {
			return strings.TrimSpace(value.String), nil
		}
	}
	if !canonicalLanguageTagRegexp.MatchString(code) {
		return "", nil
	}
	var value sql.NullString
	err := backend.Db.QueryRowContext(ctx, `SELECT translation FROM (`+canonicalTranslationsQuery+`) served WHERE lang_key = $2`,
		code, langKey).Scan(&value)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	return strings.TrimSpace(value.String), nil
}
