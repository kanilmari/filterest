// Project already-authorized snapshots for the appearance contract understood by the browser.
package dataset_appearance_store

import (
	"maps"
	"net/http"
	"strings"
)

const AppearanceHeader = "X-Filterest-Appearance"
const RowPresentationPath = "shared.row_article_default_presentation"

// Clients validate the exact set of leaves in the three version-two maps.
type AppearanceClient int

const (
	LegacyAppearance AppearanceClient = iota
	RowPresentationAppearance
	DisclosureAppearance
)

func RequestedAppearance(w http.ResponseWriter, r *http.Request) AppearanceClient {
	w.Header().Add("Vary", AppearanceHeader)
	switch r.Header.Get(AppearanceHeader) {
	case "disclosure-defaults":
		return DisclosureAppearance
	case "row-presentation":
		return RowPresentationAppearance
	default:
		return LegacyAppearance
	}
}

func ValuesForClient[V any](values map[string]V, client AppearanceClient) map[string]V {
	if client == DisclosureAppearance {
		return values
	}
	result := values
	copied := false
	for key := range values {
		if (client == LegacyAppearance && key == RowPresentationPath) || strings.HasPrefix(key, "shared.") && strings.HasSuffix(key, "_initial_open") {
			if !copied {
				result = maps.Clone(values)
				copied = true
			}
			delete(result, key)
		}
	}
	return result
}

func (response AppearanceResponse) ForClient(client AppearanceClient) AppearanceResponse {
	response.Defaults = ValuesForClient(response.Defaults, client)
	response.Overrides = ValuesForClient(response.Overrides, client)
	response.Sources = ValuesForClient(response.Sources, client)
	if client == LegacyAppearance {
		response.Effective.Shared.RowArticleDefaultPresentation = ""
	}
	return response
}
