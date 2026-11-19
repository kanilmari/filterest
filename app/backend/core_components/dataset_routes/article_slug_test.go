// article_slug_test.go
// Checks the server's article address words against the examples the app's buildSlug also reads.
// Pins the row-segment parser that separates the row id from those words.
package dataset_routes

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestArticleSlugMatchesSharedExamples(t *testing.T) {
	path := filepath.Join("..", "..", "..", "testing", "shared_contracts", "article_slug_examples.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile(%s) error = %v", path, err)
	}
	var examples struct {
		ArticleSlug []struct {
			Why      string `json:"why"`
			Title    string `json:"title"`
			Expected string `json:"expected"`
		} `json:"articleSlug"`
	}
	if err := json.Unmarshal(raw, &examples); err != nil {
		t.Fatalf("Unmarshal(%s) error = %v", path, err)
	}
	if len(examples.ArticleSlug) == 0 {
		t.Fatal("shared slug examples are empty; the address pair would go unchecked")
	}
	for _, example := range examples.ArticleSlug {
		if got := ArticleSlug(example.Title); got != example.Expected {
			t.Errorf("%s: ArticleSlug(%q) = %q, want %q", example.Why, example.Title, got, example.Expected)
		}
	}
}

func TestParseArticleRowSegment(t *testing.T) {
	cases := []struct {
		segment, rowID, slug string
		ok                   bool
	}{
		{"287", "287", "", true},
		{"287-helsinki-to-vienna", "287", "helsinki-to-vienna", true},
		{"287-", "287", "", true},
		{"abc", "", "", false},
		{"", "", "", false},
		{"12x", "", "", false},
		{"1234567890123456789-too-long", "", "", false},
	}
	for _, c := range cases {
		rowID, slug, ok := ParseArticleRowSegment(c.segment)
		if rowID != c.rowID || slug != c.slug || ok != c.ok {
			t.Errorf("ParseArticleRowSegment(%q) = (%q, %q, %v), want (%q, %q, %v)", c.segment, rowID, slug, ok, c.rowID, c.slug, c.ok)
		}
	}
}
