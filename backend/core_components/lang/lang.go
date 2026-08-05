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

// hyväksytyt kielisarakkeet: 2-3 kirjainta + vapaaehtoisesti 0-2 numeroa
var langColRegexp = regexp.MustCompile(`^[a-z]{2,3}[0-9]{0,2}$`)

// GetTranslationsHandler returns the chosen language map and optional dev-only orphan-key metadata.
func GetTranslationsHandler(w http.ResponseWriter, r *http.Request) {
	chosenLang := r.URL.Query().Get("lang")
	if !langColRegexp.MatchString(chosenLang) {
		chosenLang = "en" // fallback turvalliseen oletukseen
	}

	// QuoteIdentifier estää merkkijono-temput sarake-tunnisteessa
	colName := pq.QuoteIdentifier(chosenLang)
	queryStr := fmt.Sprintf(`SELECT lang_key, %s FROM system_lang_keys`, colName)

	rows, err := backend.Db.Query(queryStr)
	if err != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	defer rows.Close()

	translationMap := make(map[string]string)
	for rows.Next() {
		var key string
		var val sql.NullString
		if err := rows.Scan(&key, &val); err != nil {
			fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		translationMap[key] = val.String
	}
	if err := rows.Err(); err != nil {
		log.Printf("\033[31merror: rows iteration error in GetTranslationsHandler: %v\033[0m", err)
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
func UpdateLangKeyHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "POST only")
		return
	}

	var req struct {
		LangKey          string `json:"lang_key"`
		Fi               string `json:"fi"`
		En               string `json:"en"`
		Ch               string `json:"ch"`
		Yue              string `json:"yue"`
		UsageExplanation string `json:"usage_explanation"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if strings.TrimSpace(req.LangKey) == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "missing lang_key")
		return
	}

	// Upsert: luo avain jos ei ole olemassa, muuten päivitä
	_, err := backend.Db.Exec(`
		INSERT INTO system_lang_keys (lang_key, fi, en, ch, yue, updated)
		VALUES ($1, $2, $3, $4, $5, NOW())
		ON CONFLICT (lang_key) DO UPDATE
		SET fi = EXCLUDED.fi, en = EXCLUDED.en, ch = EXCLUDED.ch,
		    yue = EXCLUDED.yue, updated = NOW()
	`, req.LangKey, req.Fi, req.En, req.Ch, req.Yue)
	if err != nil {
		log.Printf("\033[31m[UpdateLangKeyHandler] DB error: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "database error")
		return
	}

	// Tallenna usage_explanation system_lang_key_sources -tauluun (dev_editor source)
	if req.UsageExplanation != "" {
		var langKeyID int64
		idErr := backend.Db.QueryRow(
			"SELECT id FROM system_lang_keys WHERE lang_key = $1", req.LangKey,
		).Scan(&langKeyID)
		if idErr == nil {
			_, _ = backend.Db.Exec(`
				INSERT INTO system_lang_key_sources (lang_key_id, source_type, source_high, usage_explanation, last_seen)
				VALUES ($1, 'dev_editor', 'dev_lang_key_editor', $2, CURRENT_DATE)
				ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE
				SET usage_explanation = EXCLUDED.usage_explanation, last_seen = CURRENT_DATE
			`, langKeyID, req.UsageExplanation)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":  true,
		"lang_key": req.LangKey,
	})
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
