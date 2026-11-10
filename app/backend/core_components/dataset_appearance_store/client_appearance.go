// Project already-authorized snapshots for the appearance contract understood by the browser.
package dataset_appearance_store

import (
	"maps"
	"net/http"
)

const AppearanceHeader = "X-Filterest-Appearance"
const RowPresentationPath = "shared.row_article_default_presentation"

// Old v2 clients validate the exact set of flat leaves, including sparse overrides.
func WantsRowPresentation(w http.ResponseWriter, r *http.Request) bool {
	w.Header().Add("Vary", AppearanceHeader)
	return r.Header.Get(AppearanceHeader) == "row-presentation"
}

// Copy only when the field exists; the stored map and the caller's revision stay intact.
func WithoutRowPresentation[V any](values map[string]V) map[string]V {
	if _, exists := values[RowPresentationPath]; !exists {
		return values
	}
	result := maps.Clone(values)
	delete(result, RowPresentationPath)
	return result
}

func (response AppearanceResponse) ForClient(rowPresentation bool) AppearanceResponse {
	if !rowPresentation {
		response.Defaults = WithoutRowPresentation(response.Defaults)
		response.Overrides = WithoutRowPresentation(response.Overrides)
		response.Sources = WithoutRowPresentation(response.Sources)
		response.Effective.Shared.RowArticleDefaultPresentation = ""
	}
	return response
}
