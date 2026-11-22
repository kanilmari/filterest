// item_label_rename_test.go
// Checks the rename label plan: which languages a rename fills, writes or refuses.
// Exercises the pure decision step that runs before any database write.
// Keeps the K357 rule executable: a shared key and languages nobody typed survive a rename.
package lang

import (
	"database/sql"
	"errors"
	"reflect"
	"testing"
)

func labelState(id int64, columns map[string]string, rows map[string]translationRow) *keyLanguageState {
	if columns == nil {
		columns = map[string]string{}
	}
	if rows == nil {
		rows = map[string]translationRow{}
	}
	return &keyLanguageState{id: id, columns: columns, rows: rows}
}

func stringValue(value *string) string {
	if value == nil {
		return "<nil>"
	}
	return *value
}

func TestItemLabelRenameRefusesOtherLanguagesAndItemTypes(t *testing.T) {
	for name, rename := range map[string]ItemLabelRename{
		"cantonese fans out":    {SourceType: "table", OldKey: "a", NewKey: "b", Translations: map[string]string{"yue": "x"}},
		"unknown locale":        {SourceType: "folder", OldKey: "a", NewKey: "b", Translations: map[string]string{"sv": "x"}},
		"unknown shown locale":  {SourceType: "folder", OldKey: "a", NewKey: "b", Shown: map[string]string{"zh-TW": "x"}},
		"unknown item type":     {SourceType: "column", OldKey: "a", NewKey: "b"},
		"missing new name":      {SourceType: "table", OldKey: "a", NewKey: " "},
		"missing previous name": {SourceType: "table", OldKey: "", NewKey: "b"},
	} {
		t.Run(name, func(t *testing.T) {
			if err := validateItemLabelRename(rename); !errors.Is(err, ErrInvalidItemLabelRename) {
				t.Fatal("accepted", err)
			}
		})
	}
	if err := validateItemLabelRename(ItemLabelRename{SourceType: "table", OldKey: "a", NewKey: "b",
		Translations: map[string]string{"fi": "A", "en": "", "ch": "甲"}, Shown: map[string]string{"fi": "A"}}); err != nil {
		t.Fatal(err)
	}
}

func TestItemLabelPlanCopiesEveryLanguageIntoANewKey(t *testing.T) {
	old := labelState(7, map[string]string{"fi": "Tilaukset", "en": "Orders", "ch": "订单", "yue": "訂單"},
		map[string]translationRow{
			"fi":    {"Tilaukset", "legacy_fi", "approved"},
			"zh-CN": {"订单", "legacy_ch", "needs_review"},
			"zh-TW": {"訂單", "import", "unreviewed"},
			"sv":    {"Beställningar", "manual", "approved"},
		})
	old.langKeyType = sql.NullInt64{Int64: 3, Valid: true}
	old.creationSpec = sql.NullString{String: "Interface label derived from dataset schema names.", Valid: true}
	plan, err := planItemLabelRename(ItemLabelRename{SourceType: "table", OldKey: "tilaukset", NewKey: "orders",
		Translations: map[string]string{"fi": "Tilaukset", "en": "Orders"}}, old, labelState(0, nil, nil), true)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(plan.fillColumns, old.columns) || !reflect.DeepEqual(plan.copyRows, old.rows) {
		t.Fatal("new key is not a full copy", plan.fillColumns, plan.copyRows)
	}
	if plan.fillLangKeyType != old.langKeyType || plan.fillCreationSpec != old.creationSpec {
		t.Fatal("type or privacy note not carried", plan.fillLangKeyType, plan.fillCreationSpec)
	}
	if plan.edits.Fi != nil || plan.edits.En != nil || plan.edits.Ch != nil || plan.edits.Yue != nil {
		t.Fatal("unchanged text rewritten", stringValue(plan.edits.Fi), stringValue(plan.edits.En))
	}
}

