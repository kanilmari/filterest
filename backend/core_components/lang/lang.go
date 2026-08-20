// lang.go
// Core translation handlers for reading, editing, and AI-seeding lang-key values.
// Bridges frontend localisation requests and the system_lang_keys/system_lang_key_sources tables.
// Exists to keep CRUD-style translation management in one backend entry point.
package lang

import (
	"database/sql"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/httpresponse"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"regexp"
	"strings"

	"github.com/lib/pq"
)

var canonicalLanguageTagRegexp = regexp.MustCompile(`^[a-z]{2,3}(-[A-Z]{2})?$`)
var primaryLanguageCodeRegexp = regexp.MustCompile(`^[a-z]{2,3}$`)
var regionCodeRegexp = regexp.MustCompile(`^[a-z]{2}$`)

var legacyLanguageColumns = map[string]string{
	"en":  "en",
	"fi":  "fi",
	"ch":  "ch",
	"yue": "yue",
}

const canonicalTranslationsQuery = `
	WITH RECURSIVE locale_chain AS (
		SELECT language_code,
		       fallback_language_code,
		       0 AS fallback_depth,
		       ARRAY[language_code]::TEXT[] AS visited
		FROM system_languages
		WHERE language_code = $1

		UNION ALL

		SELECT fallback.language_code,
		       fallback.fallback_language_code,
		       chain.fallback_depth + 1,
		       chain.visited || fallback.language_code
		FROM locale_chain AS chain
		JOIN system_languages AS fallback
		  ON fallback.language_code = chain.fallback_language_code
		WHERE chain.fallback_depth < 8
		  AND NOT fallback.language_code = ANY(chain.visited)
	), ranked_translations AS (
		SELECT keys.lang_key,
		       translations.translation,
		       ROW_NUMBER() OVER (
		           PARTITION BY keys.lang_key
		           ORDER BY chain.fallback_depth
		       ) AS fallback_rank
		FROM locale_chain AS chain
		JOIN system_lang_key_translations AS translations
		  ON translations.language_code = chain.language_code
		JOIN system_lang_keys AS keys
		  ON keys.id = translations.lang_key_id
	)
	SELECT lang_key, translation
	FROM ranked_translations
	WHERE fallback_rank = 1
`

func normalizeRequestedLanguageCode(value string) string {
	raw := strings.TrimSpace(strings.ReplaceAll(value, "_", "-"))
	if raw == "" {
		return "en"
	}

	lower := strings.ToLower(raw)
	switch {
	case lower == "yue" || strings.HasPrefix(lower, "yue-"):
		return "yue"
	case lower == "ch":
		return "ch"
	case lower == "zh-hk" || lower == "zh-mo" || strings.HasPrefix(lower, "zh-hant-hk") || strings.HasPrefix(lower, "zh-hant-mo"):
		return "zh-HK"
	case lower == "zh-tw" || lower == "zh-hant" || strings.HasPrefix(lower, "zh-hant-tw"):
		return "zh-TW"
	case lower == "zh" || lower == "zh-cn" || lower == "zh-sg" || strings.HasPrefix(lower, "zh-hans"):
		return "zh-CN"
	}

	parts := strings.Split(lower, "-")
	if len(parts) == 1 && primaryLanguageCodeRegexp.MatchString(parts[0]) {
		return parts[0]
	}
	if len(parts) == 2 && primaryLanguageCodeRegexp.MatchString(parts[0]) && regionCodeRegexp.MatchString(parts[1]) {
		return parts[0] + "-" + strings.ToUpper(parts[1])
	}
	return "en"
}

