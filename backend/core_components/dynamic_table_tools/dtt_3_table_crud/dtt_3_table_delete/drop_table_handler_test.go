// drop_table_handler_test.go
// Unit tests for the lightweight guard branches in DropTableHandler.
// These tests stay deliberately above the transaction/database boundary and verify the cheap HTTP validation paths without a live database.
package dtt_3_table_delete

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDropTableHandlerRejectsInvalidRequestsBeforeDatabaseWork(t *testing.T) {
	tests := []struct {
		name       string
		method     string
		body       string
		wantStatus int
		wantBody   string
	}{
		{
			name:       "method not allowed",
			method:     http.MethodGet,
			body:       "",
			wantStatus: http.StatusMethodNotAllowed,
			wantBody:   "only POST allowed",
		},
		{
			name:       "invalid json",
			method:     http.MethodPost,
			body:       "{",
			wantStatus: http.StatusBadRequest,
			wantBody:   "invalid data:",
		},
		{
			name:       "missing table name",
			method:     http.MethodPost,
			body:       `{"dataset_name":""}`,
			wantStatus: http.StatusBadRequest,
			wantBody:   "table name is missing",
		},
		{
			name:       "invalid identifier",
			method:     http.MethodPost,
			body:       `{"dataset_name":"bad-name"}`,
			wantStatus: http.StatusBadRequest,
			wantBody:   "error validating table name:",
		},
		{
			name:       "missing transaction",
			method:     http.MethodPost,
			body:       `{"dataset_name":"users"}`,
			wantStatus: http.StatusInternalServerError,
			wantBody:   "failed to acquire transaction",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, "/api/drop-dataset", bytes.NewBufferString(tt.body))
			rec := httptest.NewRecorder()

			DropTableHandler(rec, req)

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d (body: %s)", rec.Code, tt.wantStatus, rec.Body.String())
			}
			if body := rec.Body.String(); !bytes.Contains([]byte(body), []byte(tt.wantBody)) {
				t.Fatalf("body = %q, want substring %q", body, tt.wantBody)
			}
		})
	}
}
