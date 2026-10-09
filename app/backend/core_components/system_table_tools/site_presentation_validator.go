// site_presentation_validator.go
// Decodes and validates the existing site presentation write protocol.
// Connects strict request keys with typed appearance and timestamp values.
// Retains legacy omission and label-layout normalization contracts.
package system_table_tools

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"slices"
	"sort"

	appearance "easelect/frontend/shared/dataset_appearance"
)

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
	rules := appearance.Rules()
	themeKeys := make([]string, 0, len(rules.ThemeFields))
	for key := range rules.ThemeFields {
		themeKeys = append(themeKeys, key)
	}
	for _, themeName := range rules.ThemeOwners {
		if err := requireExactJSONKeys(themeParts[themeName], themeKeys); err != nil {
			return SitePresentationSettingsResponse{}, err
		}
	}
	var sharedParts map[string]json.RawMessage
	if err := json.Unmarshal(themeParts["shared"], &sharedParts); err != nil {
		return SitePresentationSettingsResponse{}, err
	}
	sharedKeys := make([]string, 0, len(rules.SharedFields))
	development := os.Getenv("ENVIRONMENT_TYPE") == "dev"
	for key := range rules.SharedFields {
		if !slices.Contains(rules.Compatibility.SharedWriteOptional, key) {
			sharedKeys = append(sharedKeys, key)
			continue
		}
		rawValue, provided := sharedParts[key]
		if !provided {
			continue
		}
		sharedKeys = append(sharedKeys, key)
		if key == "label_value_layout" {
			// Preserve the protocol's existing normalization of unknown strings and null.
			var value string
			if json.Unmarshal(rawValue, &value) != nil {
				return SitePresentationSettingsResponse{}, errors.New("label_value_layout must be a string")
			}
			if slices.Contains(rules.SharedFields[key].DevelopmentValues, value) && !development {
				return SitePresentationSettingsResponse{}, errors.New("auto label_value_layout requires development mode")
			}
		} else {
			var value any
			if err := json.Unmarshal(rawValue, &value); err != nil {
				return SitePresentationSettingsResponse{}, err
			}
			if err := rules.ValidateLeaf("shared."+key, value, development); err != nil {
				return SitePresentationSettingsResponse{}, err
			}
		}
	}
	if err := requireExactJSONKeys(themeParts["shared"], sharedKeys); err != nil {
		return SitePresentationSettingsResponse{}, err
	}
	provided := func(key string) bool { _, exists := sharedParts[key]; return exists }
	defaults := defaultSitePresentationSettings().DatasetCoverTheme.Shared
	var settings SitePresentationSettingsResponse
	settings.DatasetCoverTheme.Shared.CardShowAllFields = defaults.CardShowAllFields
	settings.DatasetCoverTheme.Shared.CardStyleVariant = defaults.CardStyleVariant
	settings.DatasetCoverTheme.Shared.CardDetailColumns = defaults.CardDetailColumns
	settings.DatasetCoverTheme.Shared.ArticleImageCaptionPosition = defaults.ArticleImageCaptionPosition
	settings.DatasetCoverTheme.Shared.FilterbarContentTopSpace = defaults.FilterbarContentTopSpace
	settings.DatasetCoverTheme.Shared.ActiveFilterRemoveSide = defaults.ActiveFilterRemoveSide
	settings.preserveStoredCardShowAllFields = !provided("card_show_all_fields")
	settings.preserveStoredCardStyleVariant = !provided("card_style_variant")
	settings.preserveStoredLabelValueLayout = !provided("label_value_layout")
	settings.preserveStoredCardDetailColumns = !provided("card_detail_columns")
	settings.preserveStoredArticleImageCaptionPosition = !provided("article_image_caption_position")
	settings.preserveStoredFilterbarContentTopSpace = !provided("filterbar_content_top_space")
	settings.preserveStoredActiveFilterRemoveSide = !provided("active_filter_remove_side")
	if err := json.Unmarshal(raw, &settings); err != nil {
		return SitePresentationSettingsResponse{}, err
	}
	settings.DatasetCoverTheme.Shared.LabelValueLayout = normalizeSiteLabelValueLayout(settings.DatasetCoverTheme.Shared.LabelValueLayout)
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

// validateDatasetCoverTheme uses the browser's strict shared appearance twin.
// Request omissions and stored read compatibility are resolved before this boundary.
func validateDatasetCoverTheme(config DatasetCoverThemeConfig) error {
	return appearance.Validate(config, os.Getenv("ENVIRONMENT_TYPE") == "dev")
}

func validateTimestampDisplayMode(value string) error {
	if value != rowArticleTimestampDateTime && value != rowArticleTimestampDateOnly {
		return fmt.Errorf("timestamp display mode %q is not supported", value)
	}
	return nil
}

// normalizeSiteLabelValueLayout mirrors the browser adapter in
// frontend/reusable_components/key_value_container/label_value_layout.js.
// Reuses the runtime development boundary that supplies the browser's app-env meta.
func normalizeSiteLabelValueLayout(value string) string {
	rules := appearance.Rules()
	if rules.ValidateLeaf("shared.label_value_layout", value, os.Getenv("ENVIRONMENT_TYPE") == "dev") == nil {
		return value
	}
	return rules.SharedFields["label_value_layout"].Default.(string)
}
