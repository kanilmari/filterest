// httpresponse_test.go
// Verifies standardized JSON responses and effective HTTP status capture.
// Exercises the boundary between handlers, middleware, and net/http writers.
// Exists to keep response formatting and transaction-finalization signals stable.
package httpresponse

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

type statusCaptureTestWriter struct {
	header       http.Header
	headerCodes  []int
	body         []byte
	flushInvoked bool
}

func (writer *statusCaptureTestWriter) Header() http.Header {
	if writer.header == nil {
		writer.header = make(http.Header)
	}
	return writer.header
}

func (writer *statusCaptureTestWriter) WriteHeader(code int) {
	writer.headerCodes = append(writer.headerCodes, code)
}

func (writer *statusCaptureTestWriter) Write(body []byte) (int, error) {
	writer.body = append(writer.body, body...)
	return len(body), nil
}

func (writer *statusCaptureTestWriter) Flush() {
	writer.flushInvoked = true
}

func TestStatusCaptureDefaultsToOKWithoutExplicitWrite(t *testing.T) {
	capture := NewStatusCapture(&statusCaptureTestWriter{})

	if got := capture.StatusCode(); got != http.StatusOK {
		t.Fatalf("StatusCode() = %d, want %d", got, http.StatusOK)
	}
}

func TestStatusCapturePreservesFirstFinalStatus(t *testing.T) {
	underlying := &statusCaptureTestWriter{}
	capture := NewStatusCapture(underlying)

	capture.WriteHeader(http.StatusNoContent)
	capture.WriteHeader(http.StatusInternalServerError)

	if got := capture.StatusCode(); got != http.StatusNoContent {
		t.Fatalf("StatusCode() = %d, want first final status %d", got, http.StatusNoContent)
	}
	if !reflect.DeepEqual(underlying.headerCodes, []int{http.StatusNoContent, http.StatusInternalServerError}) {
		t.Fatalf("underlying header codes = %v, want both writes forwarded", underlying.headerCodes)
	}
}

func TestStatusCaptureWaitsForFinalStatusAfterInformationalHeader(t *testing.T) {
	underlying := &statusCaptureTestWriter{}
	capture := NewStatusCapture(underlying)

	capture.WriteHeader(http.StatusEarlyHints)
	capture.WriteHeader(http.StatusCreated)

	if got := capture.StatusCode(); got != http.StatusCreated {
		t.Fatalf("StatusCode() = %d, want final status %d", got, http.StatusCreated)
	}
	if !reflect.DeepEqual(underlying.headerCodes, []int{http.StatusEarlyHints, http.StatusCreated}) {
		t.Fatalf("underlying header codes = %v, want informational and final writes", underlying.headerCodes)
	}
}

func TestStatusCaptureWriteAndFlushKeepImplicitOK(t *testing.T) {
	underlying := &statusCaptureTestWriter{}
	capture := NewStatusCapture(underlying)

	if _, err := capture.Write([]byte("body")); err != nil {
		t.Fatalf("Write() returned error: %v", err)
	}
	capture.Flush()

	if got := capture.StatusCode(); got != http.StatusOK {
		t.Fatalf("StatusCode() = %d, want %d", got, http.StatusOK)
	}
	if string(underlying.body) != "body" {
		t.Fatalf("underlying body = %q, want body", underlying.body)
	}
	if !underlying.flushInvoked {
		t.Fatal("Flush() did not delegate to the underlying writer")
	}
}

func TestRespondWithError(t *testing.T) {
	tests := []struct {
		name    string
		code    int
		message string
	}{
		{"bad request", http.StatusBadRequest, "invalid input"},
		{"not found", http.StatusNotFound, "resource not found"},
		{"internal error", http.StatusInternalServerError, "something went wrong"},
		{"forbidden", http.StatusForbidden, "access denied"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			RespondWithError(w, tt.code, tt.message)

			resp := w.Result()

			if resp.StatusCode != tt.code {
				t.Errorf("expected status %d, got %d", tt.code, resp.StatusCode)
			}

			ct := resp.Header.Get("Content-Type")
			if ct != "application/json; charset=utf-8" {
				t.Errorf("expected Content-Type application/json; charset=utf-8, got %q", ct)
			}

			xcto := resp.Header.Get("X-Content-Type-Options")
			if xcto != "nosniff" {
				t.Errorf("expected X-Content-Type-Options nosniff, got %q", xcto)
			}

			var body ErrorBody
			if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
				t.Fatalf("failed to decode response body: %v", err)
			}

			if body.Error != tt.message {
				t.Errorf("expected error message %q, got %q", tt.message, body.Error)
			}
			if body.Code != tt.code {
				t.Errorf("expected code %d, got %d", tt.code, body.Code)
			}
			if body.AuthFailure {
				t.Error("expected auth_failure to be false, got true")
			}
		})
	}
}

