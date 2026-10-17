// table_cell_lines_validator_test.go
// Checks integer boundaries for generic settings writes without PostgreSQL.
// Connects JSON/form/SQL representations with the translated refusal contract.
// Prevents fractional, missing and out-of-range values from reaching storage.
package system_config_checks

import (
	"easelect/backend/core_components/httpresponse"
	"errors"
	"testing"
)

func TestTableCellMaxLinesGenericValidation(t *testing.T) {
	for _, value := range []any{1, 3, 30, int64(4), float64(5), "6"} {
		if err := ValidateRow("system_config", map[string]any{"key": TableCellMaxLinesKey, "value_type": 1, "int_value": value}); err != nil {
			t.Fatalf("%v: %v", value, err)
		}
	}
	for _, value := range []any{nil, 0, -1, 31, 3.5, "3.5", "", true, "1e1"} {
		var refusal *httpresponse.Refusal
		err := ValidateRow("system_config", map[string]any{"key": TableCellMaxLinesKey, "value_type": 1, "int_value": value})
		if !errors.As(err, &refusal) || refusal.Status != 400 || refusal.LangKey != "table_cell_max_lines_invalid" {
			t.Fatalf("%v: %v", value, err)
		}
	}
	if err := ValidateRow("system_config", map[string]any{"key": TableCellMaxLinesKey, "value_type": 5, "int_value": 3}); err == nil {
		t.Fatal("accepted a noninteger setting type")
	}
}
