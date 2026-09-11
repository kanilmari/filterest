// site_card_image_presentation_test.go
// Verifies the allowlisted card-image choice and old stored JSON compatibility.
// Connects typed site settings with the unchanged system_config storage.
// Rejects arbitrary rendering values before an administrator save reaches the database.
package system_table_tools

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestCardImagePresentationRoundTripsAllSupportedChoices(t *testing.T) {
	for _, mode := range []string{"cover", "contain", "contain_blur"} {
		t.Run(mode, func(t *testing.T) {
			settings := defaultSitePresentationSettings()
			settings.DatasetCoverTheme.Shared.CardImagePresentation = mode
			body, err := json.Marshal(settings)
			if err != nil {
				t.Fatal(err)
			}
			decoded, err := decodeSitePresentationSettings(strings.NewReader(string(body)))
			if err != nil {
				t.Fatal(err)
			}
			if decoded.DatasetCoverTheme.Shared.CardImagePresentation != mode {
				t.Fatalf("mode changed: %q", decoded.DatasetCoverTheme.Shared.CardImagePresentation)
			}
		})
	}
}

func TestCardImagePresentationRejectsUnknownAndMissingWriteValues(t *testing.T) {
	settings := defaultSitePresentationSettings()
	body, err := json.Marshal(settings)
	if err != nil {
		t.Fatal(err)
	}
	for _, replacement := range []string{
		`"card_image_presentation":"stretch"`,
		`"card_image_presentation":null`,
		`"card_image_presentation":7`,
	} {
		altered := strings.Replace(string(body), `"card_image_presentation":"contain"`, replacement, 1)
		if _, err := decodeSitePresentationSettings(strings.NewReader(altered)); err == nil {
			t.Fatalf("accepted %s", replacement)
		}
	}
	missing := strings.Replace(string(body), `"card_image_presentation":"contain",`, "", 1)
	if _, err := decodeSitePresentationSettings(strings.NewReader(missing)); err == nil {
		t.Fatal("accepted incomplete write contract")
	}
}

func TestOldStoredPresentationKeepsOtherSettingsAndDefaultsToWholeImage(t *testing.T) {
	settings := defaultSitePresentationSettings()
	oldJSON := `{"shared":{"card_image_width":420,"brand_color":"#cc3366"},"light":{"image_blur":3}}`
	if err := json.Unmarshal([]byte(oldJSON), &settings.DatasetCoverTheme); err != nil {
		t.Fatal(err)
	}
	if err := validateDatasetCoverTheme(settings.DatasetCoverTheme); err != nil {
		t.Fatal(err)
	}
	shared := settings.DatasetCoverTheme.Shared
	if shared.CardImagePresentation != "contain" || shared.CardImageWidth != 420 || shared.BrandColor != "#cc3366" {
		t.Fatalf("legacy settings lost: %#v", shared)
	}
	if settings.DatasetCoverTheme.Light.ImageBlur != 3 {
		t.Fatal("legacy theme value lost")
	}
}
