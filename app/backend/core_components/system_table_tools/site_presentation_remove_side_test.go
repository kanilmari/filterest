// site_presentation_remove_side_test.go
// Proves accepted and refused site patch values while preserving explicit choices.
// Connects the shared definition with the version-two strict write boundary.
package system_table_tools

import "testing"

func TestSitePresentationRemoveSidePatchContract(t *testing.T) {
	for _, value := range []any{"start", "end"} {
		assertSitePatchValue(t, "shared.active_filter_remove_side", value, true)
	}
	for _, value := range []any{nil, 7, "left"} {
		assertSitePatchValue(t, "shared.active_filter_remove_side", value, false)
	}
}
