// article_record_bar_lang_key_creator_test.go
// Checks close copy and fill-empty guards without accessing a database.
// Connects the startup catalogue to the package's existing SQL mock driver.
// Keeps all Chinese variants under review and preserves non-empty owner text.
package startup

import (
	"strings"
	"testing"
)

func TestArticleRecordBarCloseStartupCopy(t *testing.T) {
	if len(articleRecordBarLangKeySeeds) != 1 || articleRecordBarLangKeySeeds[0] != (startupLangKeySeed{
		langKey: "close", fi: "Sulje", en: "Close", ch: "关闭",
	}) {
		t.Fatal("unexpected close catalogue", articleRecordBarLangKeySeeds)
	}
}

func TestArticleRecordBarCloseStartupPreservesNonEmpty(t *testing.T) {
	db := newAppDBCompatibilityTestDB(t)
	defer db.Close()
	for range 2 {
		pushAppDBCompatibilityExec(appDBCompatibilityExec{rowsAffected: 1})
	}
	EnsureArticleRecordBarLangKeys(db)
	calls := snapshotAppDBCompatibilityCalls()
	if len(calls) != 2 {
		t.Fatalf("expected legacy and normalized inserts, got %d", len(calls))
	}
	for _, locale := range []string{"fi", "en", "ch"} {
		guard := "CASE WHEN system_lang_keys." + locale + " IS NULL OR system_lang_keys." + locale + " = '' THEN EXCLUDED." + locale + " ELSE system_lang_keys." + locale + " END"
		if !strings.Contains(calls[0], guard) {
			t.Fatal("missing fill-empty guard", locale)
		}
	}
	for _, locale := range []string{"zh-CN', k.ch", "zh-TW', COALESCE(NULLIF(k.yue, ''), '關閉')", "zh-HK', COALESCE(NULLIF(k.yue, ''), '關閉')"} {
		if !strings.Contains(calls[1], "('"+locale+", 'needs_review')") {
			t.Fatal("missing review status for", locale)
		}
	}
	if !strings.Contains(calls[1], "WHERE system_lang_key_translations.translation IS NULL") ||
		!strings.Contains(calls[1], "OR system_lang_key_translations.translation = ''") {
		t.Fatal("normalized copy must only fill missing values", calls[1])
	}
}
