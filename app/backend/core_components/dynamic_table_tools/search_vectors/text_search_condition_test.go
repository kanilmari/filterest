// text_search_condition_test.go
// Verifies the one free-text search every searchable list builds its condition from.
// Between: dataset listings, the assisted search and the workline observatory.
// Exists so the rules those lists share are pinned in one place: word beginnings,
// any of the words, a plain number naming its row first, and a total order.
package dtt_search_vectors

import (
	"reflect"
	"testing"
)

func TestTextSearchConditionMatchesAnyWordAtItsBeginning(t *testing.T) {
	search, ok := TextSearchCondition("Kahvila  kaninkolo", "v", "t.id", 3)
	if !ok {
		t.Fatal("a search with words must add a condition")
	}
	if search.Predicate != "(v) @@ to_tsquery('simple', $3)" {
		t.Fatalf("predicate = %q", search.Predicate)
	}
	if !reflect.DeepEqual(search.Args, []interface{}{"kahvila:* | kaninkolo:*"}) {
		t.Fatalf("args = %#v", search.Args)
	}
	if search.OrderBy != " ORDER BY ts_rank(v, to_tsquery('simple', $3)) DESC, t.id DESC" {
		t.Fatalf("order = %q", search.OrderBy)
	}
}

func TestTextSearchConditionPutsTheRowANumberNamesFirst(t *testing.T) {
	search, ok := TextSearchCondition("127", "v", "w.id", 1)
	if !ok {
		t.Fatal("a number is a search")
	}
	if search.Predicate != "((v) @@ to_tsquery('simple', $1) OR w.id = $2)" {
		t.Fatalf("predicate = %q", search.Predicate)
	}
	if !reflect.DeepEqual(search.Args, []interface{}{"127:*", 127}) {
		t.Fatalf("args = %#v", search.Args)
	}
	if search.OrderBy != " ORDER BY (w.id = $2) DESC, ts_rank(v, to_tsquery('simple', $1)) DESC, w.id DESC" {
		t.Fatalf("order = %q", search.OrderBy)
	}
}

func TestTextSearchConditionLeavesAListWithoutWordsAlone(t *testing.T) {
	for _, raw := range []string{"", "   ", "\t\n"} {
		if search, ok := TextSearchCondition(raw, "v", "t.id", 1); ok || search.Predicate != "" || search.Args != nil {
			t.Fatalf("%q must add no condition: %#v", raw, search)
		}
	}
}

func TestNumericIDSearchAcceptsOnlyAPlainNumber(t *testing.T) {
	for raw, want := range map[string]bool{"127": true, "0": true, "#127": false, "WL127": false, "12 7": false, "-1": false, "": false} {
		if _, got := NumericIDSearch(raw); got != want {
			t.Fatalf("NumericIDSearch(%q) = %v, want %v", raw, got, want)
		}
	}
}
