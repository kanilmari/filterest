// board_query_test.go
// Exercises query behavior used by the shared search, filter and sorting controls.
// Protects independent phase/status semantics and stable data when no rows match.
package workline_observatory

import (
	"net/url"
	"testing"
	"time"
)

func TestBoardQueryCombinesDimensionsWithoutChangingReportedPhase(t *testing.T) {
	snapshot := BoardSnapshot{Worklines: []BoardWorkline{
		{ID: 1, Title: "Dokumentaatio", Priority: "high", Status: "closed", CurrentPhase: 4, LatestReport: &BoardWorklineReport{NextStep: "Siirrä kehitysopas"}},
		{ID: 2, Title: "Kehitysopas", Priority: "normal", Status: "active", CurrentPhase: 4},
	}}
	// The database search found both; the filters then keep only the first.
	got, err := queryBoardSnapshot(snapshot, url.Values{"search": {"kehitysopas"}, "priority": {"high"}, "current_phase": {"4"}}, []int64{2, 1})
	if err != nil || got.TotalCount != 2 || got.FilteredCount != 1 || got.Worklines[0].ID != 1 {
		t.Fatalf("combined filter: %#v, %v", got, err)
	}
	if got.Worklines[0].CurrentPhase != 4 || got.Worklines[0].Status != "closed" {
		t.Fatal("query changed phase or lifecycle state")
	}
	got, err = queryBoardSnapshot(snapshot, url.Values{"status_exclude": {"closed,archived"}}, nil)
	if err != nil || len(got.Worklines) != 1 || got.Worklines[0].ID != 2 {
		t.Fatalf("exclude filter: %#v, %v", got, err)
	}
	got, err = queryBoardSnapshot(snapshot, url.Values{"search": {"no match"}}, []int64{})
	if err != nil || got.Worklines == nil || got.FilteredCount != 0 || got.TotalCount != 2 {
		t.Fatalf("empty filter: %#v, %v", got, err)
	}
}

func TestBoardSearchListsBestMatchFirstUnlessAnOrderWasChosen(t *testing.T) {
	now := time.Now()
	snapshot := BoardSnapshot{Worklines: []BoardWorkline{
		{ID: 129, Title: "b", UpdatedAt: now}, {ID: 127, Title: "c", UpdatedAt: now.Add(-time.Hour)},
		{ID: 113, Title: "a", UpdatedAt: now.Add(-2 * time.Hour)},
	}}
	// The search found 127 first (its own number) and 113 second; 129 not at all.
	found := []int64{127, 113}
	for _, item := range []struct {
		query url.Values
		ids   []int64
	}{
		{url.Values{"search": {"127"}}, []int64{127, 113}},
		{url.Values{"search": {"127"}, "sort_column": {"__newest"}, "sort_order": {"DESC"}}, []int64{127, 113}},
		{url.Values{"search": {"127"}, "sort_column": {"__newest"}, "sort_order": {"ASC"}}, []int64{113, 127}},
		{url.Values{"search": {"127"}, "sort_column": {"title"}, "sort_order": {"ASC"}}, []int64{113, 127}},
	} {
		got, err := queryBoardSnapshot(snapshot, item.query, found)
		if err != nil || got.TotalCount != 3 || len(got.Worklines) != len(item.ids) {
			t.Fatalf("%v: %#v, %v", item.query, got, err)
		}
		for i, id := range item.ids {
			if got.Worklines[i].ID != id {
				t.Fatalf("%v: order = %#v, want %v", item.query, got.Worklines, item.ids)
			}
		}
	}
}

func TestBoardQuerySortsPrioritySemanticallyAndKeepsStableTieBreak(t *testing.T) {
	now := time.Now()
	snapshot := BoardSnapshot{Worklines: []BoardWorkline{
		{ID: 2, Priority: "normal", UpdatedAt: now}, {ID: 1, Priority: "critical", UpdatedAt: now},
		{ID: 4, Priority: "high", UpdatedAt: now}, {ID: 3, Priority: "high", UpdatedAt: now},
	}}
	for _, item := range []struct {
		query url.Values
		ids   []int64
	}{
		{url.Values{}, []int64{4, 3, 2, 1}},
		{url.Values{"sort_column": {"priority"}}, []int64{1, 4, 3, 2}},
		{url.Values{"sort_column": {"priority"}, "sort_order": {"ASC"}}, []int64{2, 3, 4, 1}},
	} {
		got, err := queryBoardSnapshot(snapshot, item.query, nil)
		if err != nil {
			t.Fatal(err)
		}
		for i, id := range item.ids {
			if got.Worklines[i].ID != id {
				t.Fatalf("sort = %#v, want %v", got.Worklines, item.ids)
			}
		}
	}
}

func TestBoardQueryRejectsUnknownValues(t *testing.T) {
	for _, query := range []url.Values{
		{"priority": {"urgent"}}, {"status": {"done"}}, {"current_phase": {"7"}},
		{"current_phase": {"04"}}, {"sort_column": {"title;DROP TABLE"}}, {"sort_order": {"random"}},
	} {
		if _, err := queryBoardSnapshot(BoardSnapshot{}, query, nil); err == nil {
			t.Fatalf("accepted invalid query: %v", query)
		}
	}
}