func TestItemLabelPlanFillsOnlyWhatAnExistingKeyShowsInNeitherStore(t *testing.T) {
	old := labelState(7, map[string]string{"fi": "Tilaukset", "en": "Orders", "ch": "订单", "yue": "訂單"},
		map[string]translationRow{
			"fi":    {"Tilaukset", "legacy_fi", "approved"},
			"en":    {"Orders", "legacy_en", "approved"},
			"zh-CN": {"订单", "legacy_ch", "needs_review"},
			"zh-HK": {"訂單", "manual", "needs_review"},
			"sv":    {"Beställningar", "manual", "approved"},
			"de":    {"Bestellungen", "manual", "approved"},
		})
	// The existing key shows Finnish only through its normalized row, Chinese in its column,
	// Traditional Chinese through zh-TW, and German of its own.
	dest := labelState(9, map[string]string{"fi": " ", "ch": "订购"},
		map[string]translationRow{
			"fi":    {"Tilaus", "manual", "approved"},
			"zh-TW": {"訂購", "manual", "approved"},
			"de":    {"Aufträge", "manual", "approved"},
		})
	plan, err := planItemLabelRename(ItemLabelRename{SourceType: "table", OldKey: "tilaukset", NewKey: "orders"}, old, dest, false)
	if err != nil {
		t.Fatal(err)
	}
	if want := map[string]string{"en": "Orders"}; !reflect.DeepEqual(plan.fillColumns, want) {
		t.Fatal("filled a language the key already shows", plan.fillColumns)
	}
	if want := map[string]translationRow{"en": old.rows["en"], "sv": old.rows["sv"]}; !reflect.DeepEqual(plan.copyRows, want) {
		t.Fatal("copied rows", plan.copyRows)
	}
}

