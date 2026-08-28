// dedicated_api_guard_test.go
// Verifies generic row updates cannot mutate private Agent Tools report tables.
// Bridges the update-row handler with the dedicated-mutation table policy.
// Exists so immutable report history cannot be bypassed through generic CRUD.
package dtt_1_row_update

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestUpdateRowRejectsDedicatedAPIReportTableBeforeSessionAccess(t *testing.T) {
	for _, tableName := range []string{
		"dev_agent_handover_reports",
		"dev_agent_release_goal_contracts",
		"system_column_field_set_members",
	} {
		t.Run(tableName, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/api/update-row", nil)
			recorder := httptest.NewRecorder()

			UpdateRowHandler(recorder, request, tableName)

			if recorder.Code != http.StatusForbidden {
				t.Fatalf("status = %d, want %d", recorder.Code, http.StatusForbidden)
			}
		})
	}
}