func translationMapFromRows(rows *sql.Rows) (map[string]string, error) {
	defer rows.Close()

	translationMap := make(map[string]string)
	for rows.Next() {
		var key string
		var value sql.NullString
		if err := rows.Scan(&key, &value); err != nil {
			return nil, err
		}
		translationMap[key] = value.String
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return translationMap, nil
}

func readLegacyTranslationMap(languageCode string) (map[string]string, error) {
	columnName, exists := legacyLanguageColumns[languageCode]
	if !exists {
		return map[string]string{}, nil
	}
	query := fmt.Sprintf(
		`SELECT lang_key, %s FROM system_lang_keys`,
		pq.QuoteIdentifier(columnName),
	)
	rows, err := backend.Db.Query(query)
	if err != nil {
		return nil, err
	}
	return translationMapFromRows(rows)
}

func readCanonicalTranslationMap(languageCode string) (map[string]string, error) {
	if !canonicalLanguageTagRegexp.MatchString(languageCode) {
		return map[string]string{}, nil
	}
	rows, err := backend.Db.Query(canonicalTranslationsQuery, languageCode)
	if err != nil {
		return nil, err
	}
	return translationMapFromRows(rows)
}

// GetTranslationsHandler returns the chosen language map and optional dev-only orphan-key metadata.
func GetTranslationsHandler(w http.ResponseWriter, r *http.Request) {
	chosenLang := normalizeRequestedLanguageCode(r.URL.Query().Get("lang"))

	var translationMap map[string]string
	var err error
	if _, isLegacyColumn := legacyLanguageColumns[chosenLang]; isLegacyColumn {
		translationMap, err = readLegacyTranslationMap(chosenLang)
	} else {
		translationMap, err = readCanonicalTranslationMap(chosenLang)
		if err != nil {
			log.Printf("[GetTranslationsHandler] canonical locale %q unavailable, falling back to English: %v", chosenLang, err)
			translationMap, err = readLegacyTranslationMap("en")
		}
	}
	if err == nil && len(translationMap) == 0 && chosenLang != "en" {
		translationMap, err = readLegacyTranslationMap("en")
	}
	if err != nil {
		log.Printf("\033[31merror: translations query failed: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	w.Header().Set("Content-Type", "application/json")

	// DEV_MODE: palauttaa lisäksi orphan-avainlistan, jotta frontend voi varoittaa
	// käytössä olevista orvoista. Tuotannossa palautetaan pelkkä flat map.
	devMode := strings.ToLower(os.Getenv("DEV_MODE"))
	if devMode == "true" || devMode == "1" {
		orphanKeys := fetchOrphanLangKeyNames()
		wrapped := map[string]interface{}{
			"translations": translationMap,
			"orphan_keys":  orphanKeys,
		}
		if err := json.NewEncoder(w).Encode(wrapped); err != nil {
			fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "internal server error")
		}
		return
	}

	if err := json.NewEncoder(w).Encode(translationMap); err != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "internal server error")
		return
	}
}

// GetLangKeyTranslationsHandler returns fi/en/ch/yue values and one usage explanation for a single lang key.
func GetLangKeyTranslationsHandler(w http.ResponseWriter, r *http.Request) {
	langKey := strings.TrimSpace(r.URL.Query().Get("lang_key"))
	if langKey == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "missing 'lang_key' parameter")
		return
	}

	var fi, en, ch, yue sql.NullString
	err := backend.Db.QueryRow(
		"SELECT fi, en, ch, yue FROM system_lang_keys WHERE lang_key = $1",
		langKey,
	).Scan(&fi, &en, &ch, &yue)

	result := map[string]string{
		"fi":                "",
		"en":                "",
		"ch":                "",
		"yue":               "",
		"usage_explanation": "",
	}

	if err == nil {
		if fi.Valid {
			result["fi"] = fi.String
		}
		if en.Valid {
			result["en"] = en.String
		}
		if ch.Valid {
			result["ch"] = ch.String
		}
		if yue.Valid {
			result["yue"] = yue.String
		}
	}

	// Hae usage_explanation system_lang_key_sources -taulusta (paras match)
	var explanation sql.NullString
	_ = backend.Db.QueryRow(`
		SELECT s.usage_explanation
		FROM system_lang_key_sources s
		JOIN system_lang_keys k ON k.id = s.lang_key_id
		WHERE k.lang_key = $1 AND s.usage_explanation != ''
		ORDER BY
			CASE WHEN s.source_type = 'dataset_header' THEN 0
			     WHEN s.source_type = 'code' THEN 1
			     ELSE 2 END,
			s.id
		LIMIT 1
	`, langKey).Scan(&explanation)
	if explanation.Valid {
		result["usage_explanation"] = explanation.String
	}

	w.Header().Set("Content-Type", "application/json")
	if encErr := json.NewEncoder(w).Encode(result); encErr != nil {
		fmt.Printf("\033[31m[GetLangKeyTranslationsHandler] encode error: %s\033[0m\n", encErr.Error())
	}
}

// UpdateLangKeyHandler upserts one lang key and optional usage explanation from the dev editor.
// Between the browser editor and translation storage, it delegates to the shared strict write path.
// The route remains development-only so production automation uses the explicitly protected admin API.
func UpdateLangKeyHandler(w http.ResponseWriter, r *http.Request) {
	handleLangKeyUpdate(w, r, "dev_editor", "dev_lang_key_editor")
}

