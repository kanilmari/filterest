// site_presentation_settings.go
// Serves and saves the small, typed site-presentation configuration allowlist.
// Bridges public cover rendering, administrator preview controls, and system_config.
// Exists so visual settings never expose or mutate arbitrary configuration rows.
package system_table_tools

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
)

const (
	datasetCoverThemeConfigKey    = "dataset_cover_theme_config"
	rowArticleTimestampDisplayKey = "row_article_timestamp_display_mode"
	rowArticleTimestampDateTime   = "date_time"
	rowArticleTimestampDateOnly   = "date_only"
)

const readSitePresentationSettingsSQL = `
	SELECT
		COALESCE((
			SELECT json_value::text
			FROM public.system_config
			WHERE key = $1
		), ''),
		COALESCE((
			SELECT COALESCE(NULLIF(text_value, ''), json_value ->> 'value')
			FROM public.system_config
			WHERE key = $2
		), '')`

const upsertDatasetCoverThemeSQL = `
	INSERT INTO public.system_config (
		key,
		json_value,
		creation_spec
	)
	VALUES (
		$1,
		$2::jsonb,
		'Admin-managed, theme-aware dataset cover presentation settings.'
	)
	ON CONFLICT (key) DO UPDATE
	SET json_value = EXCLUDED.json_value,
	    creation_spec = COALESCE(NULLIF(public.system_config.creation_spec, ''), EXCLUDED.creation_spec),
	    updated = NOW()`

const upsertRowArticleTimestampDisplaySQL = `
	INSERT INTO public.system_config (
		key,
		json_value,
		text_value,
		creation_spec
	)
	VALUES (
		$1,
		jsonb_build_object('value', $2::text),
		$2,
		'Admin-managed row article timestamp display mode.'
	)
	ON CONFLICT (key) DO UPDATE
	SET json_value = EXCLUDED.json_value,
	    text_value = EXCLUDED.text_value,
	    creation_spec = COALESCE(NULLIF(public.system_config.creation_spec, ''), EXCLUDED.creation_spec),
	    updated = NOW()`

// DatasetCoverThemeValues contains the visual settings that may differ by theme.
type DatasetCoverThemeValues struct {
	OvalEnabled    bool    `json:"oval_enabled"`
	OvalWidth      float64 `json:"oval_width"`
	OvalHeight     float64 `json:"oval_height"`
	OvalPositionY  float64 `json:"oval_position_y"`
	CenterOpacity  float64 `json:"center_opacity"`
	MidOpacity     float64 `json:"mid_opacity"`
	EdgeOpacity    float64 `json:"edge_opacity"`
	CenterStop     float64 `json:"center_stop"`
	MidStop        float64 `json:"mid_stop"`
	EdgeStop       float64 `json:"edge_stop"`
	ImageOpacity   float64 `json:"image_opacity"`
	OverlayOpacity float64 `json:"overlay_opacity"`
}

// DatasetCoverSharedValues contains visual settings shared by light and dark themes.
type DatasetCoverSharedValues struct {
	HeroExtraHeight        float64 `json:"hero_extra_height"`
	HeroBottomFade         float64 `json:"hero_bottom_fade"`
	ImageBlur              float64 `json:"image_blur"`
	CardImageWidth         float64 `json:"card_image_width"`
	ActiveTabFade          float64 `json:"active_tab_fade"`
	ActiveTabMaxOpacity    float64 `json:"active_tab_max_opacity"`
	ActiveTabGlowIntensity float64 `json:"active_tab_glow_intensity"`
	ActiveTabGlowWidth     float64 `json:"active_tab_glow_width"`
	ActiveTabGlowBlur      float64 `json:"active_tab_glow_blur"`
	BrandColor             string  `json:"brand_color"`
}

