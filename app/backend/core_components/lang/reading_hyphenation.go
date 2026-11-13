// reading_hyphenation.go
// Persists the site reading policy alongside administrator language settings.
package lang

import (
	"context"
	"database/sql"
	"encoding/json"
	"log"
	"net/http"

	"easelect/backend/core_components/httpresponse"
)

type hyphenationReader interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func readReadingHyphenation(ctx context.Context, db hyphenationReader) (readingHyphenation, error) {
	policy := readingHyphenation{Finnish: true}
	var raw []byte
	err := db.QueryRowContext(ctx, `SELECT json_value FROM public.system_config WHERE key='reading_hyphenation'`).Scan(&raw)
	if err == sql.ErrNoRows {
		return policy, nil
	}
	if err != nil {
		return policy, err
	}
	err = json.Unmarshal(raw, &policy)
	return policy, err
}

func saveReadingHyphenation(ctx context.Context, tx *sql.Tx, policy readingHyphenation) error {
	raw, err := json.Marshal(policy)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO public.system_config (key, json_value, value_type, creation_spec, updated)
        VALUES ('reading_hyphenation', $1::jsonb, 5, 'Language-specific reading hyphenation.', NOW())
        ON CONFLICT (key) DO UPDATE SET json_value=excluded.json_value, value_type=5, updated=NOW()`, string(raw))
	return err
}

func respondLanguageSettings(w http.ResponseWriter, r *http.Request, db hyphenationReader, languages []uiLanguageSetting) {
	policy, err := readReadingHyphenation(r.Context(), db)
	if err != nil {
		log.Printf("read reading hyphenation: %v", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "failed to read language settings")
		return
	}
	httpresponse.RespondWithJSON(w, http.StatusOK, uiLanguageSettingsResponse{Languages: languages, ReadingHyphenation: policy})
}