// AiTranslateSingleHandler returns AI suggestions for one lang key before the user saves them.
func AiTranslateSingleHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "POST only")
		return
	}

	var req aiTranslateSingleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if strings.TrimSpace(req.LangKey) == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "missing lang_key")
		return
	}

	systemMessage := singleKeyAITranslatorSystemMessage()
	userMessage := singleKeyAITranslatorUserMessage(req)

	rawText, err := chatCompletionForTranslation(r.Context(), systemMessage, userMessage)
	if err != nil {
		log.Printf("[AiTranslateSingle] LLM error: %v", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("AI error: %v", err))
		return
	}

	cleanText := extractJSONFromLLMResponse(rawText)
	var result map[string]string
	if err := json.Unmarshal([]byte(cleanText), &result); err != nil {
		log.Printf("[AiTranslateSingle] parse error: %v (raw: %s)", err, rawText)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "could not parse AI response")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

type aiTranslateSingleRequest struct {
	LangKey          string `json:"lang_key"`
	UsageExplanation string `json:"usage_explanation"`
	Fi               string `json:"fi"`
	En               string `json:"en"`
	Ch               string `json:"ch"`
	Yue              string `json:"yue"`
}

// singleKeyAITranslatorSystemMessage resolves the prompt for one-key dev editor translations.
// Between the dev lang-key editor and LLM provider, it avoids the bulk translator prompt contract.
// This keeps the endpoint expecting a JSON object even when batch translation uses a JSON array.
func singleKeyAITranslatorSystemMessage() string {
	if systemMessage := strings.TrimSpace(os.Getenv("AI_TRANSLATOR_SINGLE_SYSTEM_MESSAGE")); systemMessage != "" {
		return systemMessage
	}

	return `You are a UI translator. If the request includes non-empty current editor values, those values are the authoritative UI copy and must be preserved unchanged for their own language. Use them to fill missing languages. If no current editor values are present, use the usage explanation as the primary source, not the key name. Treat technical keys, table names, and column names as disambiguation only unless they are actual UI copy. Return only one valid JSON object with string keys "en", "fi", "ch", and "yue". Use Traditional Chinese Cantonese for "yue".`
}

// singleKeyAITranslatorUserMessage builds the one-key prompt from current editor values.
// Between the dev lang-key editor payload and LLM provider, it preserves existing polished text.
// This prevents AI fill from replacing good UI copy with literal technical table/column labels.
func singleKeyAITranslatorUserMessage(req aiTranslateSingleRequest) string {
	return fmt.Sprintf(`A UI lang key needs translations into English ("en"), Finnish ("fi"), Simplified Chinese ("ch"), and Traditional Chinese Cantonese ("yue").

Technical key name, for disambiguation only: "%s"
Usage/context, for disambiguation only:
%s

Current editor values:
en: %q
fi: %q
ch: %q
yue: %q

Rules:
- Non-empty current editor values are authoritative UI copy. Return them unchanged for their own language.
- Fill missing languages from the best existing UI text, preferring English, then Finnish, then Chinese.
- Use the technical key and usage/context only to understand where the text appears. Do not translate technical identifiers such as app_service_catalog, table names, or column names unless they are the actual UI copy.
- Keep UI text concise and polished. For search placeholders, use short placeholder wording such as "Search for services", "Etsi palveluita", or "搜索服务".
- Avoid explanatory prefixes, quotes, trailing punctuation, and literal words for table/column unless they are present in the authoritative UI copy.

Return ONLY valid JSON: {"en": "...", "fi": "...", "ch": "...", "yue": "..."}`,
		req.LangKey,
		strings.TrimSpace(req.UsageExplanation),
		strings.TrimSpace(req.En),
		strings.TrimSpace(req.Fi),
		strings.TrimSpace(req.Ch),
		strings.TrimSpace(req.Yue),
	)
}

// fetchOrphanLangKeyNames hakee orvoksi merkittyjen kieliavainten nimet.
// Kutsutaan vain DEV_MODE-tilassa translations-endpointista.
func fetchOrphanLangKeyNames() []string {
	rows, err := backend.Db.Query(`
		SELECT slk.lang_key
		FROM system_lang_key_sources slks
		JOIN system_lang_keys slk ON slk.id = slks.lang_key_id
		WHERE slks.source_type = 'orphan'
		ORDER BY slk.lang_key
	`)
	if err != nil {
		fmt.Printf("\033[31m[fetchOrphanLangKeyNames] error: %s\033[0m\n", err.Error())
		return []string{}
	}
	defer rows.Close()

	var keys []string
	for rows.Next() {
		var keyName string
		if err := rows.Scan(&keyName); err == nil {
			keys = append(keys, keyName)
		}
	}
	if err := rows.Err(); err != nil {
		fmt.Printf("\033[31m[fetchOrphanLangKeyNames] rows iteration error: %s\033[0m\n", err.Error())
	}
	return keys
}
