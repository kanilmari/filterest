// site_presentation_settings.go
// Serves the typed public and administrator presentation allowlist.
// Connects HTTP handlers with validation and system_config persistence.
// Keeps visual settings separate from arbitrary configuration access.
package system_table_tools

import (
	"errors"
	"log"
	"net/http"

	"easelect/backend/core_components/httpresponse"
)

const (
	datasetCoverThemeConfigKey    = "dataset_cover_theme_config"
	rowArticleTimestampDisplayKey = "row_article_timestamp_display_mode"
	rowArticleTimestampDateTime   = "date_time"
	rowArticleTimestampDateOnly   = "date_only"
)

// SitePresentationSettingsResponse is the public, typed presentation allowlist.
type SitePresentationSettingsResponse struct {
	SchemaVersion                  int            `json:"schema_version"`
	Version                        string         `json:"version"`
	SiteValues                     map[string]any `json:"site_values"`
	Defaults                       map[string]any `json:"defaults"`
	RowArticleTimestampDisplayMode string         `json:"row_article_timestamp_display_mode"`
}

// GetSitePresentationSettingsHandler returns only public-safe presentation values.
// GET /api/site-presentation-settings
func GetSitePresentationSettingsHandler(w http.ResponseWriter, r *http.Request) {

	respondWithSitePresentationSettings(w)
}

// AdminSitePresentationSettingsHandler reads or atomically patches the typed settings.
// GET|POST /api/admin/site-presentation-settings
func AdminSitePresentationSettingsHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		respondWithSitePresentationSettings(w)
	case http.MethodPost:
		settings, err := decodeSitePresentationSettings(http.MaxBytesReader(w, r.Body, 128<<10))
		if err != nil {
			var refusal *httpresponse.Refusal
			if errors.As(err, &refusal) {
				httpresponse.RespondWithRefusal(w, refusal)
			} else {
				httpresponse.RespondWithRefusal(w, &httpresponse.Refusal{Status: 400, LangKey: "dataset_appearance_invalid", Message: "invalid site presentation settings"})
			}
			return
		}
		if settings.Version == "" {
			respondDatasetAppearanceError(w, ErrDatasetAppearanceConflict)
			return
		}
		result, err := persistSitePresentationSettings(r, settings)
		if err != nil {
			var refusal *httpresponse.Refusal
			if errors.As(err, &refusal) {
				httpresponse.RespondWithRefusal(w, refusal)
				return
			}
			log.Printf("[AdminSitePresentationSettingsHandler] save failed")
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "site presentation settings save failed")
			return
		}
		httpresponse.RespondWithJSON(w, http.StatusOK, result)

	}
}

func respondWithSitePresentationSettings(w http.ResponseWriter) {
	settings, err := readSitePresentationSettings()
	if err != nil {
		log.Printf("\033[31merror: [site presentation settings] read failed: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "site presentation settings unavailable")
		return
	}
	httpresponse.RespondWithJSON(w, http.StatusOK, settings)
}
