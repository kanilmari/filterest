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
	SET json_value = jsonb_set(jsonb_set(jsonb_set(jsonb_set(
		EXCLUDED.json_value,
		'{shared,card_show_all_fields}',
		CASE
			WHEN NOT $3::boolean THEN EXCLUDED.json_value #> '{shared,card_show_all_fields}'
			WHEN jsonb_typeof(public.system_config.json_value #> '{shared,card_show_all_fields}') = 'boolean'
				THEN public.system_config.json_value #> '{shared,card_show_all_fields}'
			ELSE 'true'::jsonb
		END
	), '{shared,card_style_variant}',
		CASE
			WHEN NOT $4::boolean THEN EXCLUDED.json_value #> '{shared,card_style_variant}'
			WHEN public.system_config.json_value #>> '{shared,card_style_variant}' IN ('standard', 'modern')
				THEN public.system_config.json_value #> '{shared,card_style_variant}'
			ELSE '"modern"'::jsonb
		END
	), '{shared,card_detail_columns}',
		CASE
			WHEN NOT $5::boolean THEN EXCLUDED.json_value #> '{shared,card_detail_columns}'
			WHEN public.system_config.json_value #> '{shared,card_detail_columns}' IN ('1'::jsonb, '2'::jsonb, '3'::jsonb, '4'::jsonb)
				THEN public.system_config.json_value #> '{shared,card_detail_columns}'
			ELSE '2'::jsonb
		END
	), '{shared,article_image_caption_position}',
		CASE
			WHEN NOT $6::boolean THEN EXCLUDED.json_value #> '{shared,article_image_caption_position}'
			WHEN public.system_config.json_value #>> '{shared,article_image_caption_position}' IN ('below', 'overlay')
				THEN public.system_config.json_value #> '{shared,article_image_caption_position}'
			ELSE '"below"'::jsonb
		END
	),
	    creation_spec = COALESCE(NULLIF(public.system_config.creation_spec, ''), EXCLUDED.creation_spec),
	    updated = NOW()
	RETURNING (json_value #>> '{shared,card_show_all_fields}')::boolean,
	          json_value #>> '{shared,card_style_variant}',
	          (json_value #>> '{shared,card_detail_columns}')::int,
	          json_value #>> '{shared,article_image_caption_position}'`

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
	ImageBlur      float64 `json:"image_blur"`
}

// DatasetCoverSharedValues contains visual settings shared by light and dark themes.
type DatasetCoverSharedValues struct {
	HeroExtraHeight float64 `json:"hero_extra_height"`
	HeroBottomFade  float64 `json:"hero_bottom_fade"`
	// ImageBlur remains as a rollback-safe fallback for older application builds.
	ImageBlur                   float64 `json:"image_blur"`
	CardImageWidth              float64 `json:"card_image_width"`
	CardImagePresentation       string  `json:"card_image_presentation"`
	ArticleImageCaptionPosition string  `json:"article_image_caption_position"`
	CardDetailColumns           int     `json:"card_detail_columns"`
	CardDescriptionLines        int     `json:"card_description_lines"`
	CardStyleVariant            string  `json:"card_style_variant"`
	CardShowAllFields           bool    `json:"card_show_all_fields"`
	ActiveTabFade               float64 `json:"active_tab_fade"`
	ActiveTabMaxOpacity         float64 `json:"active_tab_max_opacity"`
	ActiveTabGlowIntensity      float64 `json:"active_tab_glow_intensity"`
	ActiveTabGlowWidth          float64 `json:"active_tab_glow_width"`
	ActiveTabGlowBlur           float64 `json:"active_tab_glow_blur"`
	BrandColor                  string  `json:"brand_color"`
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
	// Request-only omission metadata never enters JSON responses or stored config.
	preserveStoredCardShowAllFields           bool
	preserveStoredCardStyleVariant            bool
	preserveStoredCardDetailColumns           bool
	preserveStoredArticleImageCaptionPosition bool
}

var readSitePresentationSettings = readSitePresentationSettingsFromDB

// Legacy clients omit newer presentation settings. Resolve those omissions under the
// upsert's row lock, then return the persisted value rather than the input default.
var persistSitePresentationSettings = func(r *http.Request, settings SitePresentationSettingsResponse) (SitePresentationSettingsResponse, error) {
	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		return SitePresentationSettingsResponse{}, errors.New("transaction unavailable")
	}
	coverJSON, err := json.Marshal(settings.DatasetCoverTheme)
	if err != nil {
		return SitePresentationSettingsResponse{}, fmt.Errorf("encode cover theme: %w", err)
	}
	err = tx.QueryRow(
		upsertDatasetCoverThemeSQL,
		datasetCoverThemeConfigKey,
		string(coverJSON),
		settings.preserveStoredCardShowAllFields,
		settings.preserveStoredCardStyleVariant,
		settings.preserveStoredCardDetailColumns,
		settings.preserveStoredArticleImageCaptionPosition,
	).Scan(&settings.DatasetCoverTheme.Shared.CardShowAllFields, &settings.DatasetCoverTheme.Shared.CardStyleVariant, &settings.DatasetCoverTheme.Shared.CardDetailColumns, &settings.DatasetCoverTheme.Shared.ArticleImageCaptionPosition)
	if err != nil {
		return SitePresentationSettingsResponse{}, fmt.Errorf("save cover theme: %w", err)
	}
	_, err = tx.Exec(
		upsertRowArticleTimestampDisplaySQL,
		rowArticleTimestampDisplayKey,
		settings.RowArticleTimestampDisplayMode,
	)
	if err != nil {
		return SitePresentationSettingsResponse{}, fmt.Errorf("save timestamp display mode: %w", err)
	}
	return settings, nil
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
		settings, err = persistSitePresentationSettings(r, settings)
		if err != nil {
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
		if json.Unmarshal([]byte(rawCover), &stored) == nil {
			inheritLegacyImageBlur(rawCover, &stored)
			if validateDatasetCoverTheme(stored) == nil {
				settings.DatasetCoverTheme = stored
			}
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
		"image_opacity", "overlay_opacity", "image_blur",
	}
	for _, themeName := range []string{"light", "dark"} {
		if err := requireExactJSONKeys(themeParts[themeName], themeKeys); err != nil {
			return SitePresentationSettingsResponse{}, err
		}
	}
	sharedKeys := []string{
		"hero_extra_height", "hero_bottom_fade", "image_blur",
		"card_image_width", "card_image_presentation", "card_description_lines",
		"active_tab_fade", "active_tab_max_opacity",
		"active_tab_glow_intensity", "active_tab_glow_width", "active_tab_glow_blur",
		"brand_color",
	}
	var sharedParts map[string]json.RawMessage
	if err := json.Unmarshal(themeParts["shared"], &sharedParts); err != nil {
		return SitePresentationSettingsResponse{}, err
	}
	cardShowAllFields, provided := sharedParts["card_show_all_fields"]
	if provided {
		// encoding/json accepts null into bool; require an actual JSON boolean.
		value := strings.TrimSpace(string(cardShowAllFields))
		if value != "true" && value != "false" {
			return SitePresentationSettingsResponse{}, errors.New("card_show_all_fields must be a boolean")
		}
		sharedKeys = append(sharedKeys, "card_show_all_fields")
	}
	cardStyle, styleProvided := sharedParts["card_style_variant"]
	if styleProvided {
		var value string
		if json.Unmarshal(cardStyle, &value) != nil || (value != "standard" && value != "modern") {
			return SitePresentationSettingsResponse{}, errors.New("card_style_variant must be standard or modern")
		}
		sharedKeys = append(sharedKeys, "card_style_variant")
	}
	columns, columnsProvided := sharedParts["card_detail_columns"]
	if columnsProvided {
		var value int
		if json.Unmarshal(columns, &value) != nil || value < 1 || value > 4 {
			return SitePresentationSettingsResponse{}, errors.New("card_detail_columns must be an integer between 1 and 4")
		}
		sharedKeys = append(sharedKeys, "card_detail_columns")
	}
	caption, captionProvided := sharedParts["article_image_caption_position"]
	if captionProvided {
		var value string
		if json.Unmarshal(caption, &value) != nil || (value != "below" && value != "overlay") {
			return SitePresentationSettingsResponse{}, errors.New("article_image_caption_position must be below or overlay")
		}
		sharedKeys = append(sharedKeys, "article_image_caption_position")
	}
	if err := requireExactJSONKeys(themeParts["shared"], sharedKeys); err != nil {
		return SitePresentationSettingsResponse{}, err
	}

	var settings SitePresentationSettingsResponse
	settings.DatasetCoverTheme.Shared.CardShowAllFields = true
	settings.DatasetCoverTheme.Shared.CardStyleVariant = "modern"
	settings.DatasetCoverTheme.Shared.CardDetailColumns = 2
	settings.DatasetCoverTheme.Shared.ArticleImageCaptionPosition = "below"
	settings.preserveStoredCardShowAllFields = !provided
	settings.preserveStoredCardStyleVariant = !styleProvided
	settings.preserveStoredCardDetailColumns = !columnsProvided
	settings.preserveStoredArticleImageCaptionPosition = !captionProvided
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
		if err := validateRange(name+".image_blur", theme.ImageBlur, 0, 24); err != nil {
			return err
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
	if config.Shared.CardImagePresentation != "cover" && config.Shared.CardImagePresentation != "contain" && config.Shared.CardImagePresentation != "contain_blur" {
		return errors.New("unsupported card image presentation")
	}
	if config.Shared.ArticleImageCaptionPosition != "below" && config.Shared.ArticleImageCaptionPosition != "overlay" {
		return errors.New("unsupported article image caption position")
	}
	if config.Shared.CardStyleVariant != "standard" && config.Shared.CardStyleVariant != "modern" {
		return errors.New("unsupported card style variant")
	}
	if config.Shared.CardDetailColumns < 1 || config.Shared.CardDetailColumns > 4 {
		return errors.New("shared.card_detail_columns must be between 1 and 4")
	}
	if config.Shared.CardDescriptionLines < 1 || config.Shared.CardDescriptionLines > 12 {
		return fmt.Errorf("shared.card_description_lines must be between 1 and 12")
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

// inheritLegacyImageBlur keeps old system_config JSON valid after blur became
// theme-specific. Explicit theme values, including zero, always win.
func inheritLegacyImageBlur(raw string, config *DatasetCoverThemeConfig) {
	if config == nil {
		return
	}
	var keys struct {
		Light map[string]json.RawMessage `json:"light"`
		Dark  map[string]json.RawMessage `json:"dark"`
	}
	if json.Unmarshal([]byte(raw), &keys) != nil {
		return
	}
	if _, exists := keys.Light["image_blur"]; !exists {
		config.Light.ImageBlur = config.Shared.ImageBlur
	}
	if _, exists := keys.Dark["image_blur"]; !exists {
		config.Dark.ImageBlur = config.Shared.ImageBlur
	}
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
		ImageOpacity: 1, OverlayOpacity: 0, ImageBlur: 1,
	}
	dark := light
	dark.OvalEnabled = false
	dark.ImageOpacity = 0.3
	return SitePresentationSettingsResponse{
		DatasetCoverTheme: DatasetCoverThemeConfig{
			Light: light,
			Dark:  dark,
			Shared: DatasetCoverSharedValues{
				HeroExtraHeight:             40,
				HeroBottomFade:              48,
				ImageBlur:                   1,
				CardImageWidth:              300,
				CardImagePresentation:       "contain",
				ArticleImageCaptionPosition: "below",
				CardDescriptionLines:        2,
				CardDetailColumns:           2,
				CardShowAllFields:           true,
				CardStyleVariant:            "modern",
				ActiveTabFade:               25,
				ActiveTabMaxOpacity:         1,
				ActiveTabGlowIntensity:      0.5,
				ActiveTabGlowWidth:          2,
				ActiveTabGlowBlur:           4,
				BrandColor:                  "#1a8fe6",
			},
		},
		RowArticleTimestampDisplayMode: rowArticleTimestampDateTime,
	}
}
