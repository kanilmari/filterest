// site_presentation_top_space_test.go
// Proves accepted and refused site patch values while preserving explicit choices.
// Connects the shared definition with the version-two strict write boundary.
package system_table_tools

import "testing"

func TestSitePresentationTopSpacePatchContract(t *testing.T) {
	for _, value := range []any{0, 12, 40, 200} {
		assertSitePatchValue(t, "shared.filterbar_content_top_space", value, true)
	}
	for _, value := range []any{nil, -1, 201, true, "40"} {
		assertSitePatchValue(t, "shared.filterbar_content_top_space", value, false)
	}
}
