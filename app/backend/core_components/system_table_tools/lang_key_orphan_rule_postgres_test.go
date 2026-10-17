// lang_key_orphan_rule_postgres_test.go
// Proves the report-only orphan rule against actual source and translation rows.
// Connects shared lifecycle SQL, generated-name classification and category 8.
// Keeps exact identity, uncertain evidence and read-only reporting executable.
package system_table_tools

import (
	"database/sql"
	"fmt"
	"testing"

	backend "easelect/backend/core_components"
)

func orphanRulePostgresFixture(t *testing.T) *sql.DB {
	t.Helper()
	db := sitePresentationDisposableDB(t)
	previous := backend.Db
	backend.Db = db
	t.Cleanup(func() { backend.Db = previous })
	frontPageExec(t, db, `CREATE TABLE system_lang_keys (
        id serial PRIMARY KEY, lang_key text UNIQUE, en text, lang_key_type integer);
        CREATE TABLE system_lang_key_sources (
        lang_key_id integer REFERENCES system_lang_keys(id) ON DELETE CASCADE,
        source_type text, source_high text, last_seen date);
        CREATE TABLE system_lang_key_translations (
        lang_key_id integer REFERENCES system_lang_keys(id) ON DELETE CASCADE,
        language_code text, translation text);
        CREATE TABLE system_lang_keys_archive (original_id integer);`)
	return db
}

func TestLangKeyOrphanRulePostgres(t *testing.T) {
	db := orphanRulePostgresFixture(t)
	const reference = "public.system_lang_key_translations.lang_key_id"
	for _, test := range []struct {
		name       string
		sourceType any
		sourceHigh any
		code       bool
		candidate  bool
	}{
		{"reference_only", "foreign_key", reference, false, true},
		{"reference_and_code", "foreign_key", reference, true, false},
		{"domain_fk", "foreign_key", "public.app_questions.label_id", false, false},
		{"different_schema", "foreign_key", "other.system_lang_key_translations.lang_key_id", false, false},
		{"identity_suffix", "foreign_key", reference + "_other", false, false},
		{"identity_prefix", "foreign_key", "prefix." + reference, false, false},
		{"identity_space", "foreign_key", reference + " ", false, false},
		{"identity_case", "foreign_key", "PUBLIC.system_lang_key_translations.lang_key_id", false, false},
		{"wrong_type", "schema", reference, false, false},
		{"unknown_type", "future_unknown", reference, false, false},
		{"null_type", nil, reference, false, false},
		{"null_identity", "foreign_key", nil, false, false},
		{"null_both", nil, nil, false, false},
		{"malformed_bookkeeping", "orphan", nil, false, false},
		{"malformed_manual", "manual_crud", nil, false, false},
		{"empty_both", "", "", false, false},
		{"malformed_identity", "foreign_key", "{bad source}", false, false},
		{"bookkeeping", "orphan", "consistency_scan", false, true},
		{"manual_edit", "manual_crud", "admin_ui", false, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			var id int
			if err := db.QueryRow(`INSERT INTO system_lang_keys(lang_key) VALUES($1) RETURNING id`, test.name).Scan(&id); err != nil {
				t.Fatal(err)
			}
			if _, err := db.Exec(`INSERT INTO system_lang_key_sources VALUES($1,$2,$3,CURRENT_DATE)`, id, test.sourceType, test.sourceHigh); err != nil {
				t.Fatal(err)
			}
			if test.code {
				if _, err := db.Exec(`INSERT INTO system_lang_key_sources VALUES($1,'code','view.js',CURRENT_DATE)`, id); err != nil {
					t.Fatal(err)
				}
			}
			var counting bool
			if err := db.QueryRow(`SELECT ` + countingLangKeySourceExistsSQL(fmt.Sprint(id))).Scan(&counting); err != nil {
				t.Fatal(err)
			}
			if counting == test.candidate {
				t.Fatalf("counting=%v candidate=%v", counting, test.candidate)
			}
			found := false
			for _, row := range findOrphanLangKeys() {
				found = found || row.id == id
			}
			if found != test.candidate {
				t.Fatalf("candidate=%v want=%v", found, test.candidate)
			}
		})
	}
	frontPageExec(t, db, `INSERT INTO system_lang_keys(lang_key) VALUES
        ('<garbage>'), (repeat('x',201)), ('source_less');`)
	sourceLessFound := false
	for _, row := range findOrphanLangKeys() {
		sourceLessFound = sourceLessFound || row.key == "source_less"
		if row.key == "<garbage>" || len(row.key) > maxLangKeyNameCharacters {
			t.Fatalf("garbage became category-8 candidate: %q", row.key)
		}
	}
	if !sourceLessFound {
		t.Fatal("source-less key disappeared from candidates")
	}
}