func TestRespondWithAuthFailure(t *testing.T) {
	w := httptest.NewRecorder()
	RespondWithAuthFailure(w, "session expired")

	resp := w.Result()

	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("expected status 403, got %d", resp.StatusCode)
	}

	ct := resp.Header.Get("Content-Type")
	if ct != "application/json; charset=utf-8" {
		t.Errorf("expected Content-Type application/json; charset=utf-8, got %q", ct)
	}

	xcto := resp.Header.Get("X-Content-Type-Options")
	if xcto != "nosniff" {
		t.Errorf("expected X-Content-Type-Options nosniff, got %q", xcto)
	}

	var body ErrorBody
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode response body: %v", err)
	}

	if body.Error != "session expired" {
		t.Errorf("expected error message %q, got %q", "session expired", body.Error)
	}
	if body.Code != http.StatusForbidden {
		t.Errorf("expected code 403, got %d", body.Code)
	}
	if !body.AuthFailure {
		t.Error("expected auth_failure to be true, got false")
	}
}

// RespondWithAuthFailure must set auth_failure=true while RespondWithError(403) must not.
// The frontend uses this distinction to choose between redirect and toast.
func TestAuthFailureDistinctFromBusinessLogic403(t *testing.T) {
	wAuth := httptest.NewRecorder()
	RespondWithAuthFailure(wAuth, "not logged in")

	wBiz := httptest.NewRecorder()
	RespondWithError(wBiz, http.StatusForbidden, "insufficient permissions")

	var authBody ErrorBody
	json.NewDecoder(wAuth.Result().Body).Decode(&authBody) //nolint:errcheck

	var bizBody ErrorBody
	json.NewDecoder(wBiz.Result().Body).Decode(&bizBody) //nolint:errcheck

	if !authBody.AuthFailure {
		t.Error("RespondWithAuthFailure: auth_failure should be true")
	}
	if bizBody.AuthFailure {
		t.Error("RespondWithError(403): auth_failure should be false")
	}
}

func TestRespondWithJSON(t *testing.T) {
	type payload struct {
		ID   int    `json:"id"`
		Name string `json:"name"`
	}

	tests := []struct {
		name string
		code int
		data interface{}
	}{
		{"ok with struct", http.StatusOK, payload{ID: 1, Name: "alice"}},
		{"created with struct", http.StatusCreated, payload{ID: 2, Name: "bob"}},
		{"ok with map", http.StatusOK, map[string]string{"key": "value"}},
		{"ok with nil", http.StatusOK, nil},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			RespondWithJSON(w, tt.code, tt.data)

			resp := w.Result()

			if resp.StatusCode != tt.code {
				t.Errorf("expected status %d, got %d", tt.code, resp.StatusCode)
			}

			ct := resp.Header.Get("Content-Type")
			if ct != "application/json; charset=utf-8" {
				t.Errorf("expected Content-Type application/json; charset=utf-8, got %q", ct)
			}

			// Body must be valid JSON.
			var out interface{}
			if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
				t.Errorf("response body is not valid JSON: %v", err)
			}
		})
	}
}

func TestRespondWithJSONRoundTrip(t *testing.T) {
	type item struct {
		Value int `json:"value"`
	}

	w := httptest.NewRecorder()
	RespondWithJSON(w, http.StatusOK, item{Value: 42})

	var got item
	if err := json.NewDecoder(w.Result().Body).Decode(&got); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if got.Value != 42 {
		t.Errorf("expected value 42, got %d", got.Value)
	}
}

func TestErrorBodyOmitsAuthFailureWhenFalse(t *testing.T) {
	w := httptest.NewRecorder()
	RespondWithError(w, http.StatusBadRequest, "bad")

	// Raw JSON must not contain "auth_failure" key when false (omitempty).
	raw := w.Body.String()
	if contains(raw, `"auth_failure"`) {
		t.Errorf("auth_failure field should be omitted when false, got body: %s", raw)
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsRune(s, substr))
}

func containsRune(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
