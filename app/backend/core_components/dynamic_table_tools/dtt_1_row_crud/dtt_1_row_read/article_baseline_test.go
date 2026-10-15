// article_baseline_test.go
// Checks legacy precedence, null/presence, IFAV ordering and exact JSON identifiers.
// Connects the before-report to shared browser examples and the active normalizer.
// Keeps settings evidence distinct from claims about rendered row values.
package dtt_1_row_read

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"

	contract "easelect/frontend/shared/article_presentations"
)

func TestArticleBaselineContractDrift(t *testing.T) {
	for alias, key := range contract.Read().Aliases {
		if normalizeResultsViewKey(alias) != key {
			t.Fatalf("server alias drift: %s", alias)
		}
	}
	for key := range contract.Read().Presentations {
		if normalizeResultsViewKey(key) != key {
			t.Fatalf("server key drift: %s", key)
		}
	}
}
func TestArticleBaselineWinner(t *testing.T) {
	n := func(id int64) sql.NullInt64 { return sql.NullInt64{Int64: id, Valid: true} }
	assignments := []articleBaselineAssignment{
		{id: 1, setID: 100, view: "article_view"},
		{id: 3, setID: 101, groupID: n(11), priority: 4, view: "article_view"},
		{id: 2, setID: 102, groupID: n(10), priority: 4, view: "article_view"},
		{id: 4, setID: 103, groupID: n(12), priority: 9, view: "article_view"},
		{id: 5, setID: 104, userID: n(2), view: "article_view"},
	}
	for _, test := range []struct {
		name    string
		context articleBaselineContext
		want    int64
	}{
		{"metadata", articleBaselineContext{kind: "metadata"}, 0},
		{"site", articleBaselineContext{kind: "site"}, 100},
		{"specific group", articleBaselineContext{kind: "group", id: 11}, 101},
		{"personal", articleBaselineContext{kind: "reader", id: 2, groups: []int64{10, 11, 12}}, 104},
		{"tied groups", articleBaselineContext{kind: "reader", id: 3, groups: []int64{11, 10}}, 102},
		{"competing groups", articleBaselineContext{kind: "reader", id: 4, groups: []int64{10, 12}}, 103},
		{"guest ignores field preferences", articleBaselineContext{kind: "reader", id: 1, groups: []int64{10, 12}}, 100},
		{"no matching groups", articleBaselineContext{kind: "reader", id: 5}, 100},
	} {
		t.Run(test.name, func(t *testing.T) {
			winner := articleBaselineWinner(assignments, "article_view", test.context)
			if test.want == 0 {
				if winner != nil {
					t.Fatal("unexpected assignment")
				}
				return
			}
			if winner == nil || winner.setID != test.want {
				t.Fatalf("winner=%+v", winner)
			}
		})
	}
	if articleBaselineWinner(assignments, "image_first_view", articleBaselineContext{kind: "site"}) != nil {
		t.Fatal("cross-view inheritance")
	}
}
func TestArticleBaselineBlocks(t *testing.T) {
	for _, test := range []struct {
		raw                    string
		present, open, invalid bool
	}{
		{`{}`, false, true, false},
		{`{"classic":{},"image_first":{}}`, true, true, false},
		{`{"classic":{"details":false},"image_first":{"details":false}}`, true, false, false},
		{`{"classic":{"details":true},"image_first":{"details":true}}`, true, true, false},
		{`{"classic":{"details":false},"image_first":{"details":null}}`, true, true, true},
		{`{"classic":null}`, true, true, true},
		{`null`, false, true, true},
		{`{"unknown":{}}`, false, true, true},
	} {
		t.Run(test.raw, func(t *testing.T) {
			blocks, err := articleBaselineBlocks([]byte(test.raw))
			if (err != nil) != test.invalid {
				t.Fatal("validity mismatch")
			}
			if blocks["classic"].Present != test.present || blocks["classic"].InitialOpen["details"] != test.open {
				t.Fatalf("blocks=%+v", blocks)
			}
			if !blocks["classic"].InitialOpen["images"] {
				t.Fatal("absent images should open")
			}
			if test.invalid && len(blocks["classic"].Overrides) != 0 {
				t.Fatal("API rejection must not apply partial overrides")
			}
		})
	}
}
func TestArticleBaselineIFAVOrderSharedExamples(t *testing.T) {
	raw, err := os.ReadFile("../../../../../testing/shared_contracts/legacy_ifav_order_examples.json")
	if err != nil {
		t.Fatal(err)
	}
	var examples []struct {
		Fields  []ArticleBaselineField `json:"fields"`
		Ordered []string               `json:"ordered"`
	}
	if err := json.Unmarshal(raw, &examples); err != nil {
		t.Fatal(err)
	}
	for _, example := range examples {
		ordered := articleBaselineIFAVOrder(example.Fields)
		names := []string{}
		for _, f := range ordered {
			names = append(names, f.Name)
		}
		if !reflect.DeepEqual(names, example.Ordered) {
			t.Fatalf("got %v want %v", names, example.Ordered)
		}
	}
}
func TestArticleBaselineJSONPresenceAndLargeIDs(t *testing.T) {
	var output bytes.Buffer
	report := ArticleBaselineReport{Users: []ArticleBaselineUser{{ID: 9007199254740993, GroupIDs: []int64{}}}, Datasets: []ArticleBaselineDataset{}}
	if err := WriteArticlePresentationBaseline(&output, report); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), "9007199254740993") || !strings.Contains(output.String(), `"datasets": []`) {
		t.Fatal(output.String())
	}
	source, _ := json.Marshal(ArticleBaselineSource{Kind: "metadata"})
	if !strings.Contains(string(source), `"assignment_id":null`) {
		t.Fatal("presence lost", string(source))
	}
}
