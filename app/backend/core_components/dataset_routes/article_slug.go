// article_slug.go
// Builds the words an article address carries after its row id (/{dataset}/{id}-{slug}).
// Server twin of buildSlug in app/frontend/core_components/table_views/card_view/row_article_opener_helpers.js.
// Exists so the canonical address the server announces is the one the app writes (owner decision K428).
package dataset_routes

import (
	"strings"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

// articleSlugMaxLength is the frontend's substring(0, 80). Every character left at
// that point is ASCII, so bytes and the browser's UTF-16 code units agree.
const articleSlugMaxLength = 80

// ArticleSlug turns an article title into the lower-case words of its address.
// The steps are the frontend's, in its order: lower case, accents taken apart
// and dropped, every character other than a-z, 0-9, whitespace and "-" removed,
// whitespace runs to one "-", "-" runs collapsed, edge hyphens trimmed, then
// at most 80 characters. Both sides are checked against
// app/testing/shared_contracts/article_slug_examples.json.
func ArticleSlug(title string) string {
	if title == "" {
		return ""
	}
	decomposed := norm.NFD.String(strings.ToLower(title))
	var kept strings.Builder
	kept.Grow(len(decomposed))
	for _, character := range decomposed {
		switch {
		case character >= 0x0300 && character <= 0x036f:
			// Combining diacritical marks, the frontend's [̀-ͯ].
		case character >= 'a' && character <= 'z', character >= '0' && character <= '9', character == '-':
			kept.WriteRune(character)
		case isJavaScriptWhitespace(character):
			kept.WriteRune(' ')
		}
	}
	slug := strings.Join(strings.FieldsFunc(kept.String(), func(r rune) bool { return r == ' ' }), "-")
	for strings.Contains(slug, "--") {
		slug = strings.ReplaceAll(slug, "--", "-")
	}
	slug = strings.TrimPrefix(slug, "-")
	slug = strings.TrimSuffix(slug, "-")
	if len(slug) > articleSlugMaxLength {
		slug = slug[:articleSlugMaxLength]
	}
	return slug
}

// isJavaScriptWhitespace is the JavaScript regular-expression class \s, which
// differs from unicode.IsSpace: it includes U+FEFF and excludes U+0085.
func isJavaScriptWhitespace(character rune) bool {
	switch character {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0x00a0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return character >= 0x2000 && character <= 0x200a
}

// ParseArticleRowSegment splits the row part of an article address, "287-some-words"
// or "287", into its row id and slug. The id is the leading run of ASCII digits; an
// address segment that does not start with one names no article row.
func ParseArticleRowSegment(segment string) (rowID string, slug string, ok bool) {
	end := 0
	for end < len(segment) && segment[end] >= '0' && segment[end] <= '9' {
		end++
	}
	if end == 0 || end > 18 {
		return "", "", false
	}
	rowID = segment[:end]
	rest := segment[end:]
	if rest == "" {
		return rowID, "", true
	}
	if rest[0] != '-' || !utf8.ValidString(rest) {
		return "", "", false
	}
	return rowID, rest[1:], true
}
