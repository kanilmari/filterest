// parse_advanced_search_test.go
// Table-driven unit tests for parseAdvancedSearch.
package dtt_1_row_read

import (
	"strings"
	"testing"
)

// tokenString returns a human-readable label for a TokenType, making test
// failure messages easier to read.
func tokenString(tt TokenType) string {
	switch tt {
	case TokenAll:
		return "TokenAll"
	case TokenAnd:
		return "TokenAnd"
	case TokenOr:
		return "TokenOr"
	case TokenInclude:
		return "TokenInclude"
	case TokenExclude:
		return "TokenExclude"
	default:
		return "TokenUnknown"
	}
}

func tokensEqual(a, b []Token) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i].Type != b[i].Type || a[i].Value != b[i].Value {
			return false
		}
	}
	return true
}

func describeTokens(tokens []Token) string {
	if len(tokens) == 0 {
		return "[]"
	}
	parts := make([]string, len(tokens))
	for i, t := range tokens {
		parts[i] = tokenString(t.Type) + "(" + t.Value + ")"
	}
	return "[" + strings.Join(parts, ", ") + "]"
}

// ── Table-driven tests ──────────────────────────────────────────────────────

type advancedSearchTestCase struct {
	name  string
	input string
	want  []Token
}

func TestParseAdvancedSearch(t *testing.T) {
	inc := func(v string) Token { return Token{Type: TokenInclude, Value: v} }
	exc := func(v string) Token { return Token{Type: TokenExclude, Value: v} }
	and := Token{Type: TokenAnd, Value: "AND"}
	or := Token{Type: TokenOr, Value: "OR"}
	all := func(v string) Token { return Token{Type: TokenAll, Value: v} }

	tests := []advancedSearchTestCase{
		// ── Empty / blank ──────────────────────────────────────────────
		{
			name:  "empty string",
			input: "",
			want:  nil,
		},
		{
			name:  "whitespace only",
			input: "   ",
			want:  nil,
		},
		{
			name:  "tab only",
			input: "\t",
			want:  nil,
		},

		// ── Wildcard / fetch-all ───────────────────────────────────────
		{
			name:  "asterisk wildcard fetch-all",
			input: "*",
			want:  []Token{all("*")},
		},
		{
			name:  "percent wildcard fetch-all",
			input: "%",
			want:  []Token{all("%")},
		},
		// asterisk with leading/trailing space → still TokenAll
		{
			name:  "asterisk with surrounding whitespace",
			input: "  *  ",
			want:  []Token{all("*")},
		},

		// ── Single term ───────────────────────────────────────────────
		{
			name:  "single plain word",
			input: "foo",
			want:  []Token{inc("foo")},
		},
		{
			name:  "single word with leading/trailing spaces",
			input: "  hello  ",
			want:  []Token{inc("hello")},
		},
		{
			name:  "single word uppercase",
			input: "HELLO",
			want:  []Token{inc("HELLO")},
		},

		// ── Multiple terms (implicit AND / space-separated) ────────────
		{
			name:  "two plain words",
			input: "foo bar",
			want:  []Token{inc("foo"), inc("bar")},
		},
		{
			name:  "three plain words",
			input: "one two three",
			want:  []Token{inc("one"), inc("two"), inc("three")},
		},

		// ── Explicit AND / OR ──────────────────────────────────────────
		{
			name:  "explicit AND uppercase",
			input: "foo AND bar",
			want:  []Token{inc("foo"), and, inc("bar")},
		},
		{
			name:  "explicit AND lowercase",
			input: "foo and bar",
			want:  []Token{inc("foo"), and, inc("bar")},
		},
		{
			name:  "explicit AND mixed case",
			input: "foo And bar",
			want:  []Token{inc("foo"), and, inc("bar")},
		},
		{
			name:  "explicit OR uppercase",
			input: "foo OR bar",
			want:  []Token{inc("foo"), or, inc("bar")},
		},
		{
			name:  "explicit OR lowercase",
			input: "foo or bar",
			want:  []Token{inc("foo"), or, inc("bar")},
		},
		{
			name:  "explicit OR mixed case",
			input: "foo oR bar",
			want:  []Token{inc("foo"), or, inc("bar")},
		},
		{
			name:  "chained AND OR",
			input: "a AND b OR c",
			want:  []Token{inc("a"), and, inc("b"), or, inc("c")},
		},
		{
			name:  "AND at start",
			input: "AND bar",
			want:  []Token{and, inc("bar")},
		},
		{
			name:  "OR at end",
			input: "foo OR",
			want:  []Token{inc("foo"), or},
		},

		// ── Exclude operator != ────────────────────────────────────────
		{
			name:  "exclude single term",
			input: "!= foo",
			want:  []Token{exc("foo")},
		},
		{
			name:  "include then exclude",
			input: "foo != bar",
			want:  []Token{inc("foo"), exc("bar")},
		},
		{
			name:  "multiple excludes",
			input: "foo != bar != baz",
			want:  []Token{inc("foo"), exc("bar"), exc("baz")},
		},
		{
			name:  "exclude then include",
			input: "!= bad good",
			want:  []Token{exc("bad"), inc("good")},
		},
		{
			name:  "exclude with AND context",
			input: "foo AND != bar",
			want:  []Token{inc("foo"), and, exc("bar")},
		},

		// ── Quoted phrases ─────────────────────────────────────────────
		// Note: quoted content is passed through strings.Fields, so spaces
		// inside quotes produce multiple tokens.  This is the parser's
		// current behaviour.
		{
			name:  "double-quoted single word",
			input: `"foo"`,
			want:  []Token{inc("foo")},
		},
		{
			name:  "single-quoted single word",
			input: `'bar'`,
			want:  []Token{inc("bar")},
		},
		{
			name:  "double-quoted phrase splits on spaces",
			input: `"foo bar"`,
			want:  []Token{inc("foo"), inc("bar")},
		},
		{
			name:  "single-quoted phrase splits on spaces",
			input: `'hello world'`,
			want:  []Token{inc("hello"), inc("world")},
		},
		{
			name:  "double-quoted empty string",
			input: `""`,
			want:  []Token{inc("")},
		},
		{
			name:  "single-quoted empty string",
			input: `''`,
			want:  []Token{inc("")},
		},
		{
			name:  "exclude double-quoted phrase",
			input: `!= "foo bar"`,
			want:  []Token{exc("foo"), exc("bar")},
		},
		{
			name:  "quoted term followed by plain term",
			input: `"hello" world`,
			want:  []Token{inc("hello"), inc("world")},
		},

		// ── Wildcard inside a word ─────────────────────────────────────
		{
			name:  "asterisk inside word (partial wildcard)",
			input: "k*rhu",
			want:  []Token{inc("k*rhu")},
		},
		{
			name:  "percent inside word",
			input: "k%rhu",
			want:  []Token{inc("k%rhu")},
		},

		// ── Special characters ─────────────────────────────────────────
		{
			name:  "hyphenated word",
			input: "well-known",
			want:  []Token{inc("well-known")},
		},
		{
			name:  "email-like token",
			input: "user@example.com",
			want:  []Token{inc("user@example.com")},
		},
		{
			name:  "number",
			input: "42",
			want:  []Token{inc("42")},
		},
		{
			name:  "decimal number",
			input: "3.14",
			want:  []Token{inc("3.14")},
		},
		{
			name:  "underscore word",
			input: "foo_bar",
			want:  []Token{inc("foo_bar")},
		},

		// ── Unicode / multilingual ─────────────────────────────────────
		{
			name:  "Finnish characters",
			input: "hyvä",
			want:  []Token{inc("hyvä")},
		},
		{
			name:  "Finnish two words",
			input: "hyvä päivä",
			want:  []Token{inc("hyvä"), inc("päivä")},
		},
		{
			name:  "Finnish with AND",
			input: "hyvä AND päivä",
			want:  []Token{inc("hyvä"), and, inc("päivä")},
		},
		{
			name:  "Swedish characters",
			input: "räksmörgås",
			want:  []Token{inc("räksmörgås")},
		},
		{
			name:  "Chinese characters",
			input: "你好",
			want:  []Token{inc("你好")},
		},
		{
			name:  "Japanese hiragana",
			input: "こんにちは",
			want:  []Token{inc("こんにちは")},
		},
		{
			name:  "Arabic text",
			input: "مرحبا",
			want:  []Token{inc("مرحبا")},
		},
		{
			name:  "mixed ASCII and unicode",
			input: "hello 世界",
			want:  []Token{inc("hello"), inc("世界")},
		},
		{
			name:  "emoji",
			input: "café☕",
			want:  []Token{inc("café☕")},
		},

		// ── Very long input ────────────────────────────────────────────
		{
			name:  "very long single word (1000 chars)",
			input: strings.Repeat("a", 1000),
			want:  []Token{inc(strings.Repeat("a", 1000))},
		},
		{
			name:  "many space-separated words",
			input: strings.Join(func() []string {
				words := make([]string, 50)
				for i := range words {
					words[i] = "word"
				}
				return words
			}(), " "),
			want: func() []Token {
				tokens := make([]Token, 50)
				for i := range tokens {
					tokens[i] = inc("word")
				}
				return tokens
			}(),
		},

		// ── Mixed complex queries ──────────────────────────────────────
		{
			name:  "doc example: foo AND quoted bar baz != qux",
			input: `foo AND "bar baz" != qux`,
			// "bar baz" → strings.Fields → ["bar", "baz"] → two Include tokens
			want: []Token{inc("foo"), and, inc("bar"), inc("baz"), exc("qux")},
		},
		{
			name:  "include exclude include",
			input: "alpha != beta gamma",
			want:  []Token{inc("alpha"), exc("beta"), inc("gamma")},
		},
		{
			name:  "AND followed by OR",
			input: "x AND y OR z",
			want:  []Token{inc("x"), and, inc("y"), or, inc("z")},
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			got := parseAdvancedSearch(tc.input)
			if !tokensEqual(got, tc.want) {
				t.Errorf("parseAdvancedSearch(%q)\n  got  %s\n  want %s",
					tc.input, describeTokens(got), describeTokens(tc.want))
			}
		})
	}
}

