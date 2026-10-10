// site_label_value_layout_test.go
// Proves the development-only layout boundary without legacy write normalization.
package system_table_tools

import "testing"

func TestSiteLabelValueLayoutContract(t *testing.T) {
	for _, environment := range []string{"dev", "prod"} {
		t.Setenv("ENVIRONMENT_TYPE", environment)
		for _, value := range []string{"stacked", "inline"} {
			assertSitePatchValue(t, "shared.label_value_layout", value, true)
		}
		assertSitePatchValue(t, "shared.label_value_layout", "auto", environment == "dev")
		for _, value := range []any{nil, 7, "unknown"} {
			assertSitePatchValue(t, "shared.label_value_layout", value, false)
		}
	}
}
