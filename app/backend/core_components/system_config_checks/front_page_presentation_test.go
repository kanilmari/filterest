// front_page_presentation_test.go
// Verifies every generic settings writer applies the Home layout policy.
// Connects JSON value-type enforcement with the shared presentation parser.
// Prevents CSV and row edits bypassing the dedicated Home palette's validation.
package system_config_checks

import (
	presentation "easelect/frontend/shared/front_page_presentation"
	"testing"
)

func TestHomePresentationGenericWriteValidation(t *testing.T) {
	for _, kind := range []int{2, 5} {
		for _, value := range []any{presentation.Rules().Default, nil, `{"anchor":"top-left"}`, `[]`} {
			err := ValidateRow("system_config", map[string]interface{}{"key": "front_page_presentation", "value_type": kind, "json_value": value})
			_, valid := value.(presentation.Value)
			if (err == nil) != (kind == 5 && valid) {
				t.Fatal(kind, value, err)
			}
		}
	}
}
