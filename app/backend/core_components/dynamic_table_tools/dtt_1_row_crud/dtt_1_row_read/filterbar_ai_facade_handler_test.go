// filterbar_ai_facade_handler_test.go
// Verifies the narrow filter bar AI facade request parsing and delegate wiring.
// Bridges the new AI-facing app handlers and the canonical read delegates through isolated tests.
// Exists to keep the API-first migration from regressing back toward SQL-shaped contracts.
package dtt_1_row_read

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func allowFilterbarAIReadAuthorization(t *testing.T) {
	t.Helper()
	originalAuthorizer := filterbarAIReadAuthorizer
	filterbarAIReadAuthorizer = func(_ *http.Request, _ string, _ string) error {
		return nil
	}
	t.Cleanup(func() {
		filterbarAIReadAuthorizer = originalAuthorizer
	})
}

func TestNormalizeFilterbarAIQueryModeDefaults(t *testing.T) {
	mode, err := normalizeFilterbarAIQueryMode(filterbarAIQueryRequest{Mode: "text_search"})
	if err != nil {
		t.Fatalf("normalizeFilterbarAIQueryMode(text_search) error = %v", err)
	}
	if mode != "text_search" {
		t.Fatalf("normalizeFilterbarAIQueryMode(text_search) = %q, want text_search", mode)
	}

	mode, err = normalizeFilterbarAIQueryMode(filterbarAIQueryRequest{Mode: "rows_page"})
	if err != nil {
		t.Fatalf("normalizeFilterbarAIQueryMode(rows_page) error = %v", err)
	}
	if mode != "rows_page" {
		t.Fatalf("normalizeFilterbarAIQueryMode(rows_page) = %q, want rows_page", mode)
	}

	_, err = normalizeFilterbarAIQueryMode(filterbarAIQueryRequest{})
	if err == nil {
		t.Fatal("normalizeFilterbarAIQueryMode(empty) error = nil, want error")
	}
}

func TestBuildFilterbarAIDelegateRequestTextSearch(t *testing.T) {
	original := httptest.NewRequest(http.MethodPost, "/api/app/ai-chat/query", strings.NewReader(`{}`))
	rowCount := 12
	payload := filterbarAIQueryRequest{
		Dataset:  "app_service_catalog",
		Mode:     "text_search",
		Query:    "open source browser",
		Lang:     "en",
		RowCount: &rowCount,
	}

	req, canonicalPath, mode, err := buildFilterbarAIDelegateRequest(original, payload)
	if err != nil {
		t.Fatalf("buildFilterbarAIDelegateRequest(text_search) error = %v", err)
	}
	if mode != "text_search" {
		t.Fatalf("mode = %q, want text_search", mode)
	}
	if canonicalPath != "/api/get-intelligent-results" {
		t.Fatalf("canonicalPath = %q, want /api/get-intelligent-results", canonicalPath)
	}
	if got := req.URL.Query().Get("dataset"); got != "app_service_catalog" {
		t.Fatalf("dataset query param = %q, want app_service_catalog", got)
	}
	if got := req.URL.Query().Get("query"); got != "open source browser" {
		t.Fatalf("query param = %q, want open source browser", got)
	}
	if got := req.URL.Query().Get("lang"); got != "en" {
		t.Fatalf("lang query param = %q, want en", got)
	}
}

func TestBuildFilterbarAIDelegateRequestRowsPage(t *testing.T) {
	original := httptest.NewRequest(http.MethodPost, "/api/app/ai-chat/query", strings.NewReader(`{}`))
	rowCount := 25
	payload := filterbarAIQueryRequest{
		Dataset:  "app_service_catalog",
		Mode:     "rows_page",
		Offset:   50,
		RowCount: &rowCount,
	}

	req, canonicalPath, mode, err := buildFilterbarAIDelegateRequest(original, payload)
	if err != nil {
		t.Fatalf("buildFilterbarAIDelegateRequest(rows_page) error = %v", err)
	}
	if mode != "rows_page" {
		t.Fatalf("mode = %q, want rows_page", mode)
	}
	if canonicalPath != "/api/get-results" {
		t.Fatalf("canonicalPath = %q, want /api/get-results", canonicalPath)
	}
	if got := req.URL.Query().Get("offset"); got != "50" {
		t.Fatalf("offset query param = %q, want 50", got)
	}
	if got := req.URL.Query().Get("row_count"); got != "" {
		t.Fatalf("row_count query param = %q, want empty so canonical API computes the real count", got)
	}
}

