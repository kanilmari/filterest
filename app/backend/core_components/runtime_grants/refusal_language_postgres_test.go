// refusal_language_postgres_test.go
// Verifies refusal seeds and preservation of site-authored wording.
// Uses the same bootstrap/disposable PostgreSQL fixture as mutation hooks.
// Checks stored and actually served wording after migration and replay.
package runtime_grants_test

import (
	"easelect/backend/core_components/lang"
	. "easelect/backend/core_components/runtime_grants"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/lib/pq"
)

func TestRuntimeGrantRefusalLanguageMigrationPostgres(t *testing.T) {
	f := newMutationHooksFixture(t)
	for _, key := range []string{"error_runtime_grant_policy_blocked", "error_runtime_grant_privilege_managed"} {
		var fi, en, ch, yue string
		if err := f.owner.QueryRow(`SELECT COALESCE(fi,''),COALESCE(en,''),COALESCE(ch,''),COALESCE(yue,'') FROM system_lang_keys WHERE lang_key=$1`, key).Scan(&fi, &en, &ch, &yue); err != nil || fi == "" || en == "" || ch != "" || yue != "" {
			t.Fatal("bootstrap refusal languages", key, fi, en, ch, yue, err)
		}
	}
	// Real installations enforce btrim(translation) <> ''. Exercise a missing
	// normalized row, not an impossible empty translation, alongside empty
	// legacy copy. Also prove the migration creates an entirely missing key.
	FixtureExec(t, f.owner, `UPDATE system_lang_keys SET fi='Site Finnish',en='',ch='Site Chinese',yue='Site Cantonese' WHERE lang_key='error_runtime_grant_policy_blocked';
 UPDATE system_lang_key_translations SET translation='Served site Finnish'
 WHERE lang_key_id=(SELECT id FROM system_lang_keys WHERE lang_key='error_runtime_grant_policy_blocked') AND language_code='fi';
 DELETE FROM system_lang_key_translations
 WHERE lang_key_id=(SELECT id FROM system_lang_keys WHERE lang_key='error_runtime_grant_policy_blocked') AND language_code='en';
 DELETE FROM system_lang_keys WHERE lang_key='error_runtime_grant_privilege_managed'`)
	bytes, err := os.ReadFile(filepath.Join("..", "..", "..", "server_tools", "migrations", "20261005000075_seed_runtime_grant_refusal_language_keys.sql"))
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		FixtureExec(t, f.owner, string(bytes))
	}
	var fi, en, ch, yue, servedFi, servedEn string
	err = f.owner.QueryRow(`SELECT k.fi,k.en,k.ch,k.yue,
 (SELECT translation FROM system_lang_key_translations WHERE lang_key_id=k.id AND language_code='fi'),
 (SELECT translation FROM system_lang_key_translations WHERE lang_key_id=k.id AND language_code='en')
 FROM system_lang_keys k WHERE lang_key='error_runtime_grant_policy_blocked'`).Scan(&fi, &en, &ch, &yue, &servedFi, &servedEn)
	if err != nil || fi != "Site Finnish" || en == "" || ch != "Site Chinese" || yue != "Site Cantonese" || servedFi != "Served site Finnish" || servedEn != en {
		t.Fatal("seed overwrote authored wording or missed empty translation", fi, en, ch, yue, servedFi, servedEn, err)
	}
	var count int
	if err := f.owner.QueryRow(`SELECT count(*) FROM system_lang_keys k
 JOIN system_lang_key_translations t ON t.lang_key_id=k.id
 WHERE k.lang_key IN ('error_runtime_grant_policy_blocked','error_runtime_grant_privilege_managed')
 AND t.language_code IN ('fi','en') AND btrim(t.translation)<>''`).Scan(&count); err != nil || count != 4 {
		t.Fatal("missing normalized refusal copy", count, err)
	}
}

