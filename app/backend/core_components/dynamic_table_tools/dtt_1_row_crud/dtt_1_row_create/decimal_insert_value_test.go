// decimal_insert_value_test.go
// Verifies that an empty decimal field is read as missing data, not as text.
// Bridges a form's empty input with what an exact-decimal column accepts.
// Exists because adding a row to a dataset with a price column failed with
// "invalid input syntax for type numeric" the moment that column stopped being
// JSON and became a number. Dates, JSON values and integers each already had
// this rule written for them; decimals had none, so the whole insert failed
// with a database message no one could act on.
package dtt_1_row_create

import "testing"

func TestAnEmptyDecimalIsMissingDataRatherThanEmptyText(t *testing.T) {
	value, err := normalizeDecimalInsertValue("", true)
	if err != nil {
		t.Fatalf("an empty optional price should be accepted: %v", err)
	}
	if value != nil {
		t.Fatalf("an empty optional price should be stored as missing, got %#v", value)
	}

	// A column that forbids NULL keeps the zero its integer sibling uses, so
	// the two types behave the same way in the same form.
	value, err = normalizeDecimalInsertValue("   ", false)
	if err != nil {
		t.Fatalf("an empty required price should not fail: %v", err)
	}
	if value != "0" {
		t.Fatalf("an empty required price should fall back to zero, got %#v", value)
	}
}

func TestADecimalKeepsItsCents(t *testing.T) {
	value, err := normalizeDecimalInsertValue("22.39", true)
	if err != nil || value != "22.39" {
		t.Fatalf("22.39 should pass through unchanged, got %#v (%v)", value, err)
	}

	// A comma is what a Finnish keyboard produces for a decimal point.
	value, err = normalizeDecimalInsertValue("22,39", true)
	if err != nil || value != "22.39" {
		t.Fatalf("a comma should be read as a decimal point, got %#v (%v)", value, err)
	}
}

func TestSomethingThatIsNotANumberIsRefusedByColumn(t *testing.T) {
	if _, err := normalizeDecimalInsertValue("kaksikymmentä", true); err == nil {
		t.Fatal("text that is not a number should be refused before the database sees it")
	}
}

func TestOnlyExactDecimalColumnsTakeThisRule(t *testing.T) {
	for _, dataType := range []string{"numeric", "numeric(18,2)", "decimal", "real", "double precision"} {
		if !isDecimalType(dataType) {
			t.Errorf("%q should be treated as a decimal column", dataType)
		}
	}
	for _, dataType := range []string{"integer", "bigint", "text", "jsonb", "date"} {
		if isDecimalType(dataType) {
			t.Errorf("%q must keep the rule it already had", dataType)
		}
	}
}
