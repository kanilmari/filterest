// refusal_language_postgres_test.go
// Verifies the Finnish/English seed and preservation of site-authored wording.
// Uses the same bootstrap/disposable PostgreSQL fixture as mutation hooks.
// Missing normalized copy is an absent row; existing served copy stays intact.
package runtime_grants_test

import (
	. "easelect/backend/core_components/runtime_grants"
	"os"
	"path/filepath"
	"testing"
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
