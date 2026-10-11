// publication_language_postgres_test.go
// Proves canonical translation repair with the shipped registry and text constraints.
// Connects the pre-70 upgrade and already-applied old-71 paths to the same copy.
// Protects authored values and idempotency in opt-in disposable PostgreSQL only.
package workline_observatory

import (
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func publicationBootstrapSource(t *testing.T, filename string) string {
	t.Helper()
	content, err := os.ReadFile(filepath.Join("..", "..", "..", "server_tools", "public_bootstrap", filename))
	if err != nil {
		t.Fatal(err)
	}
	return string(content)
}

func publicationSourceStatement(t *testing.T, source, start string) string {
	t.Helper()
	index := strings.Index(source, start)
	if index < 0 {
		t.Fatalf("source statement missing: %s", start)
	}
	tail := source[index:]
	end := strings.Index(tail, ";")
	if end < 0 {
		t.Fatalf("source statement unfinished: %s", start)
	}
	return tail[:end+1]
}

func publicationLanguageFixture(t *testing.T, db *sql.DB) {
	t.Helper()
	schema := publicationBootstrapSource(t, "source/runtime.schema.sql")
	// Read actual DDL, including registry foreign keys, allowed statuses and
	// CHECK (btrim(translation) <> ''). No invented legacy locale rows.
	for _, table := range []string{"system_languages", "system_lang_key_translations"} {
		publicationSQL(t, db, publicationSourceStatement(t, schema, "CREATE TABLE IF NOT EXISTS public."+table+" ("))
	}
	registry := publicationBootstrapSource(t, "source/app_tables.lang_keys.sql")
	publicationSQL(t, db, publicationSourceStatement(t, registry, "INSERT INTO public.system_languages ("))
	publicationSQL(t, db, `
        INSERT INTO system_lang_keys(lang_key,fi,en,ch,yue,creation_spec)
        VALUES ('workline_publication_goal','Omat julkaisut','','   ',NULL,'Site authored');
        INSERT INTO system_lang_key_translations(lang_key_id,language_code,translation,source_kind,review_status)
        VALUES (1,'fi','Omat julkaisut','manual','approved');`)
}

func publicationTranslationSnapshot(t *testing.T, db *sql.DB) string {
	t.Helper()
	var snapshot string
	err := db.QueryRow(`SELECT string_agg(k.lang_key || '/' || t.language_code || '/' || t.translation || '/' || t.source_kind || '/' || t.review_status, E'\n' ORDER BY k.lang_key,t.language_code)
        FROM system_lang_key_translations t JOIN system_lang_keys k ON k.id=t.lang_key_id
        WHERE k.lang_key LIKE 'workline_publication_%' OR k.lang_key IN
        ('publication_revision_required','publication_revision_conflict','invalid_publication_details',
         'invalid_publication_target_date','invalid_publication_time','invalid_publication_text')`).Scan(&snapshot)
	if err != nil {
		t.Fatal(err)
	}
	return snapshot
}

func assertPublicationTranslations(t *testing.T, db *sql.DB) {
	t.Helper()
	var keys, translations, invalid int
	err := db.QueryRow(`SELECT count(DISTINCT k.id),count(t.id),count(*) FILTER (WHERE btrim(t.translation)='' OR
        t.language_code NOT IN ('fi','en','zh-CN','zh-TW','zh-HK') OR
        t.review_status <> CASE WHEN t.language_code IN ('fi','en') THEN 'approved' ELSE 'needs_review' END)
        FROM system_lang_keys k LEFT JOIN system_lang_key_translations t ON t.lang_key_id=k.id
        WHERE k.lang_key LIKE 'workline_publication_%' OR k.lang_key IN
        ('publication_revision_required','publication_revision_conflict','invalid_publication_details',
         'invalid_publication_target_date','invalid_publication_time','invalid_publication_text')`).Scan(&keys, &translations, &invalid)
	if err != nil || keys != 26 || translations != 26*5 || invalid != 0 {
		t.Fatalf("canonical copy: keys=%d translations=%d invalid=%d error=%v", keys, translations, invalid, err)
	}
	var fi, spec, translation string
	if err := db.QueryRow(`SELECT k.fi,k.creation_spec,t.translation FROM system_lang_keys k
        JOIN system_lang_key_translations t ON t.lang_key_id=k.id AND t.language_code='fi'
        WHERE k.lang_key='workline_publication_goal'`).Scan(&fi, &spec, &translation); err != nil {
		t.Fatal(err)
	}
	if fi != "Omat julkaisut" || translation != fi || spec != "Site authored" {
		t.Fatalf("authored copy changed: %q/%q/%q", fi, translation, spec)
	}
}

func TestPublicationCanonicalTranslationPathsPostgres(t *testing.T) {
	var expected string
	for _, path := range []string{"fresh_bootstrap", "before_70_blank_english", "before_70_space_english", "old_71_applied"} {
		t.Run(path, func(t *testing.T) {
			db := publicationPostgresDB(t)
			if path == "fresh_bootstrap" {
				publicationSQL(t, db, "DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
				publicationSQL(t, db, publicationBootstrapSource(t, "schema.sql"))
				// The registry first (the seed inserts it again with ON CONFLICT DO NOTHING), so the
				// authored translation below can reference its language.
				publicationSQL(t, db, publicationSourceStatement(t, publicationBootstrapSource(t, "source/app_tables.lang_keys.sql"), "INSERT INTO public.system_languages ("))
				// The same authored partial key before the fresh seed, to prove that
				// bootstrap and both upgrade routes resolve to identical served copy.
				publicationSQL(t, db, `INSERT INTO system_lang_keys(lang_key,fi,en,ch,yue,creation_spec)
                    VALUES ('workline_publication_goal','Omat julkaisut','','   ',NULL,'Site authored');
                    INSERT INTO system_lang_key_translations(lang_key_id,language_code,translation,source_kind,review_status)
                    SELECT id,'fi',fi,'manual','approved' FROM system_lang_keys WHERE lang_key='workline_publication_goal';`)
				publicationSQL(t, db, publicationBootstrapSource(t, "seed_data.sql"))
			} else if path == "old_71_applied" {
				// The old migration could run only with nonblank English; canonical
				// Chinese copy was lost because it joined ch/yue to the real registry.
				publicationSQL(t, db, "UPDATE system_lang_keys SET en='Publications',ch=NULL WHERE id=1;")
				old, err := os.ReadFile(filepath.Join("testdata", "publication_language_seed_old_71.sql"))
				if err != nil {
					t.Fatal(err)
				}
				publicationSQL(t, db, string(old))
				publicationSQL(t, db, "INSERT INTO system_schema_migrations(filename) VALUES ('"+publicationLanguageMigration+"');")
				applyPublicationMigrations(t, db)
			} else {
				if path == "before_70_space_english" {
					publicationSQL(t, db, "UPDATE system_lang_keys SET en='   ' WHERE id=1;")
				}
				applyPublicationMigrations(t, db)
			}
			assertPublicationTranslations(t, db)
			var legacyEnglish string
			if err := db.QueryRow(`SELECT en FROM system_lang_keys WHERE lang_key='workline_publication_goal'`).Scan(&legacyEnglish); err != nil {
				t.Fatal(err)
			}
			wantEnglish := ""
			if path == "before_70_space_english" {
				wantEnglish = "   "
			} else if path == "old_71_applied" {
				wantEnglish = "Publications"
			}
			if legacyEnglish != wantEnglish {
				t.Fatalf("legacy value changed: %q, want %q", legacyEnglish, wantEnglish)
			}
			before := publicationTranslationSnapshot(t, db)
			stateBefore := publicationLanguageStateSnapshot(t, db)
			if expected == "" {
				expected = before
			} else if before != expected {
				t.Fatal("fresh bootstrap and upgrade translations differ")
			}
			// Replay the SQL itself as well as the runner (which skips filenames).
			for _, name := range []string{publicationLanguageMigration, publicationRepairMigration} {
				publicationSQL(t, db, string(publicationSource(t, name)))
			}
			assertPublicationTranslations(t, db)
			if after := publicationTranslationSnapshot(t, db); after != before {
				t.Fatal("translation replay changed served copy")
			}
			if after := publicationLanguageStateSnapshot(t, db); after != stateBefore {
				t.Fatal("replay changed language rows, identities or timestamps")
			}
		})
	}
}

func publicationLanguageStateSnapshot(t *testing.T, db *sql.DB) string {
	t.Helper()
	var snapshot string
	err := db.QueryRow(`SELECT (SELECT string_agg(row_to_json(k)::text,E'\n' ORDER BY k.id) FROM system_lang_keys k)
        || (SELECT string_agg(row_to_json(t)::text,E'\n' ORDER BY t.id) FROM system_lang_key_translations t)`).Scan(&snapshot)
	if err != nil {
		t.Fatal(err)
	}
	return snapshot
}

func TestPublicationAuthoredTranslationsPreservedPostgres(t *testing.T) {
	db := publicationPostgresDB(t)
	// Served translations may differ from legacy text and carry an author's
	// approved review status. Neither the corrected seed nor the repair owns them.
	publicationSQL(t, db, `INSERT INTO system_lang_key_translations(lang_key_id,language_code,translation,source_kind,review_status)
        VALUES (1,'en','  Our reviewed publications  ','import','approved'),
               (1,'zh-CN','本站发布','manual','approved'),
               (1,'zh-HK','本站發佈','import','approved');`)
	applyPublicationMigrations(t, db)
	for _, locale := range []struct{ code, text, source string }{
		{"en", "  Our reviewed publications  ", "import"},
		{"zh-CN", "本站发布", "manual"},
		{"zh-HK", "本站發佈", "import"},
	} {
		var text, source, status string
		if err := db.QueryRow(`SELECT translation,source_kind,review_status FROM system_lang_key_translations
            WHERE lang_key_id=1 AND language_code=$1`, locale.code).Scan(&text, &source, &status); err != nil {
			t.Fatal(err)
		}
		if text != locale.text || source != locale.source || status != "approved" {
			t.Fatalf("authored %s changed: %q/%s/%s", locale.code, text, source, status)
		}
	}
	before := publicationLanguageStateSnapshot(t, db)
	for _, name := range []string{publicationLanguageMigration, publicationRepairMigration} {
		publicationSQL(t, db, string(publicationSource(t, name)))
	}
	if after := publicationLanguageStateSnapshot(t, db); after != before {
		t.Fatal("replay changed authored language state")
	}
}

func TestPublicationTimeConstraintAgreementPostgres(t *testing.T) {
	db := publicationPostgresDB(t)
	applyPublicationMigrations(t, db)
	for _, tc := range publicationTimeCases {
		t.Run(tc.value, func(t *testing.T) {
			_, validationErr := normalizePublicationDetails(publicationDetails{PublicationVersion: "9.4.0", Published: true, PublishedAt: &tc.value})
			_, err := db.Exec(`UPDATE dev_agent_release_goals SET publication_version='9.4.0',published=true,published_at=$1::timestamptz WHERE identity_key='earlier'`, tc.value)
			if (err == nil) != tc.valid || (validationErr == nil) != (err == nil) {
				t.Fatalf("PostgreSQL constraint disagrees with validator: valid=%v validation=%v storage=%v", tc.valid, validationErr, err)
			}
		})
	}
	for _, date := range []string{"0001-01-01", "9999-12-31", "0000-01-01", "10000-01-01", "2026-02-30", "infinity", "-infinity"} {
		_, validationErr := normalizePublicationDetails(publicationDetails{TargetDate: &date})
		_, storageErr := db.Exec(`UPDATE dev_agent_release_goals SET target_date=$1::date WHERE identity_key='earlier'`, date)
		if (validationErr == nil) != (storageErr == nil) {
			t.Fatalf("date constraint disagrees for %s: validation=%v storage=%v", date, validationErr, storageErr)
		}
	}
}
