// site_article_image_presentation_test.go
// Proves accepted and refused site patch values while preserving explicit choices.
// Connects the shared definition with the version-two strict write boundary.
package system_table_tools

import "testing"

func TestSiteArticleImagePresentationPatchContract(t *testing.T) {
	for _, value := range []any{"below", "overlay"} {
		assertSitePatchValue(t, "shared.article_image_caption_position", value, true)
	}
	for _, value := range []any{nil, 1, true, "unknown"} {
		assertSitePatchValue(t, "shared.article_image_caption_position", value, false)
	}
}
