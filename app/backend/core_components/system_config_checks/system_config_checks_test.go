// system_config_checks_test.go
// Checks the registry independently of HTTP handlers or a live database.
// Connects candidate row values to the existing translated refusal contract.
// Exists to protect registered settings while leaving unrelated keys unchanged.
// Covers the added Home boxes and video contracts without a live database.
package system_config_checks

import (
	"database/sql/driver"
	"errors"
	"fmt"
	"strings"
	"testing"

	"easelect/backend/core_components/dbutils/queryfixture"
	"easelect/backend/core_components/httpresponse"
)

func TestRegistryRefusesInvalidSignInLimit(t *testing.T) {
	for _, value := range []interface{}{nil, "broken JSON", `{"limit_enabled":true,"limit_unit":"unknown","limit_amount":3}`, `{"limit_enabled":true,"limit_unit":"days","limit_amount":0}`, `{"limit_enabled":true,"limit_unit":"days","limit_amount":1.5}`} {
		err := ValidateRow("system_config", map[string]interface{}{"key": SignInLimitKey, "value_type": 5, "json_value": value})
		var refusal *httpresponse.Refusal
		if !errors.As(err, &refusal) || refusal.Status != 400 || refusal.LangKey != InvalidValueLangKey {
			t.Fatalf("%v: %v", value, err)
		}
	}
	for _, value := range []string{`{"limit_enabled":true,"limit_unit":"days","limit_amount":30}`, `{"limit_enabled":true,"limit_unit":"months","limit_amount":2}`, `{"limit_enabled":false}`} {
		if err := ValidateRow("system_config", map[string]interface{}{"key": SignInLimitKey, "value_type": "5", "json_value": value}); err != nil {
			t.Fatal(err)
		}
	}
	if err := ValidateRow("system_config", map[string]interface{}{"key": "future_setting", "json_value": "anything"}); err != nil {
		t.Fatal(err)
	}
	if err := ValidateRow("app_settings", map[string]interface{}{"key": SignInLimitKey, "json_value": "anything"}); err != nil {
		t.Fatal(err)
	}
	if err := ValidateRow("system_config", map[string]interface{}{"key": SignInLimitKey, "value_type": 0}); err == nil {
		t.Fatal("a duration changed to text was accepted")
	}
}

func TestCustomRootSwitchRequiresBoolean(t *testing.T) {
	for _, value := range []any{false, true} {
		if err := ValidateRow("system_config", map[string]any{"key": "display_index_html_at_startup", "value_type": 2, "boolean_value": value}); err != nil {
			t.Fatal(err)
		}
	}
	for _, row := range []map[string]any{
		{"key": "display_index_html_at_startup", "value_type": 2, "boolean_value": "true"},
		{"key": "display_index_html_at_startup", "value_type": 2, "boolean_value": nil},
		{"key": "display_index_html_at_startup", "value_type": 5, "boolean_value": true},
	} {
		var refusal *httpresponse.Refusal
		if err := ValidateRow("system_config", row); !errors.As(err, &refusal) || refusal.LangKey != "error_setting_boolean_invalid" {
			t.Fatal(err)
		}
	}
}

func TestFrontPageBoxesBooleanRegistry(t *testing.T) {
	for _, value := range []bool{true, false} {
		if err := ValidateRow("system_config", map[string]interface{}{"key": "front_page_show_blocks", "boolean_value": value, "value_type": 2}); err != nil {
			t.Fatal(err)
		}
	}
	for _, row := range []map[string]interface{}{
		{"key": "front_page_show_blocks", "boolean_value": "true", "value_type": 2},
		{"key": "front_page_show_blocks", "boolean_value": nil, "value_type": 2},
		{"key": "front_page_show_blocks", "boolean_value": true, "value_type": 5},
	} {
		err := ValidateRow("system_config", row)
		var refusal *httpresponse.Refusal
		if !errors.As(err, &refusal) || refusal.LangKey != "error_setting_boolean_invalid" || refusal.Status != 400 {
			t.Fatal(err)
		}
	}
}

func TestHomeTopBarBooleanRegistry(t *testing.T) {
	const key = "show_home_button_in_top_bar_on_wide_screens"
	for _, value := range []bool{true, false} {
		if err := ValidateRow("system_config", map[string]interface{}{"key": key, "value_type": 2, "boolean_value": value}); err != nil {
			t.Fatal(err)
		}
	}
	for _, row := range []map[string]interface{}{
		{"key": key, "value_type": 2},
		{"key": key, "value_type": 2, "boolean_value": nil},
		{"key": key, "value_type": 2, "boolean_value": "true"},
		{"key": key, "value_type": 2, "boolean_value": "false"},
		{"key": key, "value_type": 2, "boolean_value": 0},
		{"key": key, "value_type": 2, "boolean_value": 1},
		{"key": key, "value_type": 2, "boolean_value": 1.5},
		{"key": key, "value_type": 2, "boolean_value": map[string]any{}},
		{"key": key, "value_type": 2, "boolean_value": []any{}},
		{"key": key, "value_type": 5, "boolean_value": true},
	} {
		var refusal *httpresponse.Refusal
		if err := ValidateRow("system_config", row); !errors.As(err, &refusal) || refusal.Status != 400 || refusal.LangKey != "error_setting_boolean_invalid" {
			t.Fatal(err)
		}
	}
}

func TestHomeTopBarBooleanGenericPartialWrites(t *testing.T) {
	const key = "show_home_button_in_top_bar_on_wide_screens"
	for _, stored := range []bool{false, true} {
		for _, tc := range []struct {
			name    string
			value   any
			present bool
			valid   bool
		}{
			{"omitted", nil, false, true}, {"true", true, true, true}, {"false", false, true, true},
			{"null", nil, true, false}, {"string", "true", true, false}, {"false_string", "false", true, false},
			{"zero", 0, true, false}, {"one", 1, true, false}, {"decimal", 1.5, true, false},
			{"object", map[string]any{}, true, false}, {"array", []any{}, true, false},
		} {
			t.Run(fmt.Sprintf("stored=%t/%s", stored, tc.name), func(t *testing.T) {
				db := queryfixture.Open(t, func(query string, _ []driver.NamedValue) (driver.Rows, error) {
					if !strings.Contains(query, "FOR UPDATE") {
						t.Fatal("setting was not locked", query)
					}
					row := fmt.Sprintf(`{"id":7,"key":%q,"value_type":2,"boolean_value":%t}`, key, stored)
					return queryfixture.Rows([]string{"config"}, []driver.Value{[]byte(row)}), nil
				})
				for _, method := range []string{"update", "upsert", "matching_update"} {
					t.Run(method, func(t *testing.T) {
						changes := map[string]any{}
						if tc.present {
							changes["boolean_value"] = tc.value
						}
						var err error
						switch method {
						case "update":
							err = ValidateUpdate(db, "system_config", 7, changes)
						case "upsert":
							changes["id"] = 7
							err = ValidateInsert(db, "system_config", changes)
						case "matching_update":
							err = ValidateMatchingUpdate(db, "system_config", "key", key, changes)
						}
						if tc.valid {
							if err != nil {
								t.Fatal(err)
							}
							return
						}
						var refusal *httpresponse.Refusal
						if !errors.As(err, &refusal) || refusal.Status != 400 || refusal.LangKey != "error_setting_boolean_invalid" {
							t.Fatal("invalid setting accepted or refusal shape changed", err)
						}
					})
				}
			})
		}
	}
}
