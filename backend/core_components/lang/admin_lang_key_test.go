// admin_lang_key_test.go
// Verifies the strict administrator language-key request contract and transaction requirement.
// Bridges HTTP payload validation with the production-safe persistence boundary.
// Exists to prevent a production language maintenance route from becoming permissive or non-atomic.
package lang

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

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
	if captured.LangKey != "travel_info_front_page" || captured.Fi != "Matkainfo" || captured.En != "Travel information" {
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
		langKeyUpdateRequest{LangKey: "link", Fi: "Linkki", En: "Link"},
		"admin_api",
		"admin_lang_key",
	)
	if err == nil || err.Error() != "transaction start failed" {
		t.Fatalf("error = %v, want transaction start failed", err)
	}
}
