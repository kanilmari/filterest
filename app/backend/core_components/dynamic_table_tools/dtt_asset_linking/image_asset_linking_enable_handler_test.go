// image_asset_linking_enable_handler_test.go
// Verifies the image enable handler's default and explicit extension selection.
// Connects request defaults to the image profile without a database.
// Prevents duplicate defaults and shared slices from changing later requests.
package dtt_asset_linking

import (
	"slices"
	"testing"

	imageprofile "easelect/backend/core_components/dynamic_table_tools/dtt_asset_linking/profiles/image"
)

func TestImageAssetLinkingAllowedTypesDefaultsToProfileCopy(t *testing.T) {
	original := imageprofile.DefaultAllowedTypes
	t.Cleanup(func() { imageprofile.DefaultAllowedTypes = original })

	for _, profileTypes := range [][]string{original, {"webp", "png"}} {
		imageprofile.DefaultAllowedTypes = profileTypes
		for _, requestedTypes := range [][]string{nil, {}} {
			allowedTypes := imageAssetLinkingAllowedTypes(requestedTypes)
			if !slices.Equal(allowedTypes, profileTypes) {
				t.Fatalf("default extensions = %v, want profile %v", allowedTypes, profileTypes)
			}
			if &allowedTypes[0] == &profileTypes[0] {
				t.Fatal("default extensions share the profile's backing slice")
			}
			allowedTypes[0] = "changed"
			if profileTypes[0] == "changed" {
				t.Fatal("changing request defaults changed the image profile")
			}
		}
	}
}

func TestImageAssetLinkingAllowedTypesPreservesExplicitCopy(t *testing.T) {
	requestedTypes := []string{"png", "jpeg"}
	allowedTypes := imageAssetLinkingAllowedTypes(requestedTypes)
	if !slices.Equal(allowedTypes, requestedTypes) {
		t.Fatalf("explicit extensions = %v, want %v", allowedTypes, requestedTypes)
	}
	allowedTypes[0] = "changed"
	if requestedTypes[0] != "png" {
		t.Fatal("changing selected extensions changed the request slice")
	}
}
