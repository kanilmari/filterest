// openai_api_key_handler_test.go
// Verifies the admin OpenAI API key endpoint's method, validation, and non-disclosure contract.
// Bridges JSON requests with an injected protected-environment writer.
// Exists so secrets cannot leak through successful or failed HTTP responses.
package router

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
)

func TestSaveOpenAIAPIKeyHandlerStoresSecretWithoutEchoingIt(t *testing.T) {
	originalSaver := openAIAPIKeySaver
	defer func() { openAIAPIKeySaver = originalSaver }()

	secret := "test-handler-secret"
	received := ""
	openAIAPIKeySaver = func(value string) error {
		received = value
		return nil
	}
	req := httptest.NewRequest(http.MethodPost, "/api/admin/openai-api-key", strings.NewReader(`{"api_key":"`+secret+`"}`))
	recorder := httptest.NewRecorder()

	saveOpenAIAPIKeyHandler(recorder, req)

	if recorder.Code != http.StatusOK || received != secret {
		t.Fatalf("status/received = %d/%q, want 200/submitted secret", recorder.Code, received)
	}
	if strings.Contains(recorder.Body.String(), secret) {
		t.Fatal("response exposed the submitted OpenAI API key")
	}
}

func TestSaveOpenAIAPIKeyHandlerDoesNotExposeSaverError(t *testing.T) {
	originalSaver := openAIAPIKeySaver
	defer func() { openAIAPIKeySaver = originalSaver }()

	secret := "test-error-secret"
	openAIAPIKeySaver = func(string) error { return errors.New("disk failure near " + secret) }
	req := httptest.NewRequest(http.MethodPost, "/api/admin/openai-api-key", strings.NewReader(`{"api_key":"`+secret+`"}`))
	recorder := httptest.NewRecorder()

	saveOpenAIAPIKeyHandler(recorder, req)

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", recorder.Code)
	}
	if strings.Contains(recorder.Body.String(), secret) || strings.Contains(recorder.Body.String(), "disk failure") {
		t.Fatal("response exposed an internal saver error or submitted secret")
	}
}

func TestSaveOpenAIAPIKeyHandlerMapsInvalidSecretToBadRequest(t *testing.T) {
	originalSaver := openAIAPIKeySaver
	defer func() { openAIAPIKeySaver = originalSaver }()

	openAIAPIKeySaver = func(string) error { return backend.ErrInvalidOpenAIAPIKey }
	req := httptest.NewRequest(http.MethodPost, "/api/admin/openai-api-key", strings.NewReader(`{"api_key":""}`))
	recorder := httptest.NewRecorder()

	saveOpenAIAPIKeyHandler(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", recorder.Code)
	}
}