// DatasetCoverThemeConfig groups light, dark, and shared cover settings.
type DatasetCoverThemeConfig struct {
	Light  DatasetCoverThemeValues  `json:"light"`
	Dark   DatasetCoverThemeValues  `json:"dark"`
	Shared DatasetCoverSharedValues `json:"shared"`
}

// SitePresentationSettingsResponse is the public, typed presentation allowlist.
type SitePresentationSettingsResponse struct {
	DatasetCoverTheme              DatasetCoverThemeConfig `json:"dataset_cover_theme"`
	RowArticleTimestampDisplayMode string                  `json:"row_article_timestamp_display_mode"`
}

var readSitePresentationSettings = readSitePresentationSettingsFromDB

var persistSitePresentationSettings = func(r *http.Request, settings SitePresentationSettingsResponse) error {
	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		return errors.New("transaction unavailable")
	}
	coverJSON, err := json.Marshal(settings.DatasetCoverTheme)
	if err != nil {
		return fmt.Errorf("encode cover theme: %w", err)
	}
	_, err = tx.Exec(
		upsertDatasetCoverThemeSQL,
		datasetCoverThemeConfigKey,
		string(coverJSON),
	)
	if err != nil {
		return fmt.Errorf("save cover theme: %w", err)
	}
	_, err = tx.Exec(
		upsertRowArticleTimestampDisplaySQL,
		rowArticleTimestampDisplayKey,
		settings.RowArticleTimestampDisplayMode,
	)
	if err != nil {
		return fmt.Errorf("save timestamp display mode: %w", err)
	}
	return nil
}

// GetSitePresentationSettingsHandler returns only public-safe presentation values.
// GET /api/site-presentation-settings
func GetSitePresentationSettingsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
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
		if err := persistSitePresentationSettings(r, settings); err != nil {
			log.Printf("\033[31merror: [AdminSitePresentationSettingsHandler] save failed: %v\033[0m", err)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "site presentation settings save failed")
			return
		}
		httpresponse.RespondWithJSON(w, http.StatusOK, settings)
	default:
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
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

func readSitePresentationSettingsFromDB() (SitePresentationSettingsResponse, error) {
	settings := defaultSitePresentationSettings()
	var rawCover string
	var rawTimestamp sql.NullString
	if err := backend.Db.QueryRow(
		readSitePresentationSettingsSQL,
		datasetCoverThemeConfigKey,
		rowArticleTimestampDisplayKey,
	).Scan(&rawCover, &rawTimestamp); err != nil {
		return SitePresentationSettingsResponse{}, err
	}

	if strings.TrimSpace(rawCover) != "" {
		stored := settings.DatasetCoverTheme
		if json.Unmarshal([]byte(rawCover), &stored) == nil && validateDatasetCoverTheme(stored) == nil {
			settings.DatasetCoverTheme = stored
		}
	}
	if rawTimestamp.Valid && validateTimestampDisplayMode(rawTimestamp.String) == nil {
		settings.RowArticleTimestampDisplayMode = rawTimestamp.String
	}
	return settings, nil
}

