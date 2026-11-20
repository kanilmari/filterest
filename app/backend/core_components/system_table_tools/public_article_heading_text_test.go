// public_article_heading_text_test.go
// Checks the server's heading reader against the examples the app's readInlineHeadingText also answers.
// Between app/testing/shared_contracts/heading_text_examples.json and publicArticleHeadingText.
// Keeps the title the server prints and the heading the app shows from drifting apart.
package system_table_tools

import (
	"encoding/json"
	"math/rand"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPublicArticleHeadingTextMatchesSharedExamples(t *testing.T) {
	path := filepath.Join("..", "..", "..", "testing", "shared_contracts", "heading_text_examples.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile(%s) error = %v", path, err)
	}
	var examples struct {
		HeadingText []struct {
			Why      string `json:"why"`
			Stored   string `json:"stored"`
			Expected string `json:"expected"`
		} `json:"headingText"`
	}
	if err := json.Unmarshal(raw, &examples); err != nil {
		t.Fatalf("Unmarshal(%s) error = %v", path, err)
	}
	if len(examples.HeadingText) == 0 {
		t.Fatal("shared heading examples are empty; the heading pair would go unchecked")
	}
	for _, example := range examples.HeadingText {
		if got := publicArticleHeadingText(example.Stored); got != example.Expected {
			t.Errorf("%s: publicArticleHeadingText(%q) = %q, want %q", example.Why, example.Stored, got, example.Expected)
		}
	}
}

// A stored heading is data the server did not write. Whatever it holds, broken
// markup and broken text encoding included, reading it must end without a
// failure, and nesting far deeper than a real heading must stay cheap: the
// reader remembers a bounded number of open tags.
func TestPublicArticleHeadingTextSurvivesAnyStoredValue(t *testing.T) {
	pieces := []string{"<", ">", "/", "!", "-", "\"", "'", "=", " ", "\n", "a", "&", ";", "#", "\xff", "\xc3", "\x00",
		"p", "li", "h1", "pre", "script", "style", "template", "title", "textarea", "</", "<!--", "-->",
		"b", "x", "9", "div", "dialog", "option", "<b>", "<a>", "<div>", "</b>"}
	random := rand.New(rand.NewSource(1))
	for round := 0; round < 20000; round++ {
		var stored strings.Builder
		for count := random.Intn(12); count >= 0; count-- {
			stored.WriteString(pieces[random.Intn(len(pieces))])
		}
		publicArticleHeadingText(stored.String())
	}

	deep := strings.Repeat("<div><span>", 1000)
	reader := headingMarkupReader{}
	reader.read(deep)
	if len(reader.open) > headingMaxOpenTags {
		t.Fatalf("%d open tags remembered, want at most %d", len(reader.open), headingMaxOpenTags)
	}
	if got := publicArticleHeadingText(deep + "Title" + strings.Repeat("</span></div>", 1000) + "<p>end</p>"); got != "Title end" {
		t.Fatalf("deeply nested heading read as %q, want %q", got, "Title end")
	}
}

// Browsers do not agree with each other on these inputs, so they cannot stand
// among the shared examples: an expected value there must hold in the frontend
// test DOM (jsdom) and in real browsers alike. The reader's side is pinned
// here instead. Every value is what readInlineHeadingText returned in the
// engines named first (Chromium 157, Firefox 160, jsdom 29).
func TestPublicArticleHeadingTextWhereBrowsersDisagree(t *testing.T) {
	for _, c := range []struct{ stored, want, engines string }{
		{"<noscript><b>x</b></noscript>", "x", `Chromium; Firefox and jsdom read "<b>x</b>"`},
		{"<li><dialog>a<li>b</dialog>c", "a bc", `Chromium and jsdom; Firefox reads "a b c"`},
		{"<li><search><li>a</search>b", "ab", `Chromium and jsdom; Firefox reads "a b"`},
		{"<b><dialog><p>x</b>y</dialog>z", "xyz", `Chromium and jsdom; Firefox reads "xy z"`},
		{"<a><dialog>x<a>y<div>z</dialog>w", "xy zw", `Chromium and jsdom; Firefox reads "xy z w"`},
		{"<title>a</title></p>b<i>c</i>", "abc", `Firefox and jsdom; Chromium reads "a bc"`},
		{"<basefont>a</p>b<i>c</i>", "abc", `Firefox and jsdom; Chromium reads "a bc"`},
		{"a<b \r>\nb", "a\nb", `Firefox and jsdom; Chromium reads "ab"`},
		{"<b>&#65;&#", "A&#", `Chromium and jsdom; Firefox reads "AA"`},
	} {
		if got := publicArticleHeadingText(c.stored); got != c.want {
			t.Errorf("publicArticleHeadingText(%q) = %q, want %q as in %s", c.stored, got, c.want, c.engines)
		}
	}
}

// The browser ends some tags itself where the next one starts: a link inside a
// link, an option after an option. A long row of them is therefore not nested
// and must not use up the open tags the reader remembers; the block after the
// row still separates words, as it does in Chromium, Firefox and jsdom.
func TestPublicArticleHeadingTextDoesNotNestTagsTheBrowserEnds(t *testing.T) {
	for _, tag := range []string{"<a>", "<nobr>", "<option>"} {
		stored := strings.Repeat(tag, headingMaxOpenTags) + "<div>x</div>y"
		if got := publicArticleHeadingText(stored); got != "x y" {
			t.Errorf("%d times %s, then a block: read as %q, want %q", headingMaxOpenTags, tag, got, "x y")
		}
	}
}

// A heading is read each time a public page is built, and its length is up to
// whoever stores it. Reading must take time in step with that length: two
// megabytes of comments took over twenty seconds while every comment searched
// the whole rest of the text for its end, and take a few hundredths now.
func TestPublicArticleHeadingTextReadsManyCommentsInOnePass(t *testing.T) {
	stored := "<b>q</b>" + strings.Repeat("<!--x-->", 250_000) + "z"
	started := time.Now()
	got := publicArticleHeadingText(stored)
	if elapsed := time.Since(started); elapsed > 2*time.Second {
		t.Fatalf("reading %d bytes of comments took %s", len(stored), elapsed)
	}
	if got != "qz" {
		t.Fatalf("heading with comments read as %q, want %q", got, "qz")
	}
}
