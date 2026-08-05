// get_ai_translations.go
// AI translation handlers that generate missing lang-key values and persist accepted results.
// Bridges translation-related HTTP requests, LLM provider helpers, and system_lang_keys/source tables.
// Exists to fill untranslated keys in bulk without forcing manual entry for every locale.
package lang

import (
	"bytes"
	"context"
	"easelect/backend/core_components/httpresponse"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"

	backend "easelect/backend/core_components"
	e_sessions "easelect/backend/core_components/sessions"
)

// GenerateTranslationsRequest is the frontend payload for bulk missing-key translation requests.
type GenerateTranslationsRequest struct {
	MissingKeys    []string          `json:"missing_keys"`
	ChosenLanguage string            `json:"chosen_language"`
	Sources        map[string]string `json:"sources,omitempty"` // Vapaaehtoinen: avain → lähdetieto ("source_high::source_low")
}

// AiTranslationItem is one translation object returned by the LLM response:
// [
//
//	{
//	  "lang_key": "foo",
//	  "en": "Some English text",
//	  "fi": "Jotain suomeksi"
//	},
//	...
//
// ]
type AiTranslationItem struct {
	LangKey string `json:"lang_key"`
	En      string `json:"en,omitempty"`
	Fi      string `json:"fi,omitempty"`
}

func isSyntheticE2ETranslationKey(key string) bool {
	normalized := strings.ToLower(strings.TrimSpace(key))
	return strings.HasPrefix(normalized, "e2e_") || strings.HasPrefix(normalized, "e2e-")
}

func filterAIEligibleMissingKeys(keys []string) ([]string, int) {
	filtered := make([]string, 0, len(keys))
	skipped := 0
	for _, key := range keys {
		trimmed := strings.TrimSpace(key)
		if trimmed == "" {
			continue
		}
		if isSyntheticE2ETranslationKey(trimmed) {
			skipped++
			continue
		}
		filtered = append(filtered, trimmed)
	}
	return filtered, skipped
}