func TestItemLabelPlanSkipsUntouchedPrefillsAndNeverWritesAnExistingKey(t *testing.T) {
	old := labelState(7, map[string]string{"fi": "Tilaukset", "en": "Orders"}, nil)
	shown := map[string]string{"fi": "Tilaukset", "en": "Orders"}

	// Owner, 22.11.2026: "Älä muuta jaettua avainta". An existing key of the new name is never
	// written by the dialog; it only receives languages it lacks, and differing text is reported.
	t.Run("untouched prefill never reaches an existing shared key and is reported", func(t *testing.T) {
		dest := labelState(9, map[string]string{"fi": "Tilaus", "en": "Purchase orders"}, nil)
		plan, err := planItemLabelRename(ItemLabelRename{SourceType: "table", OldKey: "tilaukset", NewKey: "orders",
			Translations: map[string]string{"fi": "Tilaukset", "en": "Orders"}, Shown: shown}, old, dest, false)
		if err != nil || plan.edits.Fi != nil || plan.edits.En != nil || !reflect.DeepEqual(plan.keptLanguages, []string{"fi", "en"}) {
			t.Fatal("shared key written or not reported", err, stringValue(plan.edits.Fi), stringValue(plan.edits.En), plan.keptLanguages)
		}
	})
	t.Run("typed text for an existing key is kept out and reported, not refused", func(t *testing.T) {
		dest := labelState(9, map[string]string{"en": "Purchase orders"}, nil)
		plan, err := planItemLabelRename(ItemLabelRename{SourceType: "table", OldKey: "tilaukset", NewKey: "orders",
			Translations: map[string]string{"en": "Customer orders"}, Shown: shown}, old, dest, false)
		if err != nil || plan.edits.En != nil || !reflect.DeepEqual(plan.keptLanguages, []string{"en"}) {
			t.Fatal(err, stringValue(plan.edits.En), plan.keptLanguages)
		}
	})
	t.Run("an API rename without shown text cannot write an existing key either", func(t *testing.T) {
		dest := labelState(9, nil, map[string]translationRow{"en": {"Purchase orders", "manual", "approved"}})
		plan, err := planItemLabelRename(ItemLabelRename{SourceType: "folder", OldKey: "tilaukset", NewKey: "orders",
			Translations: map[string]string{"en": "Orders"}}, old, dest, false)
		if err != nil || plan.edits.En != nil || !reflect.DeepEqual(plan.keptLanguages, []string{"en"}) {
			t.Fatal(err, stringValue(plan.edits.En), plan.keptLanguages)
		}
	})
	t.Run("a language the existing key lacked is filled from the old key, not from typed text", func(t *testing.T) {
		dest := labelState(9, map[string]string{"en": "Orders"}, nil)
		plan, err := planItemLabelRename(ItemLabelRename{SourceType: "table", OldKey: "tilaukset", NewKey: "orders",
			Translations: map[string]string{"fi": "Tilauskanta", "en": "Orders"}, Shown: shown}, old, dest, false)
		if err != nil || plan.edits.Fi != nil || plan.edits.En != nil || plan.fillColumns["fi"] != "Tilaukset" ||
			!reflect.DeepEqual(plan.keptLanguages, []string{"fi"}) {
			t.Fatal(err, stringValue(plan.edits.Fi), plan.fillColumns, plan.keptLanguages)
		}
	})
	t.Run("matching text and blank fields need no notice", func(t *testing.T) {
		dest := labelState(9, map[string]string{"fi": "Tilaukset", "en": "Orders"}, nil)
		plan, err := planItemLabelRename(ItemLabelRename{SourceType: "table", OldKey: "tilaukset", NewKey: "orders",
			Translations: map[string]string{"fi": "Tilaukset", "en": " "}, Shown: shown}, old, dest, false)
		if err != nil || len(plan.keptLanguages) != 0 {
			t.Fatal(err, plan.keptLanguages)
		}
	})
	t.Run("same-name edit writes only the typed language", func(t *testing.T) {
		own := labelState(7, map[string]string{"fi": "Tilaukset", "en": "Orders", "ch": "订单"}, nil)
		plan, err := planItemLabelRename(ItemLabelRename{SourceType: "table", OldKey: "tilaukset", NewKey: "tilaukset",
			Translations: map[string]string{"fi": "Tilauskanta", "en": "Orders"}, Shown: shown}, nil, own, true)
		if err != nil || stringValue(plan.edits.Fi) != "Tilauskanta" || plan.edits.En != nil || plan.edits.Ch != nil || len(plan.fillColumns) != 0 {
			t.Fatal(err, stringValue(plan.edits.Fi), stringValue(plan.edits.En), stringValue(plan.edits.Ch))
		}
	})
	t.Run("blank typed text deletes nothing", func(t *testing.T) {
		own := labelState(7, map[string]string{"fi": "Tilaukset", "en": "Orders"}, nil)
		plan, err := planItemLabelRename(ItemLabelRename{SourceType: "folder", OldKey: "tilaukset", NewKey: "tilaukset",
			Translations: map[string]string{"fi": "", "en": "  "}, Shown: shown}, nil, own, true)
		if err != nil || plan.edits.Fi != nil || plan.edits.En != nil {
			t.Fatal("blank text written", err)
		}
	})
	t.Run("a stale dialog is refused", func(t *testing.T) {
		own := labelState(7, map[string]string{"fi": "Tilauskanta", "en": "Orders"}, nil)
		_, err := planItemLabelRename(ItemLabelRename{SourceType: "table", OldKey: "tilaukset", NewKey: "tilaukset",
			Translations: map[string]string{"fi": "Tilausrekisteri"}, Shown: shown}, nil, own, true)
		if !errors.Is(err, ErrItemLabelConflict) {
			t.Fatal("stale dialog overwrote a newer text", err)
		}
	})
	t.Run("a text kept only in the normalized row is not replaced unseen", func(t *testing.T) {
		// The dialog reads the legacy column, which is empty, so it showed no Finnish.
		own := labelState(7, map[string]string{"en": "Orders"}, map[string]translationRow{"fi": {"Tilauskanta", "manual", "approved"}})
		_, err := planItemLabelRename(ItemLabelRename{SourceType: "table", OldKey: "tilaukset", NewKey: "tilaukset",
			Translations: map[string]string{"fi": "Tilausrekisteri"}, Shown: map[string]string{"fi": "", "en": "Orders"}}, nil, own, true)
		if !errors.Is(err, ErrItemLabelConflict) {
			t.Fatal("normalized-only text replaced", err)
		}
	})
	t.Run("typing the text the key already has is not a conflict", func(t *testing.T) {
		own := labelState(7, map[string]string{"fi": "Tilauskanta"}, nil)
		plan, err := planItemLabelRename(ItemLabelRename{SourceType: "table", OldKey: "tilaukset", NewKey: "tilaukset",
			Translations: map[string]string{"fi": "Tilauskanta"}, Shown: shown}, nil, own, true)
		if err != nil || plan.edits.Fi != nil {
			t.Fatal(err)
		}
	})
}
