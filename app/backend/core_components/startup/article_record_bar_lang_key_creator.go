// article_record_bar_lang_key_creator.go
// Creates the generic close label for the phone article's record bar at startup.
// Connects the shared insert-or-fill creator to legacy and normalized language storage.
// Keeps reviewed site copy intact without a migration or a database-version change.
package startup

import (
	"database/sql"
	"log"
)

var articleRecordBarLangKeySeeds = []startupLangKeySeed{
	{langKey: "close", fi: "Sulje", en: "Close", ch: "关闭"},
}

// EnsureArticleRecordBarLangKeys fills missing copy only. Chinese variants use
// the same needs_review status as neighbouring interface translations.
func EnsureArticleRecordBarLangKeys(db *sql.DB) {
	ensureStartupLangKeySeeds(db, articleRecordBarLangKeySeeds, "article record bar")
	// The shared legacy creator does not write normalized locales. Retain any
	// authored legacy text when filling them, and never replace a reviewed row.
	const normalizedQuery = `
		INSERT INTO system_lang_key_translations
			(lang_key_id, language_code, translation, source_kind, review_status)
		SELECT k.id, copy.language_code, copy.translation, 'manual', copy.review_status
		FROM system_lang_keys k
		CROSS JOIN LATERAL (VALUES
			('fi', k.fi, 'approved'),
			('en', k.en, 'approved'),
			('zh-CN', k.ch, 'needs_review'),
			('zh-TW', COALESCE(NULLIF(k.yue, ''), '關閉'), 'needs_review'),
			('zh-HK', COALESCE(NULLIF(k.yue, ''), '關閉'), 'needs_review')
		) AS copy(language_code, translation, review_status)
		JOIN system_languages languages ON languages.language_code = copy.language_code
		WHERE k.lang_key = 'close'
		ON CONFLICT (lang_key_id, language_code) DO UPDATE
		SET translation = EXCLUDED.translation,
		    source_kind = EXCLUDED.source_kind,
		    review_status = EXCLUDED.review_status
		WHERE system_lang_key_translations.translation IS NULL
		   OR system_lang_key_translations.translation = ''
	`
	if _, err := db.Exec(normalizedQuery); err != nil {
		log.Printf("[STARTUP] Error filling article record bar translations: %v", err)
	}
}
