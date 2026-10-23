// startup_lang_key_seed.go
// Inserts startup language keys and fills only language values that are missing.
// Connects login and compatibility seed catalogues to one shared SQL policy.
// Exists so adding bootstrap copy cannot overwrite a site's reviewed translations.
package startup

import (
	"database/sql"
	"log"
)

func ensureStartupLangKeySeeds(db *sql.DB, seeds []startupLangKeySeed, scope string) {
	const upsertQuery = `
		INSERT INTO system_lang_keys (lang_key, fi, en, ch)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (lang_key) DO UPDATE
			SET fi = CASE WHEN system_lang_keys.fi IS NULL OR system_lang_keys.fi = '' THEN EXCLUDED.fi ELSE system_lang_keys.fi END,
			    en = CASE WHEN system_lang_keys.en IS NULL OR system_lang_keys.en = '' THEN EXCLUDED.en ELSE system_lang_keys.en END,
			    ch = CASE WHEN system_lang_keys.ch IS NULL OR system_lang_keys.ch = '' THEN EXCLUDED.ch ELSE system_lang_keys.ch END
	`

	for _, seed := range seeds {
		if _, err := db.Exec(upsertQuery, seed.langKey, seed.fi, seed.en, seed.ch); err != nil {
			log.Printf("[STARTUP] Error upserting %s lang key %q: %v", scope, seed.langKey, err)
		}
	}
}
