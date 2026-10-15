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
	search, ok := TextSearchCondition("Kahvila  kaninkolo", "v", "t.id", 3, IDSearch{})
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
	search, ok := TextSearchCondition("127", "v", "w.id", 1, IDSearch{127, true})
	if !ok {
		t.Fatal("a number is a search")
	}
	if search.Predicate != "((v) @@ to_tsquery('simple', $1) OR w.id = $2::bigint)" {
		t.Fatalf("predicate = %q", search.Predicate)
	}
	if !reflect.DeepEqual(search.Args, []interface{}{"127:*", 127}) {
		t.Fatalf("args = %#v", search.Args)
	}
	if search.OrderBy != " ORDER BY (w.id = $2::bigint) DESC, ts_rank(v, to_tsquery('simple', $1)) DESC, w.id DESC" {
		t.Fatalf("order = %q", search.OrderBy)
	}
}

func TestTextSearchConditionLeavesAListWithoutWordsAlone(t *testing.T) {
	for _, raw := range []string{"", "   ", "\t\n"} {
		if search, ok := TextSearchCondition(raw, "v", "t.id", 1, IDSearch{}); ok || search.Predicate != "" || search.Args != nil {
			t.Fatalf("%q must add no condition: %#v", raw, search)
		}
	}
}

func TestNumericIDSearchAcceptsOnlyWholeDecimalIntegers(t *testing.T) {
	for raw, want := range map[string]int{
		"843": 843, "#843": 843, " 843 ": 843, "\t#843\n": 843,
		"00843": 843, "#00843": 843, "0": 0, "-0": 0, "+843": 843,
		"-843": -843, "#-843": -843, "#+843": 843,
		"9223372036854775807":  9223372036854775807,
		"-9223372036854775808": -9223372036854775808,
	} {
		if got, ok := NumericIDSearch(raw); !ok || got != want {
			t.Errorf("NumericIDSearch(%q) = %d, %t; want %d, true", raw, got, ok, want)
		}
	}
	for _, raw := range []string{
		"", " ", "#", "##843", "# 843", "843a", "WL843", "8 43", "843 9",
		"+", "-", "--843", "+-843", "-#843", "843.0", "8e3", "８４３",
		"9223372036854775808", "-9223372036854775809", "999999999999999999999999999999999999",
	} {
		if _, ok := NumericIDSearch(raw); ok {
			t.Errorf("NumericIDSearch(%q) accepted a non-integer or overflow", raw)
		}
	}
}

func TestIDSearchKeepsOtherMatchesAndTheirPlaceholders(t *testing.T) {
	for _, raw := range []string{"843", "#843", " 843 "} {
		search, _ := TextSearchCondition(raw, "v", "t.id", 4, IDSearch{843, true})
		if !reflect.DeepEqual(search.Args, []interface{}{"843:*", 843}) {
			t.Errorf("%q args = %#v", raw, search.Args)
		}
		if search.IDPredicate != "t.id = $5::bigint" {
			t.Errorf("%q ID predicate = %q", raw, search.IDPredicate)
		}
	}
	search, _ := TextSearchCondition("843", "v", "t.id", 4, IDSearch{})
	if len(search.Args) != 1 || search.IDPredicate != "" || search.Predicate != "(v) @@ to_tsquery('simple', $4)" {
		t.Fatalf("ineligible key must keep text search: %+v", search)
	}
	withoutID, _ := TextSearchCondition("843", "v", "", 4, IDSearch{})
	if withoutID.OrderBy != " ORDER BY ts_rank(v, to_tsquery('simple', $4)) DESC" {
		t.Fatalf("dataset without id: %+v", withoutID)
	}
}

func TestIDSearchStableLift(t *testing.T) {
	for _, tc := range []struct {
		rows, want []int
		enabled    bool
	}{
		{[]int{4, 9, 843, 2}, []int{843, 4, 9, 2}, true},
		{[]int{4, 9, 2}, []int{4, 9, 2}, true},
		{[]int{843, 4, 2}, []int{843, 4, 2}, true},
		{[]int{4, 843, 2}, []int{4, 843, 2}, false},
		{nil, nil, true},
	} {
		got := (IDSearch{843, tc.enabled}).Prioritize(tc.rows)
		if !reflect.DeepEqual(got, tc.want) {
			t.Errorf("lift = %v, want %v", got, tc.want)
		}
	}
}

func TestIDSearchOrderByCompositionUnderAnySort(t *testing.T) {
	search, _ := TextSearchCondition("843", "v", "t.id", 4, IDSearch{843, true})
	for _, tc := range []struct {
		name, active, want string
	}{
		{"relevance", "", " ORDER BY (t.id = $5::bigint) DESC, ts_rank(v, to_tsquery('simple', $4)) DESC, t.id DESC"},
		{"created_desc", " ORDER BY t.created DESC, t.id DESC", " ORDER BY (t.id = $5::bigint) DESC, t.created DESC, t.id DESC"},
		{"id_desc", " ORDER BY t.id DESC", " ORDER BY (t.id = $5::bigint) DESC, t.id DESC"},
		{"id_asc", " ORDER BY t.id ASC", " ORDER BY (t.id = $5::bigint) DESC, t.id ASC"},
		{"default_newest", " ORDER BY t.created DESC NULLS LAST, t.id DESC", " ORDER BY (t.id = $5::bigint) DESC, t.created DESC NULLS LAST, t.id DESC"},
		{"images_first", " ORDER BY (t.image IS NOT NULL) DESC, t.id DESC", " ORDER BY (t.id = $5::bigint) DESC, (t.image IS NOT NULL) DESC, t.id DESC"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := search.OrderByWithSort(tc.active); got != tc.want {
				t.Fatalf("order=%q, want %q", got, tc.want)
			}
		})
	}
	if !reflect.DeepEqual(search.Args, []interface{}{"843:*", 843}) ||
		search.Predicate != "((v) @@ to_tsquery('simple', $4) OR t.id = $5::bigint)" {
		t.Fatalf("composing a sort changed the condition or arguments: %+v", search)
	}
}

func TestIDSearchSortCompositionLeavesOrdinarySearchesAlone(t *testing.T) {
	for _, tc := range []struct{ name, term, idExpr string }{
		{"non_integer", "843a", "t.id"},
		{"ineligible_key", "843", "t.id"},
		{"no_id", "843", ""},
		{"no_search", "", "t.id"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			search, _ := TextSearchCondition(tc.term, "v", tc.idExpr, 1, IDSearch{})
			for _, active := range []string{" ORDER BY t.created DESC, t.id DESC", " ORDER BY t.title ASC"} {
				if got := search.OrderByWithSort(active); got != active {
					t.Fatalf("order=%q, want unchanged %q", got, active)
				}
			}
			if got := search.OrderByWithSort(""); got != search.OrderBy {
				t.Fatalf("relevance changed: %q", got)
			}
		})
	}
}
