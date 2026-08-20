// admin_lang_key.go
// Persists one reviewed language key through an administrator-only HTTP API.
// Bridges authenticated agent/admin clients with legacy and normalized translation tables.
// Exists so production language maintenance never needs direct SQL or a development-only route.
package lang

import (
	"context"
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
	LangKey          string `json:"lang_key"`
	Fi               string `json:"fi"`
	En               string `json:"en"`
	Ch               string `json:"ch"`
	Yue              string `json:"yue"`
	UsageExplanation string `json:"usage_explanation"`
}

var persistLangKeyUpdate = persistLangKeyUpdateTransactionally

// AdminLangKeyHandler saves one reviewed language key through the full admin pipeline.
// Between authenticated API clients and translation storage, it accepts only POST and requires a request transaction.
// This is the production-safe counterpart to the development-only language-key editor route.
func AdminLangKeyHandler(w http.ResponseWriter, r *http.Request) {
	handleLangKeyUpdate(w, r, "admin_api", "admin_lang_key")
}

// handleLangKeyUpdate validates the exact write payload before persistence.
// Between either approved editor route and the transactional store, it fixes the source identity server-side.
// This prevents callers from selecting an untrusted provenance label or sending undeclared fields.
func handleLangKeyUpdate(w http.ResponseWriter, r *http.Request, sourceType, sourceHigh string) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

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

// persistLangKeyUpdateTransactionally synchronizes legacy values, canonical fi/en rows, and source context.
// Between the lazy request transaction and normalized language tables, every write succeeds or rolls back together.
// This prevents the public language map and legacy editor model from drifting after an administrator update.
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

	if _, err := tx.Exec(`
		INSERT INTO system_lang_keys (lang_key, fi, en, ch, yue, updated)
		VALUES ($1, $2, $3, $4, $5, NOW())
		ON CONFLICT (lang_key) DO UPDATE
		SET fi = EXCLUDED.fi,
		    en = EXCLUDED.en,
		    ch = EXCLUDED.ch,
		    yue = EXCLUDED.yue,
		    updated = NOW()
	`, request.LangKey, request.Fi, request.En, request.Ch, request.Yue); err != nil {
		return err
	}

	var langKeyID int64
	if err := tx.QueryRow(
		"SELECT id FROM system_lang_keys WHERE lang_key = $1",
		request.LangKey,
	).Scan(&langKeyID); err != nil {
		return err
	}

	for _, translation := range []struct {
		languageCode string
		value        string
	}{
		{languageCode: "fi", value: strings.TrimSpace(request.Fi)},
		{languageCode: "en", value: strings.TrimSpace(request.En)},
	} {
		if translation.value == "" {
			if _, err := tx.Exec(`
				DELETE FROM system_lang_key_translations
				WHERE lang_key_id = $1
				  AND language_code = $2
			`, langKeyID, translation.languageCode); err != nil {
				return err
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
			SELECT $1, languages.language_code, $3, 'manual', 'approved'
			FROM system_languages AS languages
			WHERE languages.language_code = $2
			ON CONFLICT (lang_key_id, language_code) DO UPDATE
			SET translation = EXCLUDED.translation,
			    source_kind = EXCLUDED.source_kind,
			    review_status = EXCLUDED.review_status,
			    updated = NOW()
		`, langKeyID, translation.languageCode, translation.value); err != nil {
			return err
		}
	}

	if strings.TrimSpace(request.UsageExplanation) != "" {
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
		`, langKeyID, sourceType, sourceHigh, request.UsageExplanation); err != nil {
			return err
		}
	}

	return nil
}
