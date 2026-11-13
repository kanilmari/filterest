// reading_hyphenation_test.go
// Exercises default and persisted FI/EN policies against a disposable PostgreSQL database.
package lang

import (
	"context"
	"testing"
)

func TestReadingHyphenationPersistsIndependentLanguageChoices(t *testing.T) {
	var notices []string
	db := translationDisposableDB(t, &notices)
	ctx := context.Background()
	_, err := db.Exec(`CREATE TABLE public.system_config (key text PRIMARY KEY, json_value jsonb, value_type int, creation_spec text, updated timestamptz)`)
	if err != nil {
		t.Fatal(err)
	}
	if got, err := readReadingHyphenation(ctx, db); err != nil || got != (readingHyphenation{Finnish: true}) {
		t.Fatalf("default policy: %+v; %v", got, err)
	}
	for _, policy := range []readingHyphenation{{English: true}, {Finnish: true, English: true}, {}} {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		if err := saveReadingHyphenation(ctx, tx, policy); err != nil {
			tx.Rollback()
			t.Fatal(err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatal(err)
		}
		if got, err := readReadingHyphenation(ctx, db); err != nil || got != policy {
			t.Fatalf("saved policy: %+v; %v", got, err)
		}
	}
}
