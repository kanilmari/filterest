// row_response_support_test.go
// Defines the view, alias and legacy-flag compatibility matrix for row support.
// Connects the request owner with compact clients and rich projection callers.
// Prevents explicit zero flags from disabling required projection support.
package dtt_1_row_read

import (
	"net/url"
	"testing"
)

func TestResolveRowSupportRequest(t *testing.T) {
	for _, view := range []struct {
		raw, normalized string
		card, geo       bool
	}{
		{"", "table", false, false}, {"table", "table", false, false},
		{"card", "card", true, false}, {" CARD ", "card", true, false},
		{"article_view", "article_view", true, false},
		{"article", "article_view", true, false}, {"big_card", "article_view", true, false},
		{" ROW_ARTICLE ", "article_view", true, false},
		{"product_card", "product_card", true, false}, {"map", "map", false, true},
		{" MAP ", "map", false, true}, {"normal", "normal", false, false},
		{"transposed", "transposed", false, false}, {"ticket", "ticket", false, false},
		{"calendar", "calendar", false, false}, {"tree", "tree", false, false},
		{"price_chart", "price_chart", false, false}, {"settings", "settings", false, false},
		{"cloud_management", "cloud_management", false, false},
		{"custom_view", "custom_view", false, false},
		{"image_first_view", "image_first_view", false, false}, // Presentation uses an article projection.
		{"card;drop", "table", false, false}, {"map/view", "table", false, false},
	} {
		for _, flags := range []struct {
			card, geo string
		}{
			{"", ""}, {"1", ""}, {"", "1"}, {"1", "1"},
			{"0", "0"}, {"true", "true"}, {" 1 ", "false"},
		} {
			t.Run(view.raw+"/card="+flags.card+"/map="+flags.geo, func(t *testing.T) {
				params := url.Values{"include_card_support": {flags.card}, "include_map_support": {flags.geo}}
				if view.raw != "" {
					params.Set("view_key", view.raw)
				}
				want := rowSupportRequest{view.normalized, view.card || flags.card == "1", view.geo || flags.geo == "1"}
				if got := resolveRowSupportRequest(params); got != want {
					t.Fatalf("support = %+v, want %+v", got, want)
				}
			})
		}
	}
}