func TestGeneratedLangKeysPostgres(t *testing.T) {
	db := orphanRulePostgresFixture(t)
	for key, generated := range map[string]bool{
		"test_x": false, "testimonial": false, "test_connection": false,
		"test_x1": false, "test_123": true, "test_abc123": true,
		"test_perm_table_123": true, "test_perm_table_desktop_card_1723456789012": true,
		"test_random_a1bcde": true, "test_random_abcde1": true, "test_random_abcdef1": true,
		"test_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee": true,
		"e2e_abc123": true, "e2e_folder_abc": true, "E2E_ABC123": true,
		"e2e_": false, "test-123": false, " test_123 ": false,
		"add_row_e2e_abc123": false, "test_123_front_page": false,
		"e2e_a\nb": true, "test_ab\n1cdef2": false,
		"teſt_123": false, "test_abK123": false, "TeSt_AbC123": true,
	} {
		t.Run(key, func(t *testing.T) {
			var id int
			if err := db.QueryRow(`INSERT INTO system_lang_keys(lang_key) VALUES($1) RETURNING id`, key).Scan(&id); err != nil {
				t.Fatal(err)
			}
			// A code source makes selection depend on the generated-name rule.
			if _, err := db.Exec(`INSERT INTO system_lang_key_sources VALUES($1,'code','view.js',CURRENT_DATE)`, id); err != nil {
				t.Fatal(err)
			}
			found := false
			for _, row := range findOrphanLangKeys() {
				found = found || row.id == id
			}
			if found != generated || isSyntheticTestLangKey(key) != generated {
				t.Fatalf("Go/SQL generated classification for %q: Go=%v SQL=%v want=%v", key, isSyntheticTestLangKey(key), found, generated)
			}
		})
	}
}

func TestLangKeyOrphanReportReadOnlyPostgres(t *testing.T) {
	db := orphanRulePostgresFixture(t)
	frontPageExec(t, db, `INSERT INTO system_lang_keys VALUES
        (1,'reference_only','',1),(2,'no_translation','Legacy preview',1),(3,'blank_translation','',1);
        INSERT INTO system_lang_key_sources VALUES
        (1,'foreign_key','public.system_lang_key_translations.lang_key_id',CURRENT_DATE),
        (1,'orphan','consistency_scan',CURRENT_DATE-400);
        INSERT INTO system_lang_key_translations VALUES (1,'sv','Text'),(3,'fi','  ');
        INSERT INTO system_lang_keys_archive VALUES (999);`)
	snapshot := func() string {
		t.Helper()
		var state string
		if err := db.QueryRow(`SELECT jsonb_build_array(
            (SELECT jsonb_agg(k ORDER BY id) FROM system_lang_keys k),
            (SELECT jsonb_agg(s ORDER BY lang_key_id,source_type) FROM system_lang_key_sources s),
            (SELECT jsonb_agg(tr ORDER BY lang_key_id) FROM system_lang_key_translations tr),
            (SELECT jsonb_agg(a ORDER BY original_id) FROM system_lang_keys_archive a))::text`).Scan(&state); err != nil {
			t.Fatal(err)
		}
		return state
	}
	before := snapshot()
	// One pooled connection keeps every report statement under read-only SQL.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	frontPageExec(t, db, `SET default_transaction_read_only = on`)
	report := checkOrphanLangKeys()
	if len(report.Issues) != 3 {
		t.Fatalf("missing report candidates: %+v", report)
	}
	for _, issue := range report.Issues {
		if issue.Translated == nil || *issue.Translated != (issue.Table == "reference_only") {
			t.Fatalf("wrong translated state: %+v", issue)
		}
	}
	if after := snapshot(); after != before {
		t.Fatalf("report changed keys, translations, markers or archive:\nbefore=%s\nafter=%s", before, after)
	}
}
