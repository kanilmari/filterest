// ai_group_text_search_exclusion_test.go
// Verifies that the AI group of a search holds only rows the text search does not list.
// Bridges the streamed AI stage with the dataset listing's own free-text condition.
// Exists because the AI stage used to leave out only the stream's first ten text
// hits: a row the listing matched further down was suggested by the AI and then
// met again when the reader scrolled to it.
package dtt_1_row_read

import (
	"fmt"
	"testing"
)

func TestTheAIGroupLeavesOutEveryRowTheListingShowsPostgres(t *testing.T) {
	db := relevanceDB(t)
	// Thirty more matches, so the listing holds far more than the ten rows a
	// top-ten text answer carries.
	if _, err := db.Exec(`
        INSERT INTO tasks
        SELECT g, 'report ' || g, 'filler' FROM generate_series(10, 39) AS g;
    `); err != nil {
		t.Fatal(err)
	}

	listed, _ := searchedIDs(t, db, "report")
	if len(listed) <= 10 {
		t.Fatalf("the fixture needs more than ten matches, got %d", len(listed))
	}
	listedSet := make(map[int]bool, len(listed))
	for _, id := range listed {
		listedSet[id] = true
	}

	// Candidates in the order the semantic search ranked them: a match deep in
	// the listing, the one row that does not match, and the best match.
	candidates := []int{listed[len(listed)-1], 3, listed[25], listed[0]}
	outside, err := rowsOutsideDatasetTextSearch(db, "tasks", "report", candidates)
	if err != nil {
		t.Fatal(err)
	}

	if fmt.Sprint(outside) != "[3]" {
		t.Fatalf("only the row the listing does not show may remain, got %v from %v", outside, candidates)
	}
	for _, id := range outside {
		if listedSet[id] {
			t.Fatalf("row %d is in the listing and in the AI group", id)
		}
	}
}

func TestTheAIGroupKeepsTheSemanticOrderPostgres(t *testing.T) {
	db := relevanceDB(t)
	if _, err := db.Exec(`
        INSERT INTO tasks VALUES
            (4, 'garden hose', 'watering'),
            (5, 'kitchen sink', 'plumbing');
    `); err != nil {
		t.Fatal(err)
	}

	outside, err := rowsOutsideDatasetTextSearch(db, "tasks", "report", []int{5, 2, 3, 4})
	if err != nil {
		t.Fatal(err)
	}

	if fmt.Sprint(outside) != "[5 3 4]" {
		t.Fatalf("the remaining rows must keep the order they were given in, got %v", outside)
	}
}

func TestSearchingANumberKeepsThatRowOutOfTheAIGroupPostgres(t *testing.T) {
	db := relevanceDB(t)

	// The listing shows row 3 for the search "3", so the AI group must not.
	outside, err := rowsOutsideDatasetTextSearch(db, "tasks", "3", []int{3, 1})
	if err != nil {
		t.Fatal(err)
	}

	if fmt.Sprint(outside) != "[1]" {
		t.Fatalf("the searched row number is listed and must leave the AI group, got %v", outside)
	}
}

func TestASearchWithoutAConditionLeavesNothingForTheAIGroupPostgres(t *testing.T) {
	db := relevanceDB(t)

	// Nothing to match on means the listing shows every row, so every
	// candidate is already on screen.
	outside, err := rowsOutsideDatasetTextSearch(db, "tasks", "   ", []int{1, 2, 3})
	if err != nil {
		t.Fatal(err)
	}

	if len(outside) != 0 {
		t.Fatalf("every row is listed, so none may be suggested again: %v", outside)
	}
}

func TestNoCandidatesAskNothing(t *testing.T) {
	// No database is needed when the semantic search found nothing close.
	outside, err := rowsOutsideDatasetTextSearch(nil, "tasks", "report", nil)
	if err != nil {
		t.Fatalf("no candidates should not be an error: %v", err)
	}
	if len(outside) != 0 {
		t.Fatalf("nothing in, nothing out: %v", outside)
	}
}
