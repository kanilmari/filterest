// admin_lang_key.go
// Persists one authored language-key patch through an administrator-only HTTP API.
// Bridges authenticated agent/admin clients with legacy and normalized translation tables.
// Exists so production language maintenance never needs direct SQL or a development-only route.
package lang

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
)

type langKeyUpdateRequest struct {
	LangKey          string  `json:"lang_key"`
	Fi               *string `json:"fi"`
	En               *string `json:"en"`
	Ch               *string `json:"ch"`
	Yue              *string `json:"yue"`
	UsageExplanation *string `json:"usage_explanation"`
}

var persistLangKeyUpdate = persistLangKeyUpdateTransactionally

// legacyLanguageMirror names the normalized rows the writer keeps equal to one legacy column.
type legacyLanguageMirror struct {
	column        string
	languageCodes []string
	reviewStatus  string
}

// legacyLanguageMirrors is the one statement of which normalized rows mirror each legacy column.
// The writer below fans a supplied value out by it; the rename merge reads it to decide whether a
// key already shows a language in either store.
var legacyLanguageMirrors = []legacyLanguageMirror{
	{column: "fi", languageCodes: []string{"fi"}, reviewStatus: "approved"},
	{column: "en", languageCodes: []string{"en"}, reviewStatus: "approved"},
	{column: "ch", languageCodes: []string{"zh-CN"}, reviewStatus: "needs_review"},
	{column: "yue", languageCodes: []string{"yue", "zh-TW", "zh-HK"}, reviewStatus: "needs_review"},
}

// AdminLangKeyHandler saves one authored language-key patch through the full admin pipeline.
// Between authenticated API clients and translation storage, it accepts only POST and requires a request transaction.
// This is the production-safe counterpart to the development-only language-key editor route.
func AdminLangKeyHandler(w http.ResponseWriter, r *http.Request) {
	handleLangKeyUpdate(w, r, "admin_api", "admin_lang_key")
}

// handleLangKeyUpdate validates the exact write payload before persistence.
// Between either approved editor route and the transactional store, it fixes the source identity server-side.
// This prevents callers from selecting an untrusted provenance label or sending undeclared fields.
func handleLangKeyUpdate(w http.ResponseWriter, r *http.Request, sourceType, sourceHigh string) {

	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var request langKeyUpdateRequest
	if err := decoder.Decode(&request); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	request.LangKey = strings.TrimSpace(request.LangKey)
	if request.LangKey == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "lang_key is required")
		return
	}
	if request.Fi == nil && request.En == nil && request.Ch == nil && request.Yue == nil && request.UsageExplanation == nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "at least one language-key field is required")
		return
	}

	if err := persistLangKeyUpdate(r.Context(), request, sourceType, sourceHigh); err != nil {
		log.Printf("[AdminLangKeyHandler] update failed: %v", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "failed to save language key")
		return
	}

	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]interface{}{
		"success":  true,
		"lang_key": request.LangKey,
	})
}

// persistLangKeyUpdateTransactionally synchronizes supplied legacy values, canonical locale rows, and source context.
// Between the lazy request transaction and normalized language tables, every write succeeds or rolls back together.
// Omitted fields retain their value and provenance; explicit values update only their owned language or source row.
func persistLangKeyUpdateTransactionally(
	ctx context.Context,
	request langKeyUpdateRequest,
	sourceType string,
	sourceHigh string,
) error {
	tx, ok := dbutils.RequireTx(ctx)
	if !ok {
		return errors.New("transaction start failed")
	}

	langKeyID, err := writeLangKeyTranslations(tx, request)
	if err != nil {
		return err
	}

	if request.UsageExplanation != nil && strings.TrimSpace(*request.UsageExplanation) == "" {
		if _, err := tx.Exec(`
			DELETE FROM system_lang_key_sources
			WHERE lang_key_id = $1
			  AND source_type = $2
			  AND source_high = $3
		`, langKeyID, sourceType, sourceHigh); err != nil {
			return err
		}
	} else if request.UsageExplanation != nil {
		if _, err := tx.Exec(`
			INSERT INTO system_lang_key_sources (
				lang_key_id,
				source_type,
				source_high,
				usage_explanation,
				last_seen
			)
			VALUES ($1, $2, $3, $4, CURRENT_DATE)
			ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE
			SET usage_explanation = EXCLUDED.usage_explanation,
			    last_seen = CURRENT_DATE
		`, langKeyID, sourceType, sourceHigh, *request.UsageExplanation); err != nil {
			return err
		}
	}

	return nil
}