// ── Focused sub-tests ───────────────────────────────────────────────────────

// TestParseAdvancedSearch_ExcludeFlagReset verifies that the "nextExclude" flag
// is cleared after each exclude token, so subsequent plain terms become Include.
func TestParseAdvancedSearch_ExcludeFlagReset(t *testing.T) {
	got := parseAdvancedSearch("!= bad good")
	if len(got) != 2 {
		t.Fatalf("expected 2 tokens, got %d: %s", len(got), describeTokens(got))
	}
	if got[0].Type != TokenExclude {
		t.Errorf("token[0]: want TokenExclude, got %s", tokenString(got[0].Type))
	}
	if got[1].Type != TokenInclude {
		t.Errorf("token[1]: want TokenInclude, got %s", tokenString(got[1].Type))
	}
}

// TestParseAdvancedSearch_TokenAllNotForPartialWildcard verifies that a word
// containing "*" but not equal to "*" is NOT treated as TokenAll.
func TestParseAdvancedSearch_TokenAllNotForPartialWildcard(t *testing.T) {
	got := parseAdvancedSearch("foo*bar")
	if len(got) != 1 {
		t.Fatalf("expected 1 token, got %d: %s", len(got), describeTokens(got))
	}
	if got[0].Type != TokenInclude {
		t.Errorf("partial wildcard should be TokenInclude, got %s", tokenString(got[0].Type))
	}
	if got[0].Value != "foo*bar" {
		t.Errorf("value: want %q, got %q", "foo*bar", got[0].Value)
	}
}