func decodeSitePresentationSettings(reader io.Reader) (SitePresentationSettingsResponse, error) {
	decoder := json.NewDecoder(io.LimitReader(reader, 128*1024))
	var raw json.RawMessage
	if err := decoder.Decode(&raw); err != nil {
		return SitePresentationSettingsResponse{}, err
	}
	if err := rejectTrailingJSON(decoder); err != nil {
		return SitePresentationSettingsResponse{}, err
	}
	if err := requireExactJSONKeys(raw, []string{
		"dataset_cover_theme",
		"row_article_timestamp_display_mode",
	}); err != nil {
		return SitePresentationSettingsResponse{}, err
	}

	var topLevel map[string]json.RawMessage
	if err := json.Unmarshal(raw, &topLevel); err != nil {
		return SitePresentationSettingsResponse{}, err
	}
	if err := requireExactJSONKeys(topLevel["dataset_cover_theme"], []string{
		"light", "dark", "shared",
	}); err != nil {
		return SitePresentationSettingsResponse{}, err
	}
	var themeParts map[string]json.RawMessage
	if err := json.Unmarshal(topLevel["dataset_cover_theme"], &themeParts); err != nil {
		return SitePresentationSettingsResponse{}, err
	}
	themeKeys := []string{
		"oval_enabled", "oval_width", "oval_height", "oval_position_y",
		"center_opacity", "mid_opacity", "edge_opacity",
		"center_stop", "mid_stop", "edge_stop",
		"image_opacity", "overlay_opacity",
	}
	for _, themeName := range []string{"light", "dark"} {
		if err := requireExactJSONKeys(themeParts[themeName], themeKeys); err != nil {
			return SitePresentationSettingsResponse{}, err
		}
	}
	if err := requireExactJSONKeys(themeParts["shared"], []string{
		"hero_extra_height", "hero_bottom_fade", "image_blur",
		"card_image_width", "active_tab_fade", "active_tab_max_opacity",
		"active_tab_glow_intensity", "active_tab_glow_width", "active_tab_glow_blur",
		"brand_color",
	}); err != nil {
		return SitePresentationSettingsResponse{}, err
	}

	var settings SitePresentationSettingsResponse
	if err := json.Unmarshal(raw, &settings); err != nil {
		return SitePresentationSettingsResponse{}, err
	}
	if err := validateSitePresentationSettings(settings); err != nil {
		return SitePresentationSettingsResponse{}, err
	}
	return settings, nil
}

func rejectTrailingJSON(decoder *json.Decoder) error {
	var trailing json.RawMessage
	err := decoder.Decode(&trailing)
	if err == io.EOF {
		return nil
	}
	if err == nil {
		return errors.New("multiple JSON values")
	}
	return err
}

func requireExactJSONKeys(raw json.RawMessage, expected []string) error {
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw, &object); err != nil {
		return err
	}
	actual := make([]string, 0, len(object))
	for key := range object {
		actual = append(actual, key)
	}
	sort.Strings(actual)
	want := append([]string{}, expected...)
	sort.Strings(want)
	if len(actual) != len(want) {
		return fmt.Errorf("keys %v, want %v", actual, want)
	}
	for index := range actual {
		if actual[index] != want[index] {
			return fmt.Errorf("keys %v, want %v", actual, want)
		}
	}
	return nil
}

func validateSitePresentationSettings(settings SitePresentationSettingsResponse) error {
	if err := validateDatasetCoverTheme(settings.DatasetCoverTheme); err != nil {
		return err
	}
	return validateTimestampDisplayMode(settings.RowArticleTimestampDisplayMode)
}

