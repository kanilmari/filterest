// site_presentation_validator.go
// Decodes and validates the version-two site appearance patch protocol.
// Connects strict request keys with typed appearance and timestamp values.
// Preserves omitted timestamp values and refuses obsolete whole-cover writes.
package system_table_tools

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"slices"

	store "easelect/backend/core_components/dataset_appearance_store"
	appearance "easelect/frontend/shared/dataset_appearance"
)

// SitePresentationSettingsPatch changes only the sixteen site-owned values.
// An omitted timestamp keeps its separate existing setting.
type SitePresentationSettingsPatch struct {
	SchemaVersion                  int            `json:"schema_version"`
	Version                        string         `json:"version"`
	Set                            map[string]any `json:"set"`
	RowArticleTimestampDisplayMode *string        `json:"row_article_timestamp_display_mode,omitempty"`
}

func decodeSitePresentationSettings(reader io.Reader) (SitePresentationSettingsPatch, error) {
	decoder := json.NewDecoder(reader)
	var raw json.RawMessage
	var patch SitePresentationSettingsPatch
	if err := decoder.Decode(&raw); err != nil {
		return patch, err
	}
	if err := rejectTrailingJSON(decoder); err != nil {
		return patch, err
	}
	var keys map[string]json.RawMessage
	if err := json.Unmarshal(raw, &keys); err != nil || keys == nil {
		return patch, errors.New("site appearance patch requires an object")
	}
	if _, legacy := keys["dataset_cover_theme"]; legacy {
		return patch, store.ErrDatasetAppearanceReload
	}
	for key := range keys {
		switch key {
		case "schema_version", "version", "set", "row_article_timestamp_display_mode":
		default:
			return patch, fmt.Errorf("unknown site appearance field %s", key)
		}
	}
	if err := json.Unmarshal(raw, &patch); err != nil {
		return patch, err
	}
	if patch.SchemaVersion != 2 {
		return patch, store.ErrDatasetAppearanceReload
	}
	if timestamp, provided := keys["row_article_timestamp_display_mode"]; provided && string(timestamp) == "null" {
		return patch, errors.New("timestamp display mode cannot be null")
	}
	if err := validateSitePresentationPatch(patch); err != nil {
		return patch, err
	}
	return patch, nil
}

func validateSitePresentationPatch(patch SitePresentationSettingsPatch) error {
	if patch.SchemaVersion != 2 || patch.Set == nil {
		return errors.New("appearance contract changed; reload")
	}
	rules := appearance.Rules()
	development := os.Getenv("ENVIRONMENT_TYPE") == "dev"
	for path, value := range patch.Set {
		place, ok := rules.PlaceForPath(path)
		if !ok || place == appearance.TabOnly || !slices.Contains(rules.CanonicalPaths(), path) {
			return fmt.Errorf("appearance path %s is not site-owned", path)
		}
		if err := rules.ValidateLeaf(path, value, development); err != nil {
			return err
		}
	}
	if patch.RowArticleTimestampDisplayMode != nil {
		return validateTimestampDisplayMode(*patch.RowArticleTimestampDisplayMode)
	}
	return nil
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

func validateSitePresentationSettings(settings SitePresentationSettingsResponse) error {
	development := os.Getenv("ENVIRONMENT_TYPE") == "dev"
	if settings.SchemaVersion != 2 {
		return errors.New("unsupported site appearance schema")
	}
	if err := appearance.ValidateSiteValuesV2(settings.SiteValues, development); err != nil {
		return err
	}
	if err := appearance.ValidateDefaultsV2(settings.Defaults, development); err != nil {
		return err
	}
	return validateTimestampDisplayMode(settings.RowArticleTimestampDisplayMode)
}

func validateTimestampDisplayMode(value string) error {
	if value != rowArticleTimestampDateTime && value != rowArticleTimestampDateOnly {
		return fmt.Errorf("timestamp display mode %q is not supported", value)
	}
	return nil
}