// GenerateTranslationsHandler generates missing translations, saves them, and returns the same items to the frontend.
func GenerateTranslationsHandler(w http.ResponseWriter, r *http.Request) {
	// 1. Luetaan body heti alussa, jotta saadaan puuttuvat avaimet lokiin
	// riippumatta siitä, onko käyttäjä kirjautunut vai ei.
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, fmt.Sprintf("error reading body: %v", err))
		return
	}
	// Palautetaan body luettavaksi myöhempää käyttöä varten (jos tarpeen)
	// Tässä tapauksessa dekoodaamme sen suoraan muuttujaan.
	r.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))

	var requestData GenerateTranslationsRequest
	if err := json.Unmarshal(bodyBytes, &requestData); err != nil {
		// Jos JSON on rikki, ei voida tehdä mitään
		httpresponse.RespondWithError(w, http.StatusBadRequest, fmt.Sprintf("error decoding JSON: %v", err))
		return
	}

	// Lokitetaan puuttuvat avaimet (jos niitä on)
	if len(requestData.MissingKeys) > 0 {
		log.Printf("[GenerateTranslations] requested missing keys (%d): %v", len(requestData.MissingKeys), requestData.MissingKeys)
	}

	filteredKeys, skippedSyntheticKeys := filterAIEligibleMissingKeys(requestData.MissingKeys)
	if skippedSyntheticKeys > 0 {
		log.Printf("[GenerateTranslations] skipping %d synthetic E2E key(s)", skippedSyntheticKeys)
	}
	requestData.MissingKeys = filteredKeys

	if strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Bypass-Ratelimit")), "test-mode") {
		log.Printf("[GenerateTranslations] skipping AI translation for test-mode request")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]AiTranslationItem{})
		return
	}

	// 2. Tarkistetaan kirjautuminen manuaalisesti
	session, err := e_sessions.GetOrCreateSession(w, r)
	if err != nil {
		// Jos sessiota ei saada, palautetaan tyhjä lista (ei virhettä, ettei frontti kaadu)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]AiTranslationItem{})
		return
	}

	userID, ok := session.Values["user_id"]
	if !ok || userID == nil {
		// Ei kirjautunut -> ei generoida käännöksiä (säästetään AI-kustannuksia)
		// Mutta lokitus yllä on jo tapahtunut, joten näemme mitä puuttuu.
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]AiTranslationItem{})
		return
	}

	// Jos ei puuttuvia avaimia, lopetetaan tähän
	if len(requestData.MissingKeys) == 0 {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]AiTranslationItem{})
		return
	}

	systemMessage := os.Getenv("AI_TRANSLATOR_SYSTEM_MESSAGE")
	if systemMessage == "" {
		log.Printf("[GenerateTranslations] AI_TRANSLATOR_SYSTEM_MESSAGE missing — skipping")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]AiTranslationItem{})
		return
	}

	// Tarkistetaan että vähintään yksi LLM-provider on konfiguroitu
	if _, cfgErr := resolveTranslationLLMConfig(); cfgErr != nil {
		log.Printf("[GenerateTranslations] %v — skipping", cfgErr)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]AiTranslationItem{})
		return
	}

	// Haetaan usage_explanation-kontekstit source-recordeista puuttuville avaimille
	descriptions := fetchUsageExplanations(requestData.MissingKeys)

	// Haetaan käännökset AI:sta (molemmille kielille)
	items, err := getAllTranslationsFromAI(
		r.Context(),
		systemMessage,
		requestData.MissingKeys,
		descriptions,
	)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("\033[31merror: %s\033[0m", err.Error()))
		return
	}

	// Tallennetaan AI:n palauttamat kentät (en, fi) kantaan
	// ja kerätään sama data taulukkoon, jotta frontti saa sen heti
	for _, item := range items {
		if err := saveMultiLangTranslationToDatabase(item); err != nil {
			httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("\033[31merror: %s\033[0m", err.Error()))
			return
		}
	}

	// Tallennetaan lähdetiedot system_lang_key_sources -tauluun
	saveLangKeySources(requestData.MissingKeys, requestData.Sources)

	w.Header().Set("Content-Type", "application/json")
	// Palautetaan taulukko samassa muodossa, esim.
	// [ { "lang_key": "...", "en": "...", "fi": "..."}, ... ]
	if err := json.NewEncoder(w).Encode(items); err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("\033[31merror: %s\033[0m", err.Error()))
	}
}

// getAllTranslationsFromAI asks the configured LLM for en/fi pairs for the requested lang keys.
func getAllTranslationsFromAI(
	ctx context.Context,
	systemMessage string,
	missingKeys []string,
	descriptions map[string]string,
) ([]AiTranslationItem, error) {

	// Muodostetaan avainlista promptiin — jos avaimella on description,
	// lisätään se kontekstiksi selkeästi
	var keyLines []string
	for _, key := range missingKeys {
		if desc, ok := descriptions[key]; ok && desc != "" {
			keyLines = append(keyLines, fmt.Sprintf("  - \"%s\" (context: %s)", key, desc))
		} else {
			keyLines = append(keyLines, fmt.Sprintf("  - \"%s\"", key))
		}
	}
	keysWithContext := strings.Join(keyLines, "\n")

	userMessage := fmt.Sprintf(`Translate these keys into both English ("en") and Finnish ("fi"). 
Return ONLY valid JSON array of objects. 
Each object has: "lang_key", "en", "fi". 
Use this structure example:

[
  {
    "lang_key": "some_key",
    "en": "English text",
    "fi": "Suomenkielinen teksti"
  }
]

Some keys may include a "(context: ...)" hint explaining what the key means.
Use that context to produce a more accurate and natural translation.
The context description is NOT part of the translation — it only helps you understand the intended meaning.

Here are the keys:
%s`, keysWithContext)

	rawText, err := chatCompletionForTranslation(ctx, systemMessage, userMessage)
	if err != nil {
		return nil, err
	}

	// Parsitaan AI:n vastaus suoraan []AiTranslationItem -tauluksi
	// LLM voi kääriä JSON:in markdown-koodiblokkiin (```json ... ```)
	cleanText := extractJSONFromLLMResponse(rawText)
	var items []AiTranslationItem
	if err := json.Unmarshal([]byte(cleanText), &items); err != nil {
		return nil, fmt.Errorf("json unmarshal error: %w\n(ai response: %s)", err, rawText)
	}

	return items, nil
}