// writeLangKeyTranslations is the one writer of authored language-key text in both stores.
// Between language maintenance, tree renames and the tables, it runs inside the caller's transaction.
// Omitted fields keep their value and provenance; a supplied value updates its legacy column and the
// normalized rows that mirror it, and an unchanged value keeps its source kind and review status.
func writeLangKeyTranslations(tx *sql.Tx, request langKeyUpdateRequest) (int64, error) {
	valueOrEmpty := func(value *string) string {
		if value == nil {
			return ""
		}
		return *value
	}

	if _, err := tx.Exec(`
		INSERT INTO system_lang_keys (lang_key, fi, en, ch, yue, updated)
		VALUES ($1, $2, $3, $4, $5, NOW())
		ON CONFLICT (lang_key) DO UPDATE
		SET fi = CASE WHEN $6 THEN EXCLUDED.fi ELSE system_lang_keys.fi END,
		    en = CASE WHEN $7 THEN EXCLUDED.en ELSE system_lang_keys.en END,
		    ch = CASE WHEN $8 THEN EXCLUDED.ch ELSE system_lang_keys.ch END,
		    yue = CASE WHEN $9 THEN EXCLUDED.yue ELSE system_lang_keys.yue END,
		    updated = NOW()
	`, request.LangKey, valueOrEmpty(request.Fi), valueOrEmpty(request.En), valueOrEmpty(request.Ch), valueOrEmpty(request.Yue),
		request.Fi != nil, request.En != nil, request.Ch != nil, request.Yue != nil); err != nil {
		return 0, err
	}

	var langKeyID int64
	if err := tx.QueryRow(
		"SELECT id FROM system_lang_keys WHERE lang_key = $1",
		request.LangKey,
	).Scan(&langKeyID); err != nil {
		return 0, err
	}

	suppliedValues := map[string]*string{"fi": request.Fi, "en": request.En, "ch": request.Ch, "yue": request.Yue}
	for _, mirror := range legacyLanguageMirrors {
		value := suppliedValues[mirror.column]
		if value == nil {
			continue
		}
		translationValue := *value
		for _, languageCode := range mirror.languageCodes {
			if strings.TrimSpace(translationValue) == "" {
				if _, err := tx.Exec(`
					DELETE FROM system_lang_key_translations
					WHERE lang_key_id = $1
					  AND language_code = $2
				`, langKeyID, languageCode); err != nil {
					return 0, err
				}
				continue
			}
			if _, err := tx.Exec(`
				INSERT INTO system_lang_key_translations (
					lang_key_id,
					language_code,
					translation,
					source_kind,
					review_status
				)
				SELECT $1, languages.language_code, $3, 'manual', $4
				FROM system_languages AS languages
				WHERE languages.language_code = $2
				ON CONFLICT (lang_key_id, language_code) DO UPDATE
				SET translation = EXCLUDED.translation,
				    source_kind = CASE
				        WHEN system_lang_key_translations.translation = EXCLUDED.translation
				        THEN system_lang_key_translations.source_kind
				        ELSE EXCLUDED.source_kind
				    END,
				    review_status = CASE
				        WHEN system_lang_key_translations.translation = EXCLUDED.translation
				        THEN system_lang_key_translations.review_status
				        ELSE EXCLUDED.review_status
				    END,
				    updated = NOW()
			`, langKeyID, languageCode, translationValue, mirror.reviewStatus); err != nil {
				return 0, err
			}
		}
	}

	return langKeyID, nil
}
