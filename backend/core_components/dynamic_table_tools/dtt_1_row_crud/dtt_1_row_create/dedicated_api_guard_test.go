// dedicated_api_guard_test.go
// Verifies generic row creation cannot write private Agent Tools report tables.
// Bridges the add-row handler with the dedicated-mutation table policy.
// Exists so report secret screening cannot be bypassed through generic CRUD.
package dtt_1_row_create

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAddRowRejectsDedicatedAPIReportTableBeforeDatabaseAccess(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/api/add-row-multipart", nil)
	recorder := httptest.NewRecorder()

	AddRowMultipartHandler(recorder, request, "dev_agent_workline_reports")

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusForbidden)
	}
}
