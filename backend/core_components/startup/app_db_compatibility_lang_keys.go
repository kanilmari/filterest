// app_db_compatibility_lang_keys.go
// Ensures startup-owned lang keys exist for app↔DB compatibility admin surfaces.
// Bridges the system_app_db_compatibility mirror dataset and system_lang_keys translations.
// Exists so the mirror table is discoverable through multilingual admin trees without manual seeding.
package startup

import (
	"database/sql"
	"log"
)

type startupLangKeySeed struct {
	langKey string
	fi      string
	en      string
	ch      string
}

var appDBCompatibilityLangKeySeeds = []startupLangKeySeed{
	{
		langKey: "system_app_db_compatibility",
		fi:      "Sovellus- ja tietokantayhteensopivuus",
		en:      "App DB Compatibility",
		ch:      "应用与数据库兼容性",
	},
}

// EnsureAppDBCompatibilityLangKeys seeds the admin-tree translation keys needed by
// the startup-managed app↔DB compatibility mirror dataset.
func EnsureAppDBCompatibilityLangKeys(db *sql.DB) {
	const upsertQuery = `
		INSERT INTO system_lang_keys (lang_key, fi, en, ch)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (lang_key) DO UPDATE
			SET fi = CASE WHEN system_lang_keys.fi IS NULL OR system_lang_keys.fi = '' THEN EXCLUDED.fi ELSE system_lang_keys.fi END,
			    en = CASE WHEN system_lang_keys.en IS NULL OR system_lang_keys.en = '' THEN EXCLUDED.en ELSE system_lang_keys.en END,
			    ch = CASE WHEN system_lang_keys.ch IS NULL OR system_lang_keys.ch = '' THEN EXCLUDED.ch ELSE system_lang_keys.ch END
	`

	for _, seed := range appDBCompatibilityLangKeySeeds {
		_, err := db.Exec(upsertQuery, seed.langKey, seed.fi, seed.en, seed.ch)
		if err != nil {
			log.Printf("[STARTUP] Error upserting app/db compatibility lang key %q: %v", seed.langKey, err)
		}
	}
}
