// front_page_settings_test.go
// Holds background configuration to one contained image and its supported variants.
// Connects administrator JSON validation with protected storage path matching.
package backend

import (
	"math"
	"testing"
)

func TestFrontPageBackgroundMatchesOnlyConfiguredImage(t *testing.T) {
	background := FrontPageBackground{StorageKey: "site_media/front_page/original/file.png", MIMEType: "image/png", FocalX: 0.5, FocalY: 0.5}
	for _, variant := range []string{"original", "1000", "2160"} {
		if !FrontPageBackgroundMatches(&background, "site_media/front_page/"+variant+"/file.png") {
			t.Fatal(variant)
		}
	}
	for _, key := range []string{"site_media/front_page/300/file.png", "site_media/front_page/original/other.png", "site_media/front_page/original/../original/file.png", `site_media/front_page/original/bad\file.png`, "1/dataset_media/background/original/file.png"} {
		if FrontPageBackgroundMatches(&background, key) {
			t.Fatal("accepted", key)
		}
	}
	for _, change := range []func(*FrontPageBackground){
		func(b *FrontPageBackground) { b.FocalX = math.NaN() }, func(b *FrontPageBackground) { b.FocalY = 2 },
		func(b *FrontPageBackground) { b.StorageKey = "site_media/front_page/original/file.svg" },
		func(b *FrontPageBackground) { b.StorageKey = "../../secret.png" }, func(b *FrontPageBackground) { b.MIMEType = "image/jpeg" },
	} {
		copy := background
		change(&copy)
		if ValidateFrontPageBackground(copy) == nil || FrontPageBackgroundMatches(&copy, copy.StorageKey) {
			t.Fatal(copy)
		}
	}
}