func TestRuntimeGrantPolicyWaitRefusalLanguageMigrationPostgres(t *testing.T) {
	f := newMutationHooksFixture(t)
	t.Setenv("DEV_MODE", "false")
	const key = "error_runtime_grant_policy_busy"
	bytes, err := os.ReadFile(filepath.Join("..", "..", "..", "server_tools", "migrations", "20261009000081_seed_runtime_grant_policy_wait_language_key.sql"))
	if err != nil {
		t.Fatal(err)
	}
	var fi, en, ch, yue string
	if err := f.owner.QueryRow(`SELECT fi,en,ch,yue FROM system_lang_keys WHERE lang_key=$1`, key).Scan(&fi, &en, &ch, &yue); err != nil || fi == "" || en == "" || ch == "" || yue == "" {
		t.Fatal("missing legacy refusal copy", fi, en, ch, yue, err)
	}
	var count int
	if err := f.owner.QueryRow(`SELECT count(*) FROM system_lang_key_translations t JOIN system_lang_keys k ON k.id=t.lang_key_id
 WHERE k.lang_key=$1 AND t.language_code IN ('fi','en','zh-CN','zh-TW','zh-HK') AND btrim(t.translation)<>''`, key).Scan(&count); err != nil || count != 5 {
		t.Fatal("missing canonical refusal copy", count, err)
	}
	// Sites may register these supported legacy codes. Keep their selectors
	// disabled while making normalized ch/yue rows possible under the real FK.
	FixtureExec(t, f.owner, `INSERT INTO system_languages
 (language_code,english_name,native_name,script_code,fallback_language_code)
 VALUES ('ch','Legacy Chinese','Legacy Chinese','Hans','en'),
        ('yue','Cantonese','Cantonese','Hant','en')`)

	assertServed := func(t *testing.T, language, want string) {
		t.Helper()
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/api/translations?lang="+language, nil)
		lang.GetTranslationsHandler(response, request)
		if response.Code != http.StatusOK {
			t.Fatalf("translation status=%d: %s", response.Code, response.Body)
		}
		var translations map[string]string
		if err := json.Unmarshal(response.Body.Bytes(), &translations); err != nil {
			t.Fatal(err)
		}
		if got := translations[key]; got != want {
			t.Fatalf("served %s wording=%q, want %q", language, got, want)
		}
	}
	legacyLocales := []struct {
		language string
		shipped  string
	}{
		{"fi", fi}, {"en", en}, {"ch", ch}, {"yue", yue},
	}
	for _, locale := range legacyLocales {
		t.Run(locale.language, func(t *testing.T) {
			legacyAuthored := " Site " + locale.language + " legacy wording "
			normalizedAuthored := " Site " + locale.language + " normalized wording "
			for _, legacy := range []struct {
				name  string
				value any
			}{
				{"null_legacy", nil}, {"empty_legacy", ""},
				{"whitespace_legacy", "   "}, {"authored_legacy", legacyAuthored},
			} {
				t.Run(legacy.name, func(t *testing.T) {
					for _, normalizedPresent := range []bool{false, true} {
						name := "missing_normalized"
						if normalizedPresent {
							name = "authored_normalized"
						}
						t.Run(name, func(t *testing.T) {
							// A second blank column forces the upsert's update path even
							// when this locale has nonblank legacy text to preserve.
							companion := "fi"
							if locale.language == companion {
								companion = "en"
							}
							FixtureExec(t, f.owner, fmt.Sprintf(`UPDATE system_lang_keys SET %s=$1,%s='' WHERE lang_key=$2`, pq.QuoteIdentifier(locale.language), pq.QuoteIdentifier(companion)), legacy.value, key)
							FixtureExec(t, f.owner, `DELETE FROM system_lang_key_translations
 WHERE lang_key_id=(SELECT id FROM system_lang_keys WHERE lang_key=$1) AND language_code=$2`, key, locale.language)
							if normalizedPresent {
								FixtureExec(t, f.owner, `INSERT INTO system_lang_key_translations
 (lang_key_id,language_code,translation,source_kind,review_status)
 SELECT id,$2,$3,'import','unreviewed' FROM system_lang_keys WHERE lang_key=$1`, key, locale.language, normalizedAuthored)
							}
							wantLegacy := locale.shipped
							if normalizedPresent {
								wantLegacy = normalizedAuthored
								if legacy.value != legacyAuthored {
									assertServed(t, locale.language, normalizedAuthored)
								}
							}
							if legacy.value == legacyAuthored {
								wantLegacy = legacyAuthored
							}
							wantNormalized := wantLegacy
							wantSource, wantReview := "manual", "needs_review"
							if locale.language == "fi" || locale.language == "en" {
								wantReview = "approved"
							}
							if normalizedPresent {
								wantNormalized = normalizedAuthored
								wantSource, wantReview = "import", "unreviewed"
							}
							for _, pass := range []string{"migration", "replay"} {
								t.Run(pass, func(t *testing.T) {
									FixtureExec(t, f.owner, string(bytes))
									var storedLegacy, storedNormalized, source, review string
									query := fmt.Sprintf(`SELECT k.%s,t.translation,t.source_kind,t.review_status
 FROM system_lang_keys k JOIN system_lang_key_translations t ON t.lang_key_id=k.id
 WHERE k.lang_key=$1 AND t.language_code=$2`, pq.QuoteIdentifier(locale.language))
									if err := f.owner.QueryRow(query, key, locale.language).Scan(&storedLegacy, &storedNormalized, &source, &review); err != nil {
										t.Fatal(err)
									}
									if storedLegacy != wantLegacy || storedNormalized != wantNormalized || source != wantSource || review != wantReview {
										t.Fatalf("stored legacy=%q normalized=%q source=%q review=%q; want %q %q %q %q", storedLegacy, storedNormalized, source, review, wantLegacy, wantNormalized, wantSource, wantReview)
									}
									assertServed(t, locale.language, wantLegacy)
								})
							}
						})
					}
				})
			}
		})
	}
	// Canonical Chinese locales are served directly from normalized storage,
	// independently of the legacy Chinese and Cantonese columns.
	FixtureExec(t, f.owner, `UPDATE system_lang_keys SET fi=$1,en=$2,ch=$3,yue=$4 WHERE lang_key=$5`, fi, en, ch, yue, key)
	for _, language := range []string{"zh-CN", "zh-TW", "zh-HK"} {
		t.Run(language, func(t *testing.T) {
			var shipped string
			if err := f.owner.QueryRow(`SELECT translation FROM system_lang_key_translations
 WHERE lang_key_id=(SELECT id FROM system_lang_keys WHERE lang_key=$1) AND language_code=$2`, key, language).Scan(&shipped); err != nil {
				t.Fatal(err)
			}
			for _, normalizedPresent := range []bool{false, true} {
				name, want := "missing_normalized", shipped
				if normalizedPresent {
					name, want = "authored_normalized", " Site "+language+" normalized wording "
				}
				t.Run(name, func(t *testing.T) {
					FixtureExec(t, f.owner, `DELETE FROM system_lang_key_translations
 WHERE lang_key_id=(SELECT id FROM system_lang_keys WHERE lang_key=$1) AND language_code=$2`, key, language)
					if normalizedPresent {
						FixtureExec(t, f.owner, `INSERT INTO system_lang_key_translations
 (lang_key_id,language_code,translation,source_kind,review_status)
 SELECT id,$2,$3,'import','unreviewed' FROM system_lang_keys WHERE lang_key=$1`, key, language, want)
					}
					for _, pass := range []string{"migration", "replay"} {
						t.Run(pass, func(t *testing.T) {
							FixtureExec(t, f.owner, string(bytes))
							assertServed(t, language, want)
						})
					}
				})
			}
		})
	}
	t.Run("missing_key", func(t *testing.T) {
		FixtureExec(t, f.owner, `DELETE FROM system_lang_keys WHERE lang_key=$1`, key)
		for _, pass := range []string{"migration", "replay"} {
			t.Run(pass, func(t *testing.T) {
				FixtureExec(t, f.owner, string(bytes))
				for _, locale := range legacyLocales {
					assertServed(t, locale.language, locale.shipped)
				}
				if err := f.owner.QueryRow(`SELECT count(*) FROM system_lang_key_translations t JOIN system_lang_keys k ON k.id=t.lang_key_id
 WHERE k.lang_key=$1 AND t.language_code IN ('fi','en','zh-CN','zh-TW','zh-HK') AND btrim(t.translation)<>''`, key).Scan(&count); err != nil || count != 5 {
					t.Fatal("missing canonical refusal copy", count, err)
				}
			})
		}
	})
}
