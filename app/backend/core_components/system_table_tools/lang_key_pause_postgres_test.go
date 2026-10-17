// lang_key_pause_postgres_test.go
// Proves character boundaries, stale IDs and today's source rule on PostgreSQL.
// Connects actual consistency readers and single-fix SQL to a disposable cluster.
// Keeps statement-level deletion guards executable instead of trusting mocked results.
package system_table_tools

import (
	"errors"
	"fmt"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
)

func TestLangKeyPausePostgresGuardAndCharacterBoundaries(t *testing.T) {
	db := sitePresentationDisposableDB(t)
	oldDB := backend.Db
	backend.Db = db
	t.Cleanup(func() { backend.Db = oldDB })
	frontPageExec(t, db, `CREATE TABLE system_lang_keys (
        id serial PRIMARY KEY, lang_key text UNIQUE, en text, lang_key_type integer);
        CREATE TABLE system_lang_key_translations (lang_key_id integer REFERENCES system_lang_keys(id), translation text);
        CREATE TABLE system_lang_key_sources (lang_key_id integer REFERENCES system_lang_keys(id) ON DELETE CASCADE,
        source_type text,source_high text,last_seen date);`)
	for _, test := range []struct {
		name    string
		length  int
		garbage bool
	}{
		{"ascii 200", 200, false}, {"ascii 201", 201, true}, {"unicode 200", 200, false}, {"unicode 201", 201, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			char := "x"
			if strings.HasPrefix(test.name, "unicode") {
				char = "ä"
			}
			var id int
			if err := db.QueryRow(`INSERT INTO system_lang_keys(lang_key) VALUES($1) RETURNING id`, strings.Repeat(char, test.length)).Scan(&id); err != nil {
				t.Fatal(err)
			}
			listed := false
			for _, issue := range checkGarbageLangKeys().Issues {
				listed = listed || issue.ID == fmt.Sprintf("cat7_%d", id)
			}
			if listed != test.garbage {
				t.Fatal("garbage boundary", listed, test.garbage)
			}
			orphan := false
			for _, row := range findOrphanLangKeys() {
				orphan = orphan || row.id == id
			}
			if orphan == test.garbage {
				t.Fatal("orphan exclusion does not share garbage boundary", orphan, test.garbage)
			}

			err := fixIssue(db, fmt.Sprintf("cat7_%d", id), nil)
			if test.garbage && err != nil || !test.garbage && !errors.Is(err, errConsistencyFixSkipped) {
				t.Fatal(err)
			}
			// Repeating the request is always a harmless skip.
			if err := fixIssue(db, fmt.Sprintf("cat7_%d", id), nil); !errors.Is(err, errConsistencyFixSkipped) {
				t.Fatal(err)
			}
		})
	}
	for _, source := range []string{"orphan", "manual_crud", "code", "column", "table", "prefix", "suffix", "view", "group", "folder", "db", "foreign_key", "column_value", "dataset_header", "front_page_hero", "admin_api", "dev_editor", "template", "javascript", "migration", "schema", "future_unknown"} {
		t.Run(source, func(t *testing.T) {
			var id int
			key := "<garbage_" + source + ">"
			if err := db.QueryRow(`INSERT INTO system_lang_keys(lang_key) VALUES($1) RETURNING id`, key).Scan(&id); err != nil {
				t.Fatal(err)
			}
			// B5 excludes only the exact translation-table foreign-key reference.
			if _, err := db.Exec(`INSERT INTO system_lang_key_sources VALUES($1,$2,'public.system_lang_key_translations.lang_key_id',CURRENT_DATE)`, id, source); err != nil {
				t.Fatal(err)
			}
			err := fixIssue(db, fmt.Sprintf("cat7_%d", id), nil)
			counting := source != "orphan" && source != "manual_crud" && source != "foreign_key"
			if counting && !errors.Is(err, errConsistencyFixSkipped) || !counting && err != nil {
				t.Fatal("changed source meaning", source, err)
			}
		})
	}
	// A key corrected or given a source after listing must survive its old fix ID.
	for _, change := range []string{"name", "source"} {
		var id int
		if err := db.QueryRow(`INSERT INTO system_lang_keys(lang_key) VALUES($1) RETURNING id`, "<stale_"+change+">").Scan(&id); err != nil {
			t.Fatal(err)
		}
		_ = checkGarbageLangKeys()
		if change == "name" {
			_, err := db.Exec(`UPDATE system_lang_keys SET lang_key='valid_repaired_name' WHERE id=$1`, id)
			if err != nil {
				t.Fatal(err)
			}
		} else {
			_, err := db.Exec(`INSERT INTO system_lang_key_sources VALUES($1,'code','new_use.go',CURRENT_DATE)`, id)
			if err != nil {
				t.Fatal(err)
			}
		}
		if err := fixIssue(db, fmt.Sprintf("cat7_%d", id), nil); !errors.Is(err, errConsistencyFixSkipped) {
			t.Fatal(change, err)
		}
	}
	if err := fixIssue(db, "cat8_999999", nil); !errors.Is(err, errConsistencyFixSkipped) {
		t.Fatal(err)
	}
}
