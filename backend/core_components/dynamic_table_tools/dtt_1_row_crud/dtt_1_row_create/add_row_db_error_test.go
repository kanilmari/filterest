package dtt_1_row_create

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRespondToTriggerExecutionErrorReturnsHTTP500(t *testing.T) {
	rec := httptest.NewRecorder()

	err := respondToTriggerExecutionError(rec, "palvelukatalogi_assets", errors.New("trigger query failed"))

	if err == nil || !strings.Contains(err.Error(), "palvelukatalogi_assets") {
		t.Fatalf("respondToTriggerExecutionError() error = %v, want wrapped table-specific error", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
	if strings.Contains(strings.ToLower(rec.Body.String()), "success") {
		t.Fatalf("body = %q, must not report success", rec.Body.String())
	}
}
