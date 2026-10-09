// config.go
// Owns the typed appearance shape and legacy stored-value normalization.
// Connects result readers and administrator writers to the canonical leaf rules.
// Keeps one compatibility boundary usable without importing HTTP handler packages.
package dataset_appearance

import (
	"encoding/json"
	"strings"
)

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
	ActiveFilterRemoveSide string  `json:"active_filter_remove_side"`
	HeroExtraHeight        float64 `json:"hero_extra_height"`
	HeroBottomFade         float64 `json:"hero_bottom_fade"`
	// ImageBlur remains as a rollback-safe fallback for older application builds.
	ImageBlur                   float64 `json:"image_blur"`
	CardImageWidth              float64 `json:"card_image_width"`
	CardImagePresentation       string  `json:"card_image_presentation"`
	ArticleImageCaptionPosition string  `json:"article_image_caption_position"`
	CardDetailColumns           int     `json:"card_detail_columns"`
	CardDescriptionLines        int     `json:"card_description_lines"`
	CardStyleVariant            string  `json:"card_style_variant"`
	LabelValueLayout            string  `json:"label_value_layout"`
	CardShowAllFields           bool    `json:"card_show_all_fields"`
	ActiveTabFade               float64 `json:"active_tab_fade"`
	ActiveTabMaxOpacity         float64 `json:"active_tab_max_opacity"`
	ActiveTabGlowIntensity      float64 `json:"active_tab_glow_intensity"`
	ActiveTabGlowWidth          float64 `json:"active_tab_glow_width"`
	ActiveTabGlowBlur           float64 `json:"active_tab_glow_blur"`
	// FilterbarContentTopSpace is the empty space above the hero header icon.
	FilterbarContentTopSpace float64 `json:"filterbar_content_top_space"`
	BrandColor               string  `json:"brand_color"`
}

// DatasetCoverThemeConfig groups light, dark, and shared cover settings.
type DatasetCoverThemeConfig struct {
	Light  DatasetCoverThemeValues  `json:"light"`
	Dark   DatasetCoverThemeValues  `json:"dark"`
	Shared DatasetCoverSharedValues `json:"shared"`
}

// inheritLegacyImageBlur keeps old system_config JSON valid after blur became
// theme-specific. Explicit theme values, including zero, always win.
func InheritLegacyImageBlur(raw string, config *DatasetCoverThemeConfig) {
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
	themeKeys := map[string]map[string]json.RawMessage{"light": keys.Light, "dark": keys.Dark}
	targets := map[string]*float64{"light.image_blur": &config.Light.ImageBlur, "dark.image_blur": &config.Dark.ImageBlur}
	for _, path := range Rules().SharedFields["image_blur"].LegacyReadTargets {
		owner, key, _ := strings.Cut(path, ".")
		if _, exists := themeKeys[owner][key]; !exists {
			*targets[path] = config.Shared.ImageBlur
		}
	}
}

// DefaultConfig returns independent canonical defaults, including derived legacy blur.
func DefaultConfig() DatasetCoverThemeConfig {
	var config DatasetCoverThemeConfig
	data, _ := json.Marshal(Rules().Defaults())
	if err := json.Unmarshal(data, &config); err != nil {
		panic(err)
	}
	return config
}

// NormalizeStoredConfig retains old blur and label-layout read compatibility.
func NormalizeStoredConfig(raw string, development bool) DatasetCoverThemeConfig {
	config := DefaultConfig()
	if json.Unmarshal([]byte(raw), &config) != nil {
		return DefaultConfig()
	}
	InheritLegacyImageBlur(raw, &config)
	if Rules().ValidateLeaf("shared.label_value_layout", config.Shared.LabelValueLayout, development) != nil {
		config.Shared.LabelValueLayout = Rules().SharedFields["label_value_layout"].Default.(string)
	}
	if Validate(config, development) != nil {
		return DefaultConfig()
	}
	return config
}