// saveMultiLangTranslationToDatabase upserts en/fi values without overwriting existing non-empty translations.
func saveMultiLangTranslationToDatabase(item AiTranslationItem) error {
	query := `
        INSERT INTO system_lang_keys (lang_key, en, fi)
        VALUES ($1, $2, $3)
        ON CONFLICT (lang_key) DO UPDATE 
          SET en = CASE
                      WHEN system_lang_keys.en IS NULL OR system_lang_keys.en = '' 
                      THEN EXCLUDED.en
                      ELSE system_lang_keys.en
                    END,
              fi = CASE
                      WHEN system_lang_keys.fi IS NULL OR system_lang_keys.fi = '' 
                      THEN EXCLUDED.fi
                      ELSE system_lang_keys.fi
                    END
    `
	_, err := backend.Db.Exec(query, item.LangKey, item.En, item.Fi)
	return err
}

// fetchUsageExplanations returns one non-empty usage explanation per lang key for prompt context.
func fetchUsageExplanations(keys []string) map[string]string {
	explanations := make(map[string]string)
	if len(keys) == 0 {
		return explanations
	}

	placeholders := make([]string, len(keys))
	args := make([]interface{}, len(keys))
	for i, key := range keys {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
		args[i] = key
	}

	// Haetaan DISTINCT ON (lang_key) jotta saadaan yksi selitys per avain.
	// Priorisoidaan source_type='dataset_header' yli 'code' yli muun skeeman,
	// jotta adminin syottama ideatason konteksti voittaa geneerisen koodikontekstin
	// juuri dataset-header-avaimille.
	query := fmt.Sprintf(`
		SELECT DISTINCT ON (k.lang_key) k.lang_key, s.usage_explanation
		FROM system_lang_key_sources s
		JOIN system_lang_keys k ON k.id = s.lang_key_id
		WHERE k.lang_key IN (%s)
		  AND s.usage_explanation != ''
		ORDER BY k.lang_key,
		         CASE
		             WHEN s.source_type = 'dataset_header' THEN 0
		             WHEN s.source_type = 'code' THEN 1
		             ELSE 2
		         END,
		         s.id`,
		strings.Join(placeholders, ", "))

	rows, err := backend.Db.Query(query, args...)
	if err != nil {
		log.Printf("[fetchUsageExplanations] error: %v", err)
		return explanations
	}
	defer rows.Close()

	for rows.Next() {
		var key, explanation string
		if err := rows.Scan(&key, &explanation); err == nil {
			explanations[key] = explanation
		}
	}
	if err := rows.Err(); err != nil {
		log.Printf("[fetchUsageExplanations] rows iteration error: %v", err)
	}

	return explanations
}

