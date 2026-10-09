// site_presentation_settings.go
// Serves the typed public and administrator presentation allowlist.
// Connects HTTP handlers with validation and system_config persistence.
// Keeps visual settings separate from arbitrary configuration access.
package system_table_tools

import (
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
	DatasetCoverTheme              DatasetCoverThemeConfig `json:"dataset_cover_theme"`
	RowArticleTimestampDisplayMode string                  `json:"row_article_timestamp_display_mode"`
	// Request-only omission metadata never enters JSON responses or stored config.
	preserveStoredCardShowAllFields           bool
	preserveStoredCardStyleVariant            bool
	preserveStoredLabelValueLayout            bool
	preserveStoredCardDetailColumns           bool
	preserveStoredArticleImageCaptionPosition bool
	preserveStoredFilterbarContentTopSpace    bool
	preserveStoredActiveFilterRemoveSide      bool
}

// GetSitePresentationSettingsHandler returns only public-safe presentation values.
// GET /api/site-presentation-settings
func GetSitePresentationSettingsHandler(w http.ResponseWriter, r *http.Request) {

	respondWithSitePresentationSettings(w)
}

// AdminSitePresentationSettingsHandler reads or atomically replaces the typed settings.
// GET|POST /api/admin/site-presentation-settings
func AdminSitePresentationSettingsHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		respondWithSitePresentationSettings(w)
	case http.MethodPost:
		settings, err := decodeSitePresentationSettings(r.Body)
		if err != nil {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid site presentation settings")
			return
		}
		settings, err = persistSitePresentationSettings(r, settings)
		if err != nil {
			log.Printf("\033[31merror: [AdminSitePresentationSettingsHandler] save failed: %v\033[0m", err)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "site presentation settings save failed")
			return
		}
		httpresponse.RespondWithJSON(w, http.StatusOK, settings)

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
