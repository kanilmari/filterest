package error_handling

import (
	"bytes"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWithErrorRecovery_NormalPassthrough(t *testing.T) {
	handler := WithErrorRecovery("testHandler", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Custom", "yes")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"ok":true}`))
	})

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	rr := httptest.NewRecorder()
	handler(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
	if got := rr.Body.String(); !strings.Contains(got, `"ok":true`) {
		t.Errorf("unexpected body: %s", got)
	}
	if rr.Header().Get("X-Custom") != "yes" {
		t.Error("expected X-Custom header to pass through")
	}
}

func TestWithErrorRecovery_PanicWithString(t *testing.T) {
	handler := WithErrorRecovery("testHandler", func(w http.ResponseWriter, r *http.Request) {
		panic("something went wrong")
	})

	req := httptest.NewRequest(http.MethodPost, "/boom", nil)
	rr := httptest.NewRecorder()

	// Should not propagate the panic to the caller
	handler(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", rr.Code)
	}

	ct := rr.Header().Get("Content-Type")
	if !strings.Contains(ct, "application/json") {
		t.Errorf("expected application/json content-type, got %q", ct)
	}

	var body map[string]interface{}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("response body is not valid JSON: %v", err)
	}
	if body["error"] != "Internal Server Error" {
		t.Errorf("unexpected error field: %v", body["error"])
	}
}

func TestWithErrorRecovery_PanicWithInteger(t *testing.T) {
	handler := WithErrorRecovery("testHandler", func(w http.ResponseWriter, r *http.Request) {
		panic(42)
	})

	req := httptest.NewRequest(http.MethodGet, "/panic-int", nil)
	rr := httptest.NewRecorder()
	handler(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", rr.Code)
	}

	var body map[string]interface{}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("response body is not valid JSON: %v", err)
	}
	if body["error"] != "Internal Server Error" {
		t.Errorf("unexpected error field: %v", body["error"])
	}
}

func TestWithErrorRecovery_PanicWithError(t *testing.T) {
	handler := WithErrorRecovery("testHandler", func(w http.ResponseWriter, r *http.Request) {
		panic(errors.New("db connection lost"))
	})

	req := httptest.NewRequest(http.MethodGet, "/panic-err", nil)
	rr := httptest.NewRecorder()
	handler(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", rr.Code)
	}

	var body map[string]interface{}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("response body is not valid JSON: %v", err)
	}
	if body["error"] != "Internal Server Error" {
		t.Errorf("unexpected error field: %v", body["error"])
	}
}

func TestWithErrorRecovery_LogOutput(t *testing.T) {
	var buf bytes.Buffer
	log.SetOutput(&buf)
	defer log.SetOutput(nil) // restore default (stderr)

	const handlerName = "mySpecialHandler"
	handler := WithErrorRecovery(handlerName, func(w http.ResponseWriter, r *http.Request) {
		panic("log-test-panic")
	})

	req := httptest.NewRequest(http.MethodDelete, "/some/path", nil)
	rr := httptest.NewRecorder()
	handler(rr, req)

	logged := buf.String()

	checks := []struct {
		label string
		want  string
	}{
		{"handler name", handlerName},
		{"HTTP method", "DELETE"},
		{"URL path", "/some/path"},
		{"panic value", "log-test-panic"},
	}
	for _, c := range checks {
		if !strings.Contains(logged, c.want) {
			t.Errorf("log missing %s: expected %q in %q", c.label, c.want, logged)
		}
	}
}
