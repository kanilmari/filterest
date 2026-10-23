// app_db_compatibility_lang_keys.go
// Ensures startup-owned lang keys exist for app↔DB compatibility admin surfaces.
// Bridges the system_app_db_compatibility mirror dataset and system_lang_keys translations.
// Exists so the mirror table is discoverable through multilingual admin trees without manual seeding.
package startup

import (
	"database/sql"
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
	ensureStartupLangKeySeeds(db, appDBCompatibilityLangKeySeeds, "app/db compatibility")
}
