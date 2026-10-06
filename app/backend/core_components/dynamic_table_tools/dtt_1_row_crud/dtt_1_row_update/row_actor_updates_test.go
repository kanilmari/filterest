// row_actor_updates_test.go
// Proves actor and registry-owner updates are refused before row writes.
// Exercises the actual update handler with administrator and basic sessions.
// A late field in a multi-field request cannot bypass the complete preflight.
package dtt_1_row_update

import (
	"database/sql/driver"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/runtime_grants/granttest"
	"encoding/json"
	"errors"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOwnerSettingReadFailureDoesNotExposeDatabaseDetails(t *testing.T) {
	tx := openUpdRowTx(t, []queuedQuery{{err: errors.New("private database detail")}})
	req := buildUpdateRowSessionRequest(t, "POST", "/", `{"id":4,"column":"row_policy_owner_column","value":"user_id"}`)
	req = req.WithContext(dbutils.SetTx(req.Context(), tx))
	rec := httptest.NewRecorder()
	UpdateRowHandler(granttest.Recorder{ResponseRecorder: rec}, req, "system_db_tables")
	if rec.Code != 500 || strings.Contains(rec.Body.String(), "private database detail") {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
}

func TestActorUpdateHandlerRefusesEveryRoleBeforeWrites(t *testing.T) {
	for _, userRole := range []string{"admin", "basic"} {
		for column, role := range map[string]string{"created_by": "creator", "user_id": "owner"} {
			tx := openUpdRowTx(t, nil, [][]driver.Value{{"created_by", "creator"}, {"user_id", "owner"}})
			body := fmt.Sprintf(`{"id":4,"updates":[{"column":"title","value":"ordinary"},{"column":%q,"value":null}]}`, column)
			req := buildUpdateRowSessionRequestForActor(t, "POST", "/", body, 4, userRole)
			req = req.WithContext(dbutils.SetTx(req.Context(), tx))
			rec := httptest.NewRecorder()
			UpdateRowHandler(rec, req, "app_service_catalog")
			if rec.Code != 400 || !strings.Contains(rec.Body.String(), `"error_lang_key":"error_`+role+`_column_not_editable"`) {
				t.Fatalf("%s %s: %d %s", userRole, column, rec.Code, rec.Body)
			}
		}
	}
}
func TestRegistryOwnerSettingMustMatchItsMark(t *testing.T) {
	for _, value := range []interface{}{nil, "owner_id", "", 42} {
		tx := openUpdRowTx(t, []queuedQuery{{cols: []string{"column_name"}, rows: [][]driver.Value{{"user_id"}}}})
		body := fmt.Sprintf(`{"id":4,"column":"row_policy_owner_column","value":%s}`, mustJSONForActorUpdate(t, value))
		req := buildUpdateRowSessionRequest(t, "POST", "/", body)
		req = req.WithContext(dbutils.SetTx(req.Context(), tx))
		rec := httptest.NewRecorder()
		UpdateRowHandler(granttest.Recorder{ResponseRecorder: rec}, req, "system_db_tables")
		if rec.Code != 400 || !strings.Contains(rec.Body.String(), "error_row_owner_setting_fixed") {
			t.Fatalf("%v: %d %s", value, rec.Code, rec.Body)
		}
	}
	for _, rows := range [][][]driver.Value{nil, {{nil}}, {{"user_id"}}} {
		tx := openUpdRowTx(t, []queuedQuery{{cols: []string{"column_name"}, rows: rows}})
		if err := validateRowActorUpdates(tx, "system_db_tables", 4, []updateRowFieldUpdate{{Column: "row_policy_owner_column", Value: "user_id"}}); err != nil {
			t.Fatal(err)
		}
	}
}
func mustJSONForActorUpdate(t *testing.T, value interface{}) string {
	t.Helper()
	b, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}
