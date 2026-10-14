// site_preview_description_builder.go
// Chooses a site's own Home wording for generic page previews.
// Connects already-read public shell translations to plain metadata strings.
// Keeps fallbacks site-owned and description excerpts within a Unicode-safe limit.
package router

import (
	"strings"
	"unicode"

	"easelect/backend/core_components/lang"
)

// sitePreviewDescription uses only public Home copy already read for this shell.
// Slogans keep their words but, like descriptions, become one plain line within the preview limit (a multi-line
// Home slogan put raw newlines into the metadata on the native instance, 14.10.2026).
func sitePreviewDescription(siteName string, texts lang.ShellBootTexts) string {
	if slogan := strings.TrimSpace(texts.HomeSlogan); slogan != "" {
		return shortenPreviewDescription(slogan)
	}
	if description := strings.TrimSpace(texts.HomeDescription); description != "" {
		return shortenPreviewDescription(description)
	}
	return siteName
}

func shortenPreviewDescription(description string) string {
	const maxCharacters = 200
	characters := []rune(strings.Join(strings.Fields(description), " "))
	if len(characters) <= maxCharacters {
		return string(characters)
	}
	end := maxCharacters - 1 // Reserve one character for the ellipsis.
	for end > 0 && !unicode.IsSpace(characters[end]) {
		end--
	}
	if end == 0 {
		// A single overlong word (or text without word separators) needs a safe
		// rune boundary to honour the limit without discarding the whole excerpt.
		end = maxCharacters - 1
	}
	return strings.TrimSpace(string(characters[:end])) + "…"
}