// TestParseAdvancedSearch_ANDORCaseInsensitivity exercises all common case
// variants to confirm the case-insensitive matching applies correctly.
func TestParseAdvancedSearch_ANDORCaseInsensitivity(t *testing.T) {
	andVariants := []string{"AND", "and", "And", "aNd", "aND"}
	for _, v := range andVariants {
		got := parseAdvancedSearch("x " + v + " y")
		if len(got) != 3 || got[1].Type != TokenAnd {
			t.Errorf("input %q: expected middle token TokenAnd, got %s",
				v, describeTokens(got))
		}
	}

	orVariants := []string{"OR", "or", "Or", "oR"}
	for _, v := range orVariants {
		got := parseAdvancedSearch("x " + v + " y")
		if len(got) != 3 || got[1].Type != TokenOr {
			t.Errorf("input %q: expected middle token TokenOr, got %s",
				v, describeTokens(got))
		}
	}
}

// TestParseAdvancedSearch_ReturnType verifies the return type is []Token (not
// nil) when there are results, and nil/empty when the input produces nothing.
func TestParseAdvancedSearch_ReturnType(t *testing.T) {
	got := parseAdvancedSearch("hello")
	if got == nil {
		t.Error("non-empty input should return non-nil slice")
	}

	got = parseAdvancedSearch("")
	if len(got) != 0 {
		t.Errorf("empty input should return empty result, got %s", describeTokens(got))
	}
}
