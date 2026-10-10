// site_card_image_presentation_test.go
// Proves accepted and refused site patch values while preserving explicit choices.
// Connects the shared definition with the version-two strict write boundary.
package system_table_tools

import "testing"

func TestSiteCardImagePresentationPatchContract(t *testing.T) {
	for _, value := range []any{"cover", "contain", "contain_blur"} {
		assertSitePatchValue(t, "shared.card_image_presentation", value, true)
	}
	for _, value := range []any{nil, 7, "stretch"} {
		assertSitePatchValue(t, "shared.card_image_presentation", value, false)
	}
}
