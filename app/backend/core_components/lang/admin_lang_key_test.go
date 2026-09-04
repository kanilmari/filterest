// admin_lang_key_test.go
// Verifies the strict administrator language-key request contract and transaction requirement.
// Bridges HTTP payload validation with the production-safe persistence boundary.
// Exists to prevent a production language maintenance route from becoming permissive or non-atomic.
package lang

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGetLangKeyTranslationsHandlerReportsExistenceAndFailsOnReadErrors(t *testing.T) {
	originalRead := readLangKeyMaintenanceRecord
	t.Cleanup(func() { readLangKeyMaintenanceRecord = originalRead })

	t.Run("existing key", func(t *testing.T) {
		readLangKeyMaintenanceRecord = func(langKey string) (langKeyMaintenanceRecord, error) {
			if langKey != "save" {
				t.Fatalf("lang key = %q, want save", langKey)
			}
			return langKeyMaintenanceRecord{
				Exists:           true,
				Fi:               "Tallenna",
				En:               "Save",
				UsageExplanation: "Button that saves the edited form.",
			}, nil
		}
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/api/get-lang-key-translations?lang_key=save", nil)

		GetLangKeyTranslationsHandler(response, request)

		if response.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
		}
		var body map[string]interface{}
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode response: %v", err)
		}
		if body["exists"] != true || body["fi"] != "Tallenna" || body["en"] != "Save" {
			t.Fatalf("response = %#v", body)
		}
	})

	t.Run("missing key", func(t *testing.T) {
		readLangKeyMaintenanceRecord = func(string) (langKeyMaintenanceRecord, error) {
			return langKeyMaintenanceRecord{}, nil
		}
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/api/get-lang-key-translations?lang_key=missing", nil)

		GetLangKeyTranslationsHandler(response, request)

		var body map[string]interface{}
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode response: %v", err)
		}
		if body["exists"] != false {
			t.Fatalf("response = %#v", body)
		}
	})

	t.Run("read error", func(t *testing.T) {
		readLangKeyMaintenanceRecord = func(string) (langKeyMaintenanceRecord, error) {
			return langKeyMaintenanceRecord{}, errors.New("database unavailable")
		}
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/api/get-lang-key-translations?lang_key=save", nil)

		GetLangKeyTranslationsHandler(response, request)

		if response.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", response.Code)
		}
	})
}

func TestAdminLangKeyHandlerAcceptsOneStrictPostPayload(t *testing.T) {
	originalPersist := persistLangKeyUpdate
	t.Cleanup(func() { persistLangKeyUpdate = originalPersist })

	var captured langKeyUpdateRequest
	var capturedSourceType string
	var capturedSourceHigh string
	persistLangKeyUpdate = func(
		_ context.Context,
		request langKeyUpdateRequest,
		sourceType string,
		sourceHigh string,
	) error {
		captured = request
		capturedSourceType = sourceType
		capturedSourceHigh = sourceHigh
		return nil
	}

	response := httptest.NewRecorder()
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/admin/lang-key",
		strings.NewReader(`{
			"lang_key":" travel_info_front_page ",
			"fi":"Matkainfo",
			"en":"Travel information",
			"ch":"",
			"yue":"",
			"usage_explanation":"Reviewed Fintravel hero heading."
		}`),
	)

	AdminLangKeyHandler(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if captured.LangKey != "travel_info_front_page" || captured.Fi == nil || *captured.Fi != "Matkainfo" || captured.En == nil || *captured.En != "Travel information" {
		t.Fatalf("captured request = %+v", captured)
	}
	if capturedSourceType != "admin_api" || capturedSourceHigh != "admin_lang_key" {
		t.Fatalf("source = %q/%q", capturedSourceType, capturedSourceHigh)
	}

	var body map[string]interface{}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body["success"] != true || body["lang_key"] != "travel_info_front_page" {
		t.Fatalf("response = %#v", body)
	}
}

func TestAdminLangKeyHandlerKeepsOmittedFieldsOutOfThePatch(t *testing.T) {
	originalPersist := persistLangKeyUpdate
	t.Cleanup(func() { persistLangKeyUpdate = originalPersist })

	var captured langKeyUpdateRequest
	persistLangKeyUpdate = func(_ context.Context, request langKeyUpdateRequest, _, _ string) error {
		captured = request
		return nil
	}
	response := httptest.NewRecorder()
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/admin/lang-key",
		strings.NewReader(`{"lang_key":"save","en":"Store"}`),
	)

	AdminLangKeyHandler(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if captured.En == nil || *captured.En != "Store" {
		t.Fatalf("English patch = %v, want Store", captured.En)
	}
	if captured.Fi != nil || captured.Ch != nil || captured.Yue != nil || captured.UsageExplanation != nil {
		t.Fatalf("omitted fields must remain nil: %+v", captured)
	}
}

func TestAdminLangKeyHandlerRejectsNonPostUnknownAndTrailingJSON(t *testing.T) {
	originalPersist := persistLangKeyUpdate
	t.Cleanup(func() { persistLangKeyUpdate = originalPersist })
	persistCalls := 0
	persistLangKeyUpdate = func(context.Context, langKeyUpdateRequest, string, string) error {
		persistCalls++
		return nil
	}

	tests := []struct {
		name       string
		method     string
		body       string
		wantStatus int
	}{
		{name: "GET", method: http.MethodGet, body: "", wantStatus: http.StatusMethodNotAllowed},
		{name: "unknown field", method: http.MethodPost, body: `{"lang_key":"link","fi":"Linkki","unknown":true}`, wantStatus: http.StatusBadRequest},
		{name: "trailing object", method: http.MethodPost, body: `{"lang_key":"link","fi":"Linkki"}{}`, wantStatus: http.StatusBadRequest},
		{name: "blank key", method: http.MethodPost, body: `{"lang_key":"  ","fi":"Linkki"}`, wantStatus: http.StatusBadRequest},
		{name: "no patch fields", method: http.MethodPost, body: `{"lang_key":"link"}`, wantStatus: http.StatusBadRequest},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			request := httptest.NewRequest(test.method, "/api/admin/lang-key", strings.NewReader(test.body))
			AdminLangKeyHandler(response, request)
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d, body = %s", response.Code, test.wantStatus, response.Body.String())
			}
		})
	}
	if persistCalls != 0 {
		t.Fatalf("persistence called %d times for invalid requests", persistCalls)
	}
}

func TestPersistLangKeyUpdateRequiresPipelineTransaction(t *testing.T) {
	err := persistLangKeyUpdateTransactionally(
		context.Background(),
		langKeyUpdateRequest{LangKey: "link", Fi: stringPointer("Linkki"), En: stringPointer("Link")},
		"admin_api",
		"admin_lang_key",
	)
	if err == nil || err.Error() != "transaction start failed" {
		t.Fatalf("error = %v, want transaction start failed", err)
	}
}