func validateDatasetCoverTheme(config DatasetCoverThemeConfig) error {
	for name, theme := range map[string]DatasetCoverThemeValues{
		"light": config.Light,
		"dark":  config.Dark,
	} {
		if err := validateRange(name+".oval_width", theme.OvalWidth, 20, 140); err != nil {
			return err
		}
		if err := validateRange(name+".oval_height", theme.OvalHeight, 20, 140); err != nil {
			return err
		}
		if err := validateRange(name+".oval_position_y", theme.OvalPositionY, 0, 100); err != nil {
			return err
		}
		for field, value := range map[string]float64{
			"center_opacity":  theme.CenterOpacity,
			"mid_opacity":     theme.MidOpacity,
			"edge_opacity":    theme.EdgeOpacity,
			"image_opacity":   theme.ImageOpacity,
			"overlay_opacity": theme.OverlayOpacity,
		} {
			if err := validateRange(name+"."+field, value, 0, 1); err != nil {
				return err
			}
		}
		for field, value := range map[string]float64{
			"center_stop": theme.CenterStop,
			"mid_stop":    theme.MidStop,
			"edge_stop":   theme.EdgeStop,
		} {
			if err := validateRange(name+"."+field, value, 0, 100); err != nil {
				return err
			}
		}
		if theme.CenterOpacity > theme.MidOpacity || theme.MidOpacity > theme.EdgeOpacity {
			return fmt.Errorf("%s mask opacity values must be ascending", name)
		}
		if theme.CenterStop > theme.MidStop || theme.MidStop > theme.EdgeStop {
			return fmt.Errorf("%s mask stops must be ascending", name)
		}
	}
	if err := validateRange("shared.hero_extra_height", config.Shared.HeroExtraHeight, 0, 240); err != nil {
		return err
	}
	if err := validateRange("shared.hero_bottom_fade", config.Shared.HeroBottomFade, 0, 200); err != nil {
		return err
	}
	if err := validateRange("shared.image_blur", config.Shared.ImageBlur, 0, 24); err != nil {
		return err
	}
	if err := validateRange("shared.card_image_width", config.Shared.CardImageWidth, 30, 600); err != nil {
		return err
	}
	if err := validateRange("shared.active_tab_fade", config.Shared.ActiveTabFade, 0, 100); err != nil {
		return err
	}
	if err := validateRange("shared.active_tab_max_opacity", config.Shared.ActiveTabMaxOpacity, 0, 1); err != nil {
		return err
	}
	if err := validateRange("shared.active_tab_glow_intensity", config.Shared.ActiveTabGlowIntensity, 0, 1); err != nil {
		return err
	}
	if err := validateRange("shared.active_tab_glow_width", config.Shared.ActiveTabGlowWidth, 0, 8); err != nil {
		return err
	}
	if err := validateRange("shared.active_tab_glow_blur", config.Shared.ActiveTabGlowBlur, 0, 12); err != nil {
		return err
	}
	return validateHexColor("shared.brand_color", config.Shared.BrandColor)
}

func validateRange(name string, value, minimum, maximum float64) error {
	if value < minimum || value > maximum {
		return fmt.Errorf("%s must be between %g and %g", name, minimum, maximum)
	}
	return nil
}

func validateHexColor(name, value string) error {
	if len(value) != 7 || value[0] != '#' {
		return fmt.Errorf("%s must be a six-digit hexadecimal colour", name)
	}
	if _, err := strconv.ParseUint(value[1:], 16, 24); err != nil {
		return fmt.Errorf("%s must be a six-digit hexadecimal colour", name)
	}
	return nil
}

func validateTimestampDisplayMode(value string) error {
	if value != rowArticleTimestampDateTime && value != rowArticleTimestampDateOnly {
		return fmt.Errorf("timestamp display mode %q is not supported", value)
	}
	return nil
}

func defaultSitePresentationSettings() SitePresentationSettingsResponse {
	light := DatasetCoverThemeValues{
		OvalEnabled: true, OvalWidth: 32, OvalHeight: 67, OvalPositionY: 56,
		CenterOpacity: 0.4, MidOpacity: 0.7, EdgeOpacity: 1,
		CenterStop: 39, MidStop: 55, EdgeStop: 80,
		ImageOpacity: 1, OverlayOpacity: 0,
	}
	dark := light
	dark.OvalEnabled = false
	dark.ImageOpacity = 0.3
	return SitePresentationSettingsResponse{
		DatasetCoverTheme: DatasetCoverThemeConfig{
			Light: light,
			Dark:  dark,
			Shared: DatasetCoverSharedValues{
				HeroExtraHeight:        40,
				HeroBottomFade:         48,
				ImageBlur:              1,
				CardImageWidth:         300,
				ActiveTabFade:          25,
				ActiveTabMaxOpacity:    1,
				ActiveTabGlowIntensity: 0.3,
				ActiveTabGlowWidth:     1.5,
				ActiveTabGlowBlur:      2,
				BrandColor:             "#1a8fe6",
			},
		},
		RowArticleTimestampDisplayMode: rowArticleTimestampDateTime,
	}
}
