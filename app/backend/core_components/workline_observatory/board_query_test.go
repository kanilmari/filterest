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
	got, err := queryBoardSnapshot(snapshot, url.Values{"search": {"KEHITYSOPAS"}, "priority": {"high"}, "current_phase": {"4"}})
	if err != nil || got.TotalCount != 2 || got.FilteredCount != 1 || got.Worklines[0].ID != 1 {
		t.Fatalf("combined filter: %#v, %v", got, err)
	}
	if got.Worklines[0].CurrentPhase != 4 || got.Worklines[0].Status != "closed" {
		t.Fatal("query changed phase or lifecycle state")
	}
	got, err = queryBoardSnapshot(snapshot, url.Values{"status_exclude": {"closed,archived"}})
	if err != nil || len(got.Worklines) != 1 || got.Worklines[0].ID != 2 {
		t.Fatalf("exclude filter: %#v, %v", got, err)
	}
	got, err = queryBoardSnapshot(snapshot, url.Values{"search": {"no match"}})
	if err != nil || got.Worklines == nil || got.FilteredCount != 0 || got.TotalCount != 2 {
		t.Fatalf("empty filter: %#v, %v", got, err)
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
		got, err := queryBoardSnapshot(snapshot, item.query)
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
		if _, err := queryBoardSnapshot(BoardSnapshot{}, query); err == nil {
			t.Fatalf("accepted invalid query: %v", query)
		}
	}
}
