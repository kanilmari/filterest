// dedicated_api_guard_test.go
// Verifies generic row deletion cannot remove private Agent Tools report tables.
// Bridges the delete-rows handler with the dedicated-mutation table policy.
// Exists so append-first handover history cannot be bypassed through generic CRUD.
package dtt_1_row_delete

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDeleteRowsRejectsDedicatedAPIReportTableBeforeBodyAccess(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/api/delete-rows", nil)
	recorder := httptest.NewRecorder()

	DeleteRowsHandler(recorder, request, "dev_agent_handover_report_items")

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusForbidden)
	}
}
