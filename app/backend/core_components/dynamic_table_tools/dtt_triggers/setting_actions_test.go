// setting_actions_test.go
// Refuses an automation's invalid setting before executing its INSERT.
// Reuses the actor-action SQL driver and tests the existing service error shape.
// Exists so a stored automation cannot bypass the same rule as a direct save.
package dtt_triggers

import (
	"database/sql"
	"errors"
	"fmt"
	"testing"
	"time"

	"easelect/backend/core_components/httpresponse"
)

func TestAutomationSettingRefusalBeforeWriting(t *testing.T) {
	state := &triggerAccountTargetState{}
	name := fmt.Sprintf("setting-actions-%d", time.Now().UnixNano())
	sql.Register(name, &triggerAccountTargetDriver{state})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	err = executeAction(tx, 119, "system_config", `{"key":"absolute_sign_in_limit","value_type":5,"json_value":{"limit_enabled":true,"limit_unit":"unknown","limit_amount":1}}`, nil)
	var refusal *httpresponse.Refusal
	if !errors.As(err, &refusal) || refusal.Status != 400 || refusal.LangKey != "error_setting_duration_invalid" || len(state.inserted) != 0 || state.actionQuery != "" {
		t.Fatalf("%v: %+v", err, state)
	}
}