// saveLangKeySources tallentaa kieliavainten lähdetiedot system_lang_key_sources
// -tauluun. Frontti lähettää sources-mapin (avain → "source_high::source_low").
// Lisäksi tunnistetaan automaattisesti skeema-avaimet (sarake/taulunimet).
func saveLangKeySources(keys []string, frontendSources map[string]string) {
	if len(keys) == 0 {
		return
	}

	// Haetaan sarake→taulut -mappaus ja taulunimet skeema-avainten tunnistusta varten.
	// columnToTables: {"created": ["app_service_catalog", "system_users", ...], ...}
	columnToTables := fetchColumnToTables()
	tableNames := fetchTableNames()

	upsertQuery := `
		INSERT INTO system_lang_key_sources (lang_key_id, source_type, source_high, source_low, last_seen)
		VALUES ($1, $2, $3, $4, CURRENT_DATE)
		ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE
		  SET source_low = EXCLUDED.source_low,
		      last_seen = CURRENT_DATE
	`

	for _, key := range keys {
		// Hae lang_key_id
		var langKeyID int64
		err := backend.Db.QueryRow(
			"SELECT id FROM system_lang_keys WHERE lang_key = $1", key,
		).Scan(&langKeyID)
		if err != nil {
			// Avain ei vielä kannassa (tai virhe) — ohitetaan
			continue
		}

		// Skeema-avainten tunnistus: lisätään yksi rivi per taulu jossa sarake/taulu
		// esiintyy. Dynamic key -logiikka pidetään samana kuin startupin source-scanissa.
		schemaRefs := resolveSchemaSourceRefsForLangKey(key, columnToTables, tableNames)
		schemaSaved := len(schemaRefs) > 0

		for _, schemaRef := range schemaRefs {
			if _, err := backend.Db.Exec(
				upsertQuery,
				langKeyID,
				schemaRef.sourceType,
				schemaRef.sourceHigh,
				schemaRef.sourceLow,
			); err != nil {
				log.Printf("[saveLangKeySources] error for key %s (id=%d): %v", key, langKeyID, err)
			}
		}

		// Frontend-lähde tai tuntematon
		if !schemaSaved {
			sourceType := "code"
			sourceHigh := "unknown"
			sourceLow := ""
			if src, ok := frontendSources[key]; ok && src != "" {
				parts := strings.SplitN(src, "::", 2)
				sourceHigh = parts[0]
				if len(parts) > 1 {
					sourceLow = parts[1]
				}
			}
			if _, err := backend.Db.Exec(upsertQuery, langKeyID, sourceType, sourceHigh, sourceLow); err != nil {
				log.Printf("[saveLangKeySources] error for key %s (id=%d): %v", key, langKeyID, err)
			}
		}

		// De-orphaning: VAIN skeema-lähteillä (column/table) poistetaan orphan-merkintä.
		// Nämä ovat konkreettisia todisteita: avain viittaa olemassaolevaan sarakkeeseen/tauluun.
		// "code"/"unknown"-lähteillä EI de-orphanoida, koska ne voivat johtaa pallotteluun:
		// startup merkitsisi orvoksi → frontend käyttäisi → de-orphanoisi → seuraava restart → orpo taas.
		if schemaSaved {
			result, delErr := backend.Db.Exec(
				"DELETE FROM system_lang_key_sources WHERE lang_key_id = $1 AND source_type = 'orphan'",
				langKeyID,
			)
			if delErr != nil {
				log.Printf("[saveLangKeySources] orphan deletion error id=%d: %v", langKeyID, delErr)
			} else if affected, _ := result.RowsAffected(); affected > 0 {
				devMode := strings.ToLower(os.Getenv("DEV_MODE"))
				if devMode == "true" || devMode == "1" {
					log.Printf("[saveLangKeySources] ★ De-orphaned: key '%s' (id=%d) — no longer orphaned",
						key, langKeyID)
				}
			}
		}
	}
}

// fetchColumnToTables hakee sarake→taulut -mappauksen.
// Palauttaa: {"created": ["app_service_catalog", "system_users", ...], ...}
func fetchColumnToTables() map[string][]string {
	result := make(map[string][]string)
	rows, err := backend.Db.Query(`
		SELECT cd.column_name, dt.table_name
		FROM system_column_details cd
		JOIN system_db_tables dt ON cd.table_uid = dt.table_uid
		ORDER BY cd.column_name, dt.table_name
	`)
	if err != nil {
		log.Printf("[fetchColumnToTables] error: %v", err)
		return result
	}
	defer rows.Close()
	for rows.Next() {
		var colName, tableName string
		if err := rows.Scan(&colName, &tableName); err == nil {
			result[colName] = append(result[colName], tableName)
		}
	}
	if err := rows.Err(); err != nil {
		log.Printf("[fetchColumnToTables] rows iteration error: %v", err)
	}
	return result
}

// fetchTableNames hakee kaikki taulunimet tietokannasta skeema-avainten tunnistamista varten.
func fetchTableNames() map[string]bool {
	result := make(map[string]bool)
	rows, err := backend.Db.Query("SELECT DISTINCT table_name FROM system_db_tables")
	if err != nil {
		log.Printf("[fetchTableNames] error: %v", err)
		return result
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err == nil && name != "" {
			result[name] = true
		}
	}
	if err := rows.Err(); err != nil {
		log.Printf("[fetchTableNames] rows iteration error: %v", err)
	}
	return result
}
