// category_filter_button_width_mode_test.go
// Verifies the category button layout enum on generic settings writes.
// Connects accepted text rows to the shared invalid-setting refusal contract.
// Rejects unknown values and wrong types before any writer changes data.
package system_config_checks

import (
	"database/sql/driver"
	"errors"
	"strings"
	"testing"

	"easelect/backend/core_components/dbutils/queryfixture"
	"easelect/backend/core_components/httpresponse"
)

func TestCategoryFilterButtonWidthModeValidation(t *testing.T) {
	for _, tc := range []struct {
		value interface{}
		kind  interface{}
		valid bool
	}{
		{"fill_row_with_centered_label", nil, true}, {"fit_to_label", nil, true},
		{"unknown", nil, false}, {nil, nil, false}, {true, nil, false},
		{"fit_to_label", 1, false}, {"fit_to_label", 2, false}, {"fit_to_label", 3, false},
		{"fit_to_label", 4, false}, {"fit_to_label", 5, false}, {"fit_to_label", 6, false},
		{"fit_to_label", float64(6), false}, {"fit_to_label", "6", false},
		{"fit_to_label", "NULL", false},
	} {
		err := ValidateRow("system_config", map[string]interface{}{
			"key": "category_filter_button_width_mode", "text_value": tc.value, "value_type": tc.kind,
			"json_value": map[string]interface{}{"value": tc.value},
		})
		if tc.valid {
			if err != nil {
				t.Fatal(err)
			}
			continue
		}
		var refusal *httpresponse.Refusal
		if !errors.As(err, &refusal) || refusal.LangKey != InvalidValueLangKey || refusal.Status != 400 {
			t.Fatalf("value=%v type=%v refusal=%v", tc.value, tc.kind, err)
		}
	}
}

func TestCategoryFilterButtonWidthModeGenericPartialWrites(t *testing.T) {
	db := queryfixture.Open(t, func(query string, _ []driver.NamedValue) (driver.Rows, error) {
		if !strings.Contains(query, "FOR UPDATE") {
			t.Fatal("setting was not locked", query)
		}
		return queryfixture.Rows([]string{"config"}, []driver.Value{[]byte(`{"id":7,"key":"category_filter_button_width_mode","value_type":null,"text_value":"fill_row_with_centered_label","json_value":{"value":"fill_row_with_centered_label"}}`)}), nil
	})
	for _, method := range []string{"update", "upsert", "matching_update"} {
		for _, mode := range []string{"fill_row_with_centered_label", "fit_to_label", "unknown"} {
			t.Run(method+"/"+mode, func(t *testing.T) {
				// The administrator form writes only text_value; the stored type stays NULL.
				changes := map[string]interface{}{"text_value": mode}
				var err error
				switch method {
				case "update":
					err = ValidateUpdate(db, "system_config", 7, changes)
				case "upsert":
					changes["id"] = 7
					err = ValidateInsert(db, "system_config", changes)
				case "matching_update":
					err = ValidateMatchingUpdate(db, "system_config", "key", "category_filter_button_width_mode", changes)
				}
				if mode != "unknown" {
					if err != nil {
						t.Fatal(err)
					}
					return
				}
				var refusal *httpresponse.Refusal
				if !errors.As(err, &refusal) || refusal.Status != 400 || refusal.LangKey != InvalidValueLangKey {
					t.Fatal("invalid setting accepted or refusal shape changed", err)
				}
			})
		}
	}
}
