// provider_api_key_handler_test.go
// Verifies the admin provider API key endpoint's provider handling, outcomes and non-disclosure contract.
// Bridges JSON requests with an injected protected-environment writer.
// Exists so the embedding page can tell a refused key from an installation it cannot write, and never echoes a secret.
package router

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
)

func postProviderAPIKey(t *testing.T, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/admin/provider-api-key", strings.NewReader(body))
	recorder := httptest.NewRecorder()
	saveProviderAPIKeyHandler(recorder, req)
	return recorder
}

func replaceProviderAPIKeySaver(t *testing.T, saver func(string, string) error) {
	t.Helper()
	original := providerAPIKeySaver
	providerAPIKeySaver = saver
	t.Cleanup(func() { providerAPIKeySaver = original })
}

func TestSaveProviderAPIKeyHandlerPassesTheNamedProviderWithoutEchoingTheKey(t *testing.T) {
	secret := "test-google-handler-secret"
	receivedProvider, receivedKey := "", ""
	replaceProviderAPIKeySaver(t, func(provider string, apiKey string) error {
		receivedProvider, receivedKey = provider, apiKey
		return nil
	})

	recorder := postProviderAPIKey(t, `{"provider":"google","api_key":"`+secret+`"}`)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	if receivedProvider != "google" || receivedKey != secret {
		t.Fatalf("saver received %q/%q, want google/submitted secret", receivedProvider, receivedKey)
	}
	if strings.Contains(recorder.Body.String(), secret) {
		t.Fatal("response exposed the submitted provider API key")
	}
	if !strings.Contains(recorder.Body.String(), `"provider":"google"`) {
		t.Fatalf("response did not name the configured provider: %s", recorder.Body.String())
	}
}

func TestSaveProviderAPIKeyHandlerSeparatesTheOutcomesTheAdministratorActsOn(t *testing.T) {
	secret := "test-outcome-secret"
	cases := []struct {
		name       string
		saverError error
		wantStatus int
	}{
		{"an unknown provider", backend.ErrUnknownAPIKeyProvider, http.StatusBadRequest},
		{"a refused key", backend.ErrInvalidProviderAPIKey, http.StatusBadRequest},
		{
			"settings the application cannot write",
			fmt.Errorf("%w: install environment update", backend.ErrProtectedEnvironmentNotWritable),
			http.StatusConflict,
		},
		{"an unexpected failure", errors.New("disk failure near " + secret), http.StatusInternalServerError},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			replaceProviderAPIKeySaver(t, func(string, string) error { return testCase.saverError })

			recorder := postProviderAPIKey(t, `{"provider":"google","api_key":"`+secret+`"}`)

			if recorder.Code != testCase.wantStatus {
				t.Fatalf("status = %d, want %d", recorder.Code, testCase.wantStatus)
			}
			body := recorder.Body.String()
			if strings.Contains(body, secret) || strings.Contains(body, "disk failure") {
				t.Fatalf("response exposed the submitted key or an internal error: %s", body)
			}
			if strings.Contains(body, `"saved":true`) {
				t.Fatal("a failed save reported success")
			}
		})
	}
}

func TestSaveProviderAPIKeyHandlerRefusesAnUnreadableRequest(t *testing.T) {
	called := false
	replaceProviderAPIKeySaver(t, func(string, string) error {
		called = true
		return nil
	})

	for _, body := range []string{
		`not json`,
		`{"provider":"google","api_key":"x","extra":"field"}`,
	} {
		recorder := postProviderAPIKey(t, body)
		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("status for %q = %d, want 400", body, recorder.Code)
		}
	}
	if called {
		t.Fatal("an unreadable request reached the protected-environment writer")
	}
}
