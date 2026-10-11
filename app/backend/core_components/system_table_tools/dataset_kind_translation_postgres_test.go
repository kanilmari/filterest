// dataset_kind_translation_postgres_test.go
// Proves canonical locale seeds and whitespace-safe upgrades with authored copy.
// Connects migration 76 to legacy fields and normalized translation records.
// Replays on an opt-in disposable cluster and preserves original text bytes.
package system_table_tools

import (
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

var kindLanguageKeys = []string{"table_kind", "kind_version", "kind_config", "dataset_kind_evidence_unavailable"}
var kindCanonicalLocales = []string{"fi", "en", "zh-CN", "zh-TW", "zh-HK"}

func assertKindCanonicalTranslations(t *testing.T, db *sql.DB) {
	t.Helper()
	for _, key := range kindLanguageKeys {
		for _, locale := range kindCanonicalLocales {
			var copy, status string
			if err := db.QueryRow(`SELECT t.translation,t.review_status
    FROM system_lang_key_translations t JOIN system_lang_keys k ON k.id=t.lang_key_id
    WHERE k.lang_key=$1 AND t.language_code=$2`, key, locale).Scan(&copy, &status); err != nil {
				t.Fatal(key, locale, err)
			}
			if strings.TrimSpace(copy) == "" {
				t.Fatal("blank canonical translation", key, locale)
			}
			want := "approved"
			if strings.HasPrefix(locale, "zh-") {
				want = "needs_review"
			}
			if status != want {
				t.Fatal("wrong canonical review state", key, locale, status)
			}
		}
	}
}

func TestDatasetKindPostgresTranslationWhitespaceAuthoredAndReplay(t *testing.T) {
	db := frontPageDisposableDB(t)
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "server_tools", "migrations", "20261009000076_seed_dataset_kind_language_keys.sql"))
	if err != nil {
		t.Fatal(err)
	}
	for _, blank := range []string{" ", "\t", "\n", "\r", "\f", "\v", " \t\n\r\f\v "} {
		t.Run("blank/"+strings.ReplaceAll(strings.ReplaceAll(blank, "\n", "LF"), "\r", "CR"), func(t *testing.T) {
			frontPageExec(t, db, `DELETE FROM system_lang_key_translations WHERE lang_key_id IN
    (SELECT id FROM system_lang_keys WHERE lang_key IN ('table_kind','kind_version','kind_config','dataset_kind_evidence_unavailable'))`)
			if _, err := db.Exec(`UPDATE system_lang_keys SET fi=$1,en=$1,ch=$1,yue=$1
    WHERE lang_key IN ('table_kind','kind_version','kind_config','dataset_kind_evidence_unavailable')`, blank); err != nil {
				t.Fatal(err)
			}
			authored := " \tSite-authored bytes\r\n "
			if _, err := db.Exec(`UPDATE system_lang_keys SET fi=$1,en=$1,ch=$1,yue=$1 WHERE lang_key='kind_version'`, authored); err != nil {
				t.Fatal(err)
			}
			retained := " \tRetained normalized copy\r\n "
			if _, err := db.Exec(`INSERT INTO system_lang_key_translations(lang_key_id,language_code,translation,source_kind,review_status)
    SELECT k.id,l.language_code,$1,'manual','approved' FROM system_lang_keys k CROSS JOIN system_languages l
    WHERE k.lang_key='kind_config' AND l.language_code IN ('fi','en','zh-CN','zh-TW','zh-HK')`, retained); err != nil {
				t.Fatal(err)
			}
			var before string
			if err := db.QueryRow(`SELECT jsonb_agg(to_jsonb(k) ORDER BY id)::text FROM system_lang_keys k
    WHERE lang_key IN ('table_kind','kind_version','kind_config','dataset_kind_evidence_unavailable')`).Scan(&before); err != nil {
				t.Fatal(err)
			}
			for replay := 0; replay < 2; replay++ {
				frontPageExec(t, db, string(raw))
				for _, locale := range kindCanonicalLocales {
					for _, key := range kindLanguageKeys {
						var copy, status string
						if err := db.QueryRow(`SELECT t.translation,t.review_status FROM system_lang_key_translations t
       JOIN system_lang_keys k ON k.id=t.lang_key_id WHERE k.lang_key=$1 AND t.language_code=$2`, key, locale).Scan(&copy, &status); err != nil {
							t.Fatal(key, locale, err)
						}
						if strings.TrimSpace(copy) == "" {
							t.Fatal("blank reached translation store", key, locale)
						}
						if key == "kind_version" && copy != authored {
							t.Fatal("legacy authored bytes changed", locale, copy)
						}
						if key == "kind_config" && (copy != retained || status != "approved") {
							t.Fatal("normalized authored copy changed", locale, copy, status)
						}
						if key != "kind_config" && strings.HasPrefix(locale, "zh-") && status != "needs_review" {
							t.Fatal("Chinese automatically approved", key, locale, status)
						}
					}
				}
				var after string
				if err := db.QueryRow(`SELECT jsonb_agg(to_jsonb(k) ORDER BY id)::text FROM system_lang_keys k
     WHERE lang_key IN ('table_kind','kind_version','kind_config','dataset_kind_evidence_unavailable')`).Scan(&after); err != nil {
					t.Fatal(err)
				}
				if after != before {
					t.Fatal("migration modified authored legacy fields")
				}
			}
		})
	}
}
