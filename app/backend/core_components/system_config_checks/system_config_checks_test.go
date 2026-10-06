// system_config_checks_test.go
// Checks the registry independently of HTTP handlers or a live database.
// Connects candidate row values to the existing translated refusal contract.
// Exists to protect registered settings while leaving unrelated keys unchanged.
package system_config_checks

import (
	"errors"
	"testing"

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