func TestFilterbarAICapabilitiesHandlerUsesReaders(t *testing.T) {
	originalColumnsReader := filterbarAIColumnsReader
	originalEmbeddingsReader := filterbarAIEmbeddingsReader
	t.Cleanup(func() {
		filterbarAIColumnsReader = originalColumnsReader
		filterbarAIEmbeddingsReader = originalEmbeddingsReader
	})

	filterbarAIColumnsReader = func(dataset string) ([]map[string]interface{}, error) {
		if dataset != "app_service_catalog" {
			t.Fatalf("dataset = %q, want app_service_catalog", dataset)
		}
		return []map[string]interface{}{
			{
				"column_uid":  1,
				"column_name": "header",
				"data_type":   "text",
				"co_number":   1,
			},
		}, nil
	}
	filterbarAIEmbeddingsReader = func(dataset string) (bool, error) {
		if dataset != "app_service_catalog" {
			t.Fatalf("dataset = %q, want app_service_catalog", dataset)
		}
		return true, nil
	}

	req := httptest.NewRequest(http.MethodGet, "/api/app/ai-chat/capabilities?dataset=app_service_catalog", nil)
	rec := httptest.NewRecorder()

	FilterbarAICapabilitiesHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("FilterbarAICapabilitiesHandler status = %d, want 200", rec.Code)
	}

	var response filterbarAICapabilitiesResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("response JSON unmarshal error = %v", err)
	}
	if response.Dataset != "app_service_catalog" {
		t.Fatalf("response.Dataset = %q, want app_service_catalog", response.Dataset)
	}
	if len(response.Columns) != 1 {
		t.Fatalf("len(response.Columns) = %d, want 1", len(response.Columns))
	}
	if !response.Search.SupportsMultilingualEmbeddings {
		t.Fatal("expected SupportsMultilingualEmbeddings = true")
	}
}

func TestFilterbarAIQueryHandlerWrapsExplicitDelegate(t *testing.T) {
	originalDelegates := filterbarAIQueryDelegates
	allowFilterbarAIReadAuthorization(t)
	t.Cleanup(func() {
		filterbarAIQueryDelegates = originalDelegates
	})

	filterbarAIQueryDelegates = map[string]http.HandlerFunc{
		"text_search": func(w http.ResponseWriter, r *http.Request) {
			if got := r.URL.Query().Get("dataset"); got != "app_service_catalog" {
				t.Fatalf("delegate dataset = %q, want app_service_catalog", got)
			}
			if got := r.URL.Query().Get("query"); got != "open source browser" {
				t.Fatalf("delegate query = %q, want open source browser", got)
			}
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"columns": []string{"id", "header"},
				"data": []map[string]interface{}{
					{"id": 1, "header": "Firefox"},
					{"id": 2, "header": "Brave"},
				},
				"types": map[string]interface{}{
					"header": "text",
				},
				"resultsPerLoad": 25,
			})
		},
	}

	req := httptest.NewRequest(http.MethodPost, "/api/app/ai-chat/query", strings.NewReader(`{
		"dataset": "app_service_catalog",
		"mode": "text_search",
		"query": "open source browser"
	}`))
	rec := httptest.NewRecorder()

	FilterbarAIQueryHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("FilterbarAIQueryHandler status = %d, want 200", rec.Code)
	}

	var response filterbarAIQueryResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("response JSON unmarshal error = %v", err)
	}
	if response.Plan.CanonicalPath != "/api/get-intelligent-results" {
		t.Fatalf("response.Plan.CanonicalPath = %q, want /api/get-intelligent-results", response.Plan.CanonicalPath)
	}
	if response.Plan.UsesSQL {
		t.Fatal("response.Plan.UsesSQL = true, want false")
	}
	if response.Answer != "Returned 2 result rows through text_search." {
		t.Fatalf("response.Answer = %q, want expected row-count sentence", response.Answer)
	}
	if response.Memory == nil {
		t.Fatal("response.Memory = nil, want result context memory")
	}
	if response.Memory.Role != "system" {
		t.Fatalf("response.Memory.Role = %q, want system", response.Memory.Role)
	}
	if !strings.HasPrefix(response.Memory.Content, filterbarAIResultMemoryMarker) {
		t.Fatalf("response.Memory.Content = %q, want marker prefix", response.Memory.Content)
	}
}

func TestFilterbarAIQueryHandlerReturnsConfigurationPromptWhenOpenAIKeyIsMissing(t *testing.T) {
	originalPlannerFunc := filterbarAIPlannerFunc
	originalColumnsReader := filterbarAIColumnsReader
	originalEmbeddingsReader := filterbarAIEmbeddingsReader
	t.Cleanup(func() {
		filterbarAIPlannerFunc = originalPlannerFunc
		filterbarAIColumnsReader = originalColumnsReader
		filterbarAIEmbeddingsReader = originalEmbeddingsReader
	})

	filterbarAIColumnsReader = func(string) ([]map[string]interface{}, error) {
		return []map[string]interface{}{{"column_name": "id"}}, nil
	}
	filterbarAIEmbeddingsReader = func(string) (bool, error) { return false, nil }
	filterbarAIPlannerFunc = func(context.Context, filterbarAIQueryRequest, []map[string]interface{}, bool) (filterbarAIPlannerResponse, error) {
		return filterbarAIPlannerResponse{}, errFilterbarAIOpenAIKeyMissing
	}

	req := httptest.NewRequest(http.MethodPost, "/api/app/ai-chat/query", strings.NewReader(`{
		"dataset": "app_service_catalog",
		"query": "show services"
	}`))
	recorder := httptest.NewRecorder()

	FilterbarAIQueryHandler(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 configuration response", recorder.Code)
	}
	var response filterbarAIQueryResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if response.ConfigurationRequired == nil || response.ConfigurationRequired.Code != "openai_api_key_missing" {
		t.Fatalf("configuration_required = %#v, want openai_api_key_missing", response.ConfigurationRequired)
	}
	if strings.Contains(recorder.Body.String(), "OPENAI_API_KEY") {
		t.Fatal("configuration response exposed the internal environment variable name")
	}
}
