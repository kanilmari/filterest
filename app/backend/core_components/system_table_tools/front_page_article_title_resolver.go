// front_page_article_title_resolver.go
// Selects the first usable header from an already authorized article result.
// Mirrors article field order, role modifiers and dataset-value language fallbacks.
// Resolves public translation copy only after the row supplies a permitted key.
package system_table_tools

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"easelect/backend/core_components/lang"
)

var frontPageArticleTranslationsReader = lang.ReadDisplayTranslations
var articleLanguageKey = regexp.MustCompile(`(?i)^[a-z]{2,3}([-_][a-z]{2,4})?$`)

type frontPageArticleColumn struct {
	CardElement        string `json:"card_element"`
	IsMultilingual     *bool  `json:"is_multilingual"`
	HideEverywhere     bool   `json:"hide_everywhere"`
	ClientDeliveryMode string `json:"client_delivery_mode"`
	HideUnlessOwn      bool   `json:"hide_on_bg_crd_if_not_own"`
	HideFalseNull      bool   `json:"hide_false_null_on_big_crd"`
	IsRowOwner         bool   `json:"is_row_owner"`
}

func frontPageArticleTitle(r *http.Request, userID int, result frontPageArticleResult) string {
	if len(result.Data) != 1 {
		return ""
	}
	row := result.Data[0]
	// The normal article read supplies this order, already intersected with
	// SELECT and field-set rights. Metadata alone never qualifies a column.
	for _, column := range result.Columns {
		raw, present := row[column]
		var metadata frontPageArticleColumn
		if !present || json.Unmarshal(result.Types[column], &metadata) != nil || metadata.HideEverywhere ||
			(metadata.ClientDeliveryMode != "" && metadata.ClientDeliveryMode != "include") {
			continue
		}
		header, languageKey := articleHeaderRole(metadata.CardElement)
		if !header || (metadata.HideUnlessOwn && !articleRowIsOwn(row, result.Types, userID)) {
			continue
		}
		value := articleDisplayValue(raw, metadata.IsMultilingual, r.URL.Query().Get("lang"))
		if metadata.HideFalseNull && (string(raw) == "false" || value == "false") {
			continue
		}
		if languageKey && value != "" {
			translations, err := frontPageArticleTranslationsReader(r.URL.Query().Get("lang"))
			if err != nil {
				continue
			}
			value = strings.TrimSpace(translations[value])
		}
		if value != "" {
			return value
		}
	}
	return ""
}

func articleRowIsOwn(row map[string]json.RawMessage, types map[string]json.RawMessage, userID int) bool {
	for column, description := range types {
		var metadata frontPageArticleColumn
		if json.Unmarshal(description, &metadata) == nil && metadata.IsRowOwner {
			value := articleDisplayValue(row[column], nil, "en")
			return userID > 1 && value == strconv.Itoa(userID)
		}
	}
	return false
}

func articleHeaderRole(roles string) (header, languageKey bool) {
	for _, role := range strings.Split(roles, ",") {
		base, modifier, _ := strings.Cut(strings.TrimSpace(role), "+")
		header = header || strings.TrimSpace(base) == "header"
		languageKey = languageKey || strings.TrimSpace(modifier) == "lang-key" || strings.TrimSpace(modifier) == "lang_key"
	}
	return
}

// articleDisplayValue mirrors dataset_value_localizer.js/lang_value_reader.js:
// explicit false preserves JSON; legacy language maps are recognized narrowly.
func articleDisplayValue(raw json.RawMessage, multilingual *bool, language string) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	value := strings.TrimSpace(string(raw))
	var text string
	if json.Unmarshal(raw, &text) == nil {
		value = strings.TrimSpace(text)
	}
	if multilingual != nil && !*multilingual {
		return value
	}
	var translations map[string]json.RawMessage
	if json.Unmarshal([]byte(value), &translations) != nil || len(translations) == 0 {
		return value
	}
	if multilingual == nil {
		for key, candidate := range translations {
			if !articleLanguageKey.MatchString(key) || json.Unmarshal(candidate, &text) != nil {
				return value
			}
		}
	}
	language = strings.ToLower(strings.ReplaceAll(strings.TrimSpace(language), "_", "-"))
	if language == "" {
		language = "en"
	}
	base, _, _ := strings.Cut(language, "-")
	for _, key := range []string{language, base, "en"} {
		if candidate, ok := translations[key]; ok && json.Unmarshal(candidate, &text) == nil {
			return strings.TrimSpace(text)
		}
	}
	// Preserve JSON key order for the browser's final first-string fallback.
	decoder := json.NewDecoder(strings.NewReader(value))
	_, _ = decoder.Token()
	for decoder.More() {
		_, _ = decoder.Token()
		var candidate json.RawMessage
		if decoder.Decode(&candidate) != nil {
			break
		}
		if json.Unmarshal(candidate, &text) == nil {
			return strings.TrimSpace(text)
		}
	}
	return ""
}
