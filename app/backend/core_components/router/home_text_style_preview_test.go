// home_text_style_preview_test.go
// Proves the serif accent never replaces the full shared-link description.
// Connects safe whole-line marker cleanup with existing default preview fallbacks.
// Keeps titles and non-marker asterisks outside this text-style change.
package router

import (
	"easelect/backend/core_components/lang"
	"testing"
)

func TestHomeTextStylePreviewDescriptions(t *testing.T) {
	for _, tc := range []struct{ name, preset, slogan, description, expected string }{
		{"serif story", "serif_story_v1", "at a glance", "**Fintravel brings news**\n\nAnd deals", "Fintravel brings news And deals"},
		{"empty serif", "serif_story_v1", "at a glance", " \n ", "Fintravel"},
		{"default slogan", "default", "at a glance", "**Ignored**", "at a glance"},
		{"default cleaned", "default", "", "  **News**  \r\nMore", "News More"},
		{"literal markers", "serif_story_v1", "accent", "**\na **b** c\n**x", "** a **b** c **x"},
		{"inner markers", "serif_story_v1", "accent", "**a **b** c**", "a **b** c"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := sitePreviewDescription("Fintravel", lang.ShellBootTexts{HomeSlogan: tc.slogan, HomeDescription: tc.description}, tc.preset)
			if got != tc.expected {
				t.Fatalf("got %q, want %q", got, tc.expected)
			}
		})
	}
}
