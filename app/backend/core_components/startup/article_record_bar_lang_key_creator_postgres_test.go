// article_record_bar_lang_key_creator_postgres_test.go
// Proves close creation and consecutive startup idempotence with the public schema.
// Connects the creator to the existing opt-in disposable PostgreSQL fixture.
// Verifies owner copy, Chinese review state and unchanged normalized timestamps.
package startup

import (
	"reflect"
	"testing"
)

func TestArticleRecordBarCloseSecondBootPostgres(t *testing.T) {
	db := translationBootstrapDB(t)
	execSQL := func(query string) {
		t.Helper()
		if _, err := db.Exec(query); err != nil {
			t.Fatal(err)
		}
	}
	// This fixture owns its whole disposable database; no installation data is used.
	execSQL(`DELETE FROM system_lang_keys WHERE lang_key = 'close'`)
	EnsureArticleRecordBarLangKeys(db)
	var fi, en, ch string
	var count int
	if err := db.QueryRow(`SELECT fi, en, ch FROM system_lang_keys WHERE lang_key='close'`).Scan(&fi, &en, &ch); err != nil {
		t.Fatal(err)
	}
	if fi != "Sulje" || en != "Close" || ch != "关闭" {
		t.Fatalf("unexpected initial copy: %q %q %q", fi, en, ch)
	}
	if err := db.QueryRow(`SELECT count(*) FROM system_lang_key_translations t JOIN system_lang_keys k ON k.id=t.lang_key_id
		WHERE k.lang_key='close' AND t.language_code IN ('zh-CN','zh-TW','zh-HK') AND review_status='needs_review'`).Scan(&count); err != nil || count != 3 {
		t.Fatalf("Chinese variants awaiting review = %d: %v", count, err)
	}
	execSQL(`UPDATE system_lang_keys SET fi='Omistajan sulkeminen', en='', ch=NULL WHERE lang_key='close'`)
	execSQL(`UPDATE system_lang_key_translations SET translation='Owner copy', review_status='approved'
		WHERE lang_key_id=(SELECT id FROM system_lang_keys WHERE lang_key='close')`)
	// The schema forbids empty translations, so a missing zh-TW row stands for unfilled copy.
	execSQL(`DELETE FROM system_lang_key_translations WHERE language_code='zh-TW'
		AND lang_key_id=(SELECT id FROM system_lang_keys WHERE lang_key='close')`)
	EnsureArticleRecordBarLangKeys(db)
	if err := db.QueryRow(`SELECT fi, en, ch FROM system_lang_keys WHERE lang_key='close'`).Scan(&fi, &en, &ch); err != nil {
		t.Fatal(err)
	}
	if fi != "Omistajan sulkeminen" || en != "Close" || ch != "关闭" {
		t.Fatal("creator did not preserve owner text and fill empty values", fi, en, ch)
	}
	snapshot := func() []string {
		t.Helper()
		rows, err := db.Query(`SELECT row_to_json(t)::text FROM system_lang_key_translations t JOIN system_lang_keys k ON k.id=t.lang_key_id
			WHERE k.lang_key='close' ORDER BY t.language_code`)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		var result []string
		for rows.Next() {
			var value string
			if err := rows.Scan(&value); err != nil {
				t.Fatal(err)
			}
			result = append(result, value)
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		return result
	}
	before := snapshot()
	var legacyBefore, legacyAfter string
	if err := db.QueryRow(`SELECT row_to_json(k)::text FROM system_lang_keys k WHERE lang_key='close'`).Scan(&legacyBefore); err != nil {
		t.Fatal(err)
	}
	EnsureArticleRecordBarLangKeys(db)
	if after := snapshot(); !reflect.DeepEqual(before, after) || len(after) != 5 {
		t.Fatal("second boot changed translations, review state, timestamps or count", before, after)
	}
	if err := db.QueryRow(`SELECT row_to_json(k)::text FROM system_lang_keys k WHERE lang_key='close'`).Scan(&legacyAfter); err != nil || legacyAfter != legacyBefore {
		t.Fatal("second boot changed the legacy key", legacyBefore, legacyAfter, err)
	}
	var value, review string
	if err := db.QueryRow(`SELECT translation, review_status FROM system_lang_key_translations t JOIN system_lang_keys k ON k.id=t.lang_key_id
		WHERE k.lang_key='close' AND language_code='zh-TW'`).Scan(&value, &review); err != nil || value != "關閉" || review != "needs_review" {
		t.Fatal("missing Chinese value was not filled for review", value, review, err)
	}
}
