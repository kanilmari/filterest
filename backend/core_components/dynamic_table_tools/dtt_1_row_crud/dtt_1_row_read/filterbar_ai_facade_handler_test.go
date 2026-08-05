// filterbar_ai_facade_handler_test.go
// Verifies the narrow filter bar AI facade request parsing and delegate wiring.
// Bridges the new AI-facing app handlers and the canonical read delegates through isolated tests.
// Exists to keep the API-first migration from regressing back toward SQL-shaped contracts.
package dtt_1_row_read

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
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

func TestFilterbarAIQueryHandlerUsesLLMPlannerWhenModeOmitted(t *testing.T) {
	originalPlannerFunc := filterbarAIPlannerFunc
	originalAnswererFunc := filterbarAIAnswererFunc
	originalColumnsReader := filterbarAIColumnsReader
	originalEmbeddingsReader := filterbarAIEmbeddingsReader
	originalDelegates := filterbarAIQueryDelegates
	allowFilterbarAIReadAuthorization(t)
	t.Cleanup(func() {
		filterbarAIPlannerFunc = originalPlannerFunc
		filterbarAIAnswererFunc = originalAnswererFunc
		filterbarAIColumnsReader = originalColumnsReader
		filterbarAIEmbeddingsReader = originalEmbeddingsReader
		filterbarAIQueryDelegates = originalDelegates
	})

	filterbarAIColumnsReader = func(dataset string) ([]map[string]interface{}, error) {
		return []map[string]interface{}{
			{"column_name": "id"},
			{"column_name": "header"},
			{"column_name": "created_at"},
		}, nil
	}
	filterbarAIEmbeddingsReader = func(dataset string) (bool, error) {
		return true, nil
	}
	filterbarAIPlannerFunc = func(_ context.Context, payload filterbarAIQueryRequest, columns []map[string]interface{}, supportsEmbeddings bool) (filterbarAIPlannerResponse, error) {
		_ = columns
		if payload.Query != "open source browser" {
			t.Fatalf("payload.Query = %q, want open source browser", payload.Query)
		}
		if !supportsEmbeddings {
			t.Fatal("supportsEmbeddings = false, want true")
		}
		if len(payload.Messages) != 1 || payload.Messages[0].Content != "open source browser" {
			t.Fatalf("payload.Messages = %#v, want one current user message", payload.Messages)
		}
		return filterbarAIPlannerResponse{
			Answer: "Searching for open source browsers.",
			Plan: filterbarAIQueryPlan{
				Mode:        "text_search",
				UsesSQL:     false,
				SearchQuery: "open source browser",
			},
		}, nil
	}
	filterbarAIAnswererFunc = func(_ context.Context, payload filterbarAIQueryRequest, plannerResponse filterbarAIPlannerResponse, resultContext filterbarAIResultContext) (filterbarAIAnswerResponse, error) {
		if payload.Query != "open source browser" {
			t.Fatalf("answer payload.Query = %q, want open source browser", payload.Query)
		}
		if plannerResponse.Plan.Mode != "text_search" {
			t.Fatalf("answer plan mode = %q, want text_search", plannerResponse.Plan.Mode)
		}
		if resultContext.RowsVisible != 1 {
			t.Fatalf("resultContext.RowsVisible = %d, want 1", resultContext.RowsVisible)
		}
		if got := resultContext.Rows[0].Title; got != "Firefox" {
			t.Fatalf("resultContext first title = %q, want Firefox", got)
		}
		return filterbarAIAnswerResponse{Answer: "Firefox is the strongest visible match."}, nil
	}

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
				},
				"types":     map[string]interface{}{"header": "text"},
				"row_count": 1,
			})
		},
	}

	req := httptest.NewRequest(http.MethodPost, "/api/app/ai-chat/query", strings.NewReader(`{
		"dataset": "app_service_catalog",
		"query": "open source browser",
		"messages": [{"role": "user", "content": "open source browser"}]
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
	if response.Plan.Mode != "text_search" {
		t.Fatalf("response.Plan.Mode = %q, want text_search", response.Plan.Mode)
	}
	if response.Plan.SearchQuery != "open source browser" {
		t.Fatalf("response.Plan.SearchQuery = %q, want open source browser", response.Plan.SearchQuery)
	}
	if response.Answer != "Firefox is the strongest visible match." {
		t.Fatalf("response.Answer = %q, want result-aware LLM answer", response.Answer)
	}
	if response.Memory == nil || !strings.Contains(response.Memory.Content, "Firefox") {
		t.Fatalf("response.Memory = %#v, want hidden Firefox result memory", response.Memory)
	}
}

func TestFilterbarAIQueryHandlerExecutesMultiDatasetPlannerCalls(t *testing.T) {
	originalPlannerFunc := filterbarAIPlannerFunc
	originalAnswererFunc := filterbarAIAnswererFunc
	originalColumnsReader := filterbarAIColumnsReader
	originalEmbeddingsReader := filterbarAIEmbeddingsReader
	originalDelegates := filterbarAIQueryDelegates
	allowFilterbarAIReadAuthorization(t)
	t.Cleanup(func() {
		filterbarAIPlannerFunc = originalPlannerFunc
		filterbarAIAnswererFunc = originalAnswererFunc
		filterbarAIColumnsReader = originalColumnsReader
		filterbarAIEmbeddingsReader = originalEmbeddingsReader
		filterbarAIQueryDelegates = originalDelegates
	})

	filterbarAIColumnsReader = func(dataset string) ([]map[string]interface{}, error) {
		if dataset != "app_service_catalog" {
			t.Fatalf("capability dataset = %q, want app_service_catalog", dataset)
		}
		return []map[string]interface{}{
			{"column_name": "id"},
			{"column_name": "header"},
			{"column_name": "cached_username"},
		}, nil
	}
	filterbarAIEmbeddingsReader = func(dataset string) (bool, error) {
		return true, nil
	}
	filterbarAIPlannerFunc = func(_ context.Context, payload filterbarAIQueryRequest, columns []map[string]interface{}, supportsEmbeddings bool) (filterbarAIPlannerResponse, error) {
		_ = payload
		_ = columns
		_ = supportsEmbeddings
		return filterbarAIPlannerResponse{
			Answer: "Haen palvelukatalogista ja tehtävistä.",
			Calls: []filterbarAIPlannedCall{
				{
					Dataset: "app_service_catalog",
					Plan: filterbarAIQueryPlan{
						Dataset: "app_service_catalog",
						Mode:    "rows_page",
						UsesSQL: false,
						Filters: map[string]string{"cached_username": "serlog"},
					},
				},
				{
					Dataset: "dev_agent_tasks",
					Plan: filterbarAIQueryPlan{
						Dataset:     "dev_agent_tasks",
						Mode:        "text_search",
						UsesSQL:     false,
						SearchQuery: "serlog palvelukatalogi",
					},
				},
			},
		}, nil
	}
	filterbarAIAnswererFunc = func(_ context.Context, payload filterbarAIQueryRequest, plannerResponse filterbarAIPlannerResponse, resultContext filterbarAIResultContext) (filterbarAIAnswerResponse, error) {
		if payload.Dataset != "app_service_catalog" {
			t.Fatalf("answer payload.Dataset = %q, want app_service_catalog", payload.Dataset)
		}
		if len(plannerResponse.Calls) != 2 {
			t.Fatalf("plannerResponse.Calls len = %d, want 2", len(plannerResponse.Calls))
		}
		if resultContext.Dataset != "app_service_catalog" {
			t.Fatalf("resultContext.Dataset = %q, want app_service_catalog", resultContext.Dataset)
		}
		if len(resultContext.Related) != 1 || resultContext.Related[0].Dataset != "dev_agent_tasks" {
			t.Fatalf("resultContext.Related = %#v, want dev_agent_tasks related context", resultContext.Related)
		}
		return filterbarAIAnswerResponse{Answer: "Löysin yhden Serlog-palvelun ja yhden aiheeseen liittyvän tehtävän."}, nil
	}

	filterbarAIQueryDelegates = map[string]http.HandlerFunc{
		"rows_page": func(w http.ResponseWriter, r *http.Request) {
			if got := r.URL.Query().Get("dataset"); got != "app_service_catalog" {
				t.Fatalf("rows_page dataset = %q, want app_service_catalog", got)
			}
			if got := r.URL.Query().Get("cached_username"); got != "serlog" {
				t.Fatalf("rows_page cached_username = %q, want serlog", got)
			}
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"columns": []string{"id", "header", "cached_username"},
				"data": []map[string]interface{}{
					{"id": 166, "header": "Serlog.com -palvelukatalogi", "cached_username": "serlog"},
				},
				"types":     map[string]interface{}{"header": "text", "cached_username": "text"},
				"row_count": 1,
			})
		},
		"text_search": func(w http.ResponseWriter, r *http.Request) {
			if got := r.URL.Query().Get("dataset"); got != "dev_agent_tasks" {
				t.Fatalf("text_search dataset = %q, want dev_agent_tasks", got)
			}
			if got := r.URL.Query().Get("query"); got != "serlog palvelukatalogi" {
				t.Fatalf("text_search query = %q, want serlog palvelukatalogi", got)
			}
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"columns": []string{"id", "title"},
				"data": []map[string]interface{}{
					{"id": 42, "title": "Korjaa Serlog-palvelukatalogin haku"},
				},
				"types":     map[string]interface{}{"title": "text"},
				"row_count": 1,
			})
		},
	}

	req := httptest.NewRequest(http.MethodPost, "/api/app/ai-chat/query", strings.NewReader(`{
		"dataset": "app_service_catalog",
		"query": "Vertaa serlog-palvelua ja siihen liittyviä tehtäviä"
	}`))
	rec := httptest.NewRecorder()

	FilterbarAIQueryHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("FilterbarAIQueryHandler status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	var response filterbarAIQueryResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("response JSON unmarshal error = %v", err)
	}
	if response.Plan.Dataset != "app_service_catalog" || response.Plan.Mode != "rows_page" {
		t.Fatalf("response.Plan = %#v, want current dataset rows_page plan", response.Plan)
	}
	if len(response.Plans) != 2 {
		t.Fatalf("len(response.Plans) = %d, want 2", len(response.Plans))
	}
	if len(response.Results) != 2 {
		t.Fatalf("len(response.Results) = %d, want 2", len(response.Results))
	}
	if response.Results[1].Dataset != "dev_agent_tasks" {
		t.Fatalf("response.Results[1].Dataset = %q, want dev_agent_tasks", response.Results[1].Dataset)
	}
	if response.Memory == nil || !strings.Contains(response.Memory.Content, "dev_agent_tasks") {
		t.Fatalf("response.Memory = %#v, want related dataset memory", response.Memory)
	}
	if response.Answer != "Löysin yhden Serlog-palvelun ja yhden aiheeseen liittyvän tehtävän." {
		t.Fatalf("response.Answer = %q, want synthesized multi-dataset answer", response.Answer)
	}
}

func TestFilterbarAIQueryHandlerSkipsUnauthorizedPlannedDataset(t *testing.T) {
	originalPlannerFunc := filterbarAIPlannerFunc
	originalAnswererFunc := filterbarAIAnswererFunc
	originalColumnsReader := filterbarAIColumnsReader
	originalEmbeddingsReader := filterbarAIEmbeddingsReader
	originalDelegates := filterbarAIQueryDelegates
	originalAuthorizer := filterbarAIReadAuthorizer
	t.Cleanup(func() {
		filterbarAIPlannerFunc = originalPlannerFunc
		filterbarAIAnswererFunc = originalAnswererFunc
		filterbarAIColumnsReader = originalColumnsReader
		filterbarAIEmbeddingsReader = originalEmbeddingsReader
		filterbarAIQueryDelegates = originalDelegates
		filterbarAIReadAuthorizer = originalAuthorizer
	})

	filterbarAIColumnsReader = func(dataset string) ([]map[string]interface{}, error) {
		return []map[string]interface{}{
			{"column_name": "id"},
			{"column_name": "header"},
		}, nil
	}
	filterbarAIEmbeddingsReader = func(dataset string) (bool, error) {
		return true, nil
	}
	filterbarAIPlannerFunc = func(_ context.Context, payload filterbarAIQueryRequest, columns []map[string]interface{}, supportsEmbeddings bool) (filterbarAIPlannerResponse, error) {
		return filterbarAIPlannerResponse{
			Answer: "Haen kahdesta datasetistä.",
			Calls: []filterbarAIPlannedCall{
				{
					Dataset: "app_service_catalog",
					Plan: filterbarAIQueryPlan{
						Dataset: "app_service_catalog",
						Mode:    "rows_page",
					},
				},
				{
					Dataset: "dev_agent_tasks",
					Plan: filterbarAIQueryPlan{
						Dataset:     "dev_agent_tasks",
						Mode:        "text_search",
						SearchQuery: "serlog",
					},
				},
			},
		}, nil
	}

	filterbarAIReadAuthorizer = func(_ *http.Request, canonicalPath, dataset string) error {
		if dataset == "dev_agent_tasks" {
			return fmt.Errorf("%w: denied test dataset", errFilterbarAIForbidden)
		}
		return nil
	}

	filterbarAIAnswererFunc = func(_ context.Context, payload filterbarAIQueryRequest, plannerResponse filterbarAIPlannerResponse, resultContext filterbarAIResultContext) (filterbarAIAnswerResponse, error) {
		if len(resultContext.Related) != 1 {
			t.Fatalf("related contexts = %#v, want one denied related context", resultContext.Related)
		}
		if resultContext.Related[0].Dataset != "dev_agent_tasks" || resultContext.Related[0].Level != "error" {
			t.Fatalf("related context = %#v, want dev_agent_tasks error", resultContext.Related[0])
		}
		if !strings.Contains(resultContext.Related[0].Error, "forbidden") {
			t.Fatalf("related error = %q, want forbidden", resultContext.Related[0].Error)
		}
		return filterbarAIAnswerResponse{Answer: "Osaan vastata vain sallituista tuloksista."}, nil
	}

	textSearchCalled := false
	filterbarAIQueryDelegates = map[string]http.HandlerFunc{
		"rows_page": func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"columns": []string{"id", "header"},
				"data": []map[string]interface{}{
					{"id": 166, "header": "Serlog.com -palvelukatalogi"},
				},
				"types":     map[string]interface{}{"header": "text"},
				"row_count": 1,
			})
		},
		"text_search": func(w http.ResponseWriter, r *http.Request) {
			textSearchCalled = true
			t.Fatal("text_search delegate should not run for unauthorized planned dataset")
		},
	}

	req := httptest.NewRequest(http.MethodPost, "/api/app/ai-chat/query", strings.NewReader(`{
		"dataset": "app_service_catalog",
		"query": "Vertaa palvelukatalogia ja tehtäviä"
	}`))
	rec := httptest.NewRecorder()

	FilterbarAIQueryHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("FilterbarAIQueryHandler status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if textSearchCalled {
		t.Fatalf("unauthorized text_search delegate was called")
	}

	var response filterbarAIQueryResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("response JSON unmarshal error = %v", err)
	}
	if len(response.Results) != 1 {
		t.Fatalf("len(response.Results) = %d, want only authorized result", len(response.Results))
	}
	if response.Results[0].Dataset != "app_service_catalog" {
		t.Fatalf("response.Results[0].Dataset = %q, want app_service_catalog", response.Results[0].Dataset)
	}
	if response.Answer != "Osaan vastata vain sallituista tuloksista." {
		t.Fatalf("response.Answer = %q, want cautious answer", response.Answer)
	}
}

func TestFilterbarAIQueryHandlerMapsPlannerFieldFilterToRowsPage(t *testing.T) {
	originalPlannerFunc := filterbarAIPlannerFunc
	originalAnswererFunc := filterbarAIAnswererFunc
	originalColumnsReader := filterbarAIColumnsReader
	originalEmbeddingsReader := filterbarAIEmbeddingsReader
	originalDelegates := filterbarAIQueryDelegates
	allowFilterbarAIReadAuthorization(t)
	t.Cleanup(func() {
		filterbarAIPlannerFunc = originalPlannerFunc
		filterbarAIAnswererFunc = originalAnswererFunc
		filterbarAIColumnsReader = originalColumnsReader
		filterbarAIEmbeddingsReader = originalEmbeddingsReader
		filterbarAIQueryDelegates = originalDelegates
	})

	filterbarAIColumnsReader = func(dataset string) ([]map[string]interface{}, error) {
		return []map[string]interface{}{
			{"column_name": "id"},
			{"column_name": "header"},
			{"column_name": "user_id"},
			{"column_name": "cached_username"},
		}, nil
	}
	filterbarAIEmbeddingsReader = func(dataset string) (bool, error) {
		return true, nil
	}
	filterbarAIPlannerFunc = func(_ context.Context, payload filterbarAIQueryRequest, columns []map[string]interface{}, supportsEmbeddings bool) (filterbarAIPlannerResponse, error) {
		plannerPayload := filterbarAILLMPlannerPayload{
			Mode:        "text_search",
			Answer:      "Haen serlog-käyttäjän palvelut.",
			SearchQuery: "cached_username:serlog",
		}
		response, err := validateFilterbarAIPlannerPayload(plannerPayload, extractFilterbarAIColumnNames(columns))
		rowCount := 25
		response.RowCount = &rowCount
		return response, err
	}
	filterbarAIAnswererFunc = func(_ context.Context, payload filterbarAIQueryRequest, plannerResponse filterbarAIPlannerResponse, resultContext filterbarAIResultContext) (filterbarAIAnswerResponse, error) {
		if plannerResponse.Plan.Mode != "rows_page" {
			t.Fatalf("answer plan mode = %q, want rows_page", plannerResponse.Plan.Mode)
		}
		if got := resultContext.Filters["cached_username"]; got != "serlog" {
			t.Fatalf("resultContext cached_username filter = %q, want serlog", got)
		}
		return filterbarAIAnswerResponse{Answer: "Löysin Serlog.com-palvelukatalogin serlog-käyttäjälle."}, nil
	}

	filterbarAIQueryDelegates = map[string]http.HandlerFunc{
		"rows_page": func(w http.ResponseWriter, r *http.Request) {
			if got := r.URL.Query().Get("dataset"); got != "app_service_catalog" {
				t.Fatalf("delegate dataset = %q, want app_service_catalog", got)
			}
			if got := r.URL.Query().Get("cached_username"); got != "serlog" {
				t.Fatalf("delegate cached_username filter = %q, want serlog", got)
			}
			if got := r.URL.Query().Get("row_count"); got != "" {
				t.Fatalf("delegate row_count = %q, want empty so get-results computes the real total", got)
			}
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"columns": []string{"id", "header", "user_id", "cached_username"},
				"data": []map[string]interface{}{
					{"id": 99, "header": "Serlog.com -palvelukatalogi", "user_id": 40821, "cached_username": "serlog"},
				},
				"types":     map[string]interface{}{"header": "text", "cached_username": "text"},
				"row_count": 1,
			})
		},
		"text_search": func(w http.ResponseWriter, r *http.Request) {
			t.Fatal("text_search delegate should not run for exact field filters")
		},
	}

	req := httptest.NewRequest(http.MethodPost, "/api/app/ai-chat/query", strings.NewReader(`{
		"dataset": "app_service_catalog",
		"query": "cached_username:serlog"
	}`))
	rec := httptest.NewRecorder()

	FilterbarAIQueryHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("FilterbarAIQueryHandler status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	var response filterbarAIQueryResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("response JSON unmarshal error = %v", err)
	}
	if response.Plan.CanonicalPath != "/api/get-results" {
		t.Fatalf("response.Plan.CanonicalPath = %q, want /api/get-results", response.Plan.CanonicalPath)
	}
	if response.Plan.Mode != "rows_page" {
		t.Fatalf("response.Plan.Mode = %q, want rows_page", response.Plan.Mode)
	}
	if got := response.Plan.Filters["cached_username"]; got != "serlog" {
		t.Fatalf("response.Plan.Filters[cached_username] = %q, want serlog", got)
	}
	if response.Plan.SearchQuery != "" {
		t.Fatalf("response.Plan.SearchQuery = %q, want empty for rows_page filter", response.Plan.SearchQuery)
	}
	if response.Answer != "Löysin Serlog.com-palvelukatalogin serlog-käyttäjälle." {
		t.Fatalf("response.Answer = %q, want field-filter answer", response.Answer)
	}
	if response.Memory == nil || !strings.Contains(response.Memory.Content, `"cached_username":"serlog"`) {
		t.Fatalf("response.Memory = %#v, want cached_username filter memory", response.Memory)
	}
}

func TestBuildFilterbarAIPlannerSystemPromptIncludesNaturalOwnerGuidance(t *testing.T) {
	prompt := buildFilterbarAIPlannerSystemPrompt(
		"app_service_catalog",
		[]string{"id", "header", "cached_username", "user_id"},
		true,
	)

	if !strings.Contains(prompt, "serlog-käyttäjän omistama palvelu") {
		t.Fatalf("prompt missing Finnish natural owner example: %s", prompt)
	}
	if !strings.Contains(prompt, `"filters":{"cached_username":"serlog"}`) {
		t.Fatalf("prompt missing cached_username filter target example: %s", prompt)
	}
	if !strings.Contains(prompt, "user_id") || !strings.Contains(prompt, "numeric id") {
		t.Fatalf("prompt missing numeric user_id guardrail: %s", prompt)
	}
}

func TestBuildFilterbarAIPlannerSystemPromptAllowsMultiDatasetCalls(t *testing.T) {
	prompt := buildFilterbarAIPlannerSystemPromptForWorkspace(
		"app_service_catalog",
		[]filterbarAIDatasetCapability{
			{Dataset: "app_service_catalog", Columns: []string{"id", "header"}},
			{Dataset: "dev_agent_tasks", Columns: []string{"id", "title", "status"}},
		},
	)

	if !strings.Contains(prompt, "multiple calls") {
		t.Fatalf("prompt missing multi-call guidance: %s", prompt)
	}
	if !strings.Contains(prompt, "dev_agent_tasks") {
		t.Fatalf("prompt missing alternate dataset capability: %s", prompt)
	}
	if !strings.Contains(prompt, "Available dataset capabilities JSON") {
		t.Fatalf("prompt missing dataset capability JSON section: %s", prompt)
	}
}

func TestValidateFilterbarAIPlannerPayloadForDatasetsAcceptsMultiDatasetCalls(t *testing.T) {
	plannerPayload := filterbarAILLMPlannerPayload{
		Answer: "Haen kahdesta datasetistä.",
		Calls: []filterbarAILLMPlannerCall{
			{
				Dataset: "app_service_catalog",
				Mode:    "rows_page",
				Filters: map[string]string{"cached_username": "serlog"},
			},
			{
				Dataset:     "dev_agent_tasks",
				Mode:        "text_search",
				SearchQuery: "serlog palvelukatalogi",
			},
		},
	}
	capabilities := []filterbarAIDatasetCapability{
		{Dataset: "app_service_catalog", Columns: []string{"id", "header", "cached_username"}},
		{Dataset: "dev_agent_tasks", Columns: []string{"id", "title", "status"}},
	}

	response, err := validateFilterbarAIPlannerPayloadForDatasets(plannerPayload, "app_service_catalog", capabilities)
	if err != nil {
		t.Fatalf("validateFilterbarAIPlannerPayloadForDatasets error = %v", err)
	}
	if len(response.Calls) != 2 {
		t.Fatalf("len(response.Calls) = %d, want 2", len(response.Calls))
	}
	if response.Calls[0].Dataset != "app_service_catalog" {
		t.Fatalf("response.Calls[0].Dataset = %q, want app_service_catalog", response.Calls[0].Dataset)
	}
	if response.Calls[1].Dataset != "dev_agent_tasks" {
		t.Fatalf("response.Calls[1].Dataset = %q, want dev_agent_tasks", response.Calls[1].Dataset)
	}
	if response.Plan.Dataset != "app_service_catalog" || response.Plan.Mode != "rows_page" {
		t.Fatalf("response.Plan = %#v, want current dataset primary rows_page plan", response.Plan)
	}
}

func TestValidateFilterbarAIPlannerPayloadNormalizesOwnerAliasToCachedUsername(t *testing.T) {
	columns := []map[string]interface{}{
		{"column_name": "id"},
		{"column_name": "header"},
		{"column_name": "cached_username"},
		{"column_name": "user_id"},
	}
	plannerPayload := filterbarAILLMPlannerPayload{
		Mode:   "rows_page",
		Answer: "Haen serlog-käyttäjän palvelut.",
		Filters: map[string]string{
			"owner": "serlog",
		},
	}

	response, err := validateFilterbarAIPlannerPayload(plannerPayload, extractFilterbarAIColumnNames(columns))
	if err != nil {
		t.Fatalf("validateFilterbarAIPlannerPayload(owner alias) error = %v", err)
	}
	if response.Plan.Mode != "rows_page" {
		t.Fatalf("response.Plan.Mode = %q, want rows_page", response.Plan.Mode)
	}
	if got := response.Plan.Filters["cached_username"]; got != "serlog" {
		t.Fatalf("response.Plan.Filters[cached_username] = %q, want serlog", got)
	}
	if _, exists := response.Plan.Filters["owner"]; exists {
		t.Fatalf("response.Plan.Filters contains raw owner alias: %#v", response.Plan.Filters)
	}
}

func TestValidateFilterbarAIPlannerPayloadAcceptsRangeFilters(t *testing.T) {
	columns := []map[string]interface{}{
		{"column_name": "id"},
		{"column_name": "header"},
		{"column_name": "created"},
		{"column_name": "updated"},
	}
	plannerPayload := filterbarAILLMPlannerPayload{
		Mode:   "rows_page",
		Answer: "Haen aikarajatulla haulla.",
		Filters: map[string]string{
			"created_from": "2026-05-01",
			"created_to":   "2026-05-06",
			"id_from":      "100",
			"id_to":        "200",
			"updated_to":   "2026-05-06T23:59:59",
		},
	}

	response, err := validateFilterbarAIPlannerPayload(plannerPayload, extractFilterbarAIColumnNames(columns))
	if err != nil {
		t.Fatalf("validateFilterbarAIPlannerPayload(range filters) error = %v", err)
	}
	for key, want := range plannerPayload.Filters {
		if got := response.Plan.Filters[key]; got != want {
			t.Fatalf("response.Plan.Filters[%s] = %q, want %q", key, got, want)
		}
	}
}

func TestExtractFilterbarAIColumnFiltersHandlesMarkdownTokens(t *testing.T) {
	columnSet := map[string]struct{}{
		"cached_username": {},
		"user_id":         {},
	}

	filters, remaining := extractFilterbarAIColumnFilters("koita `cached_username:serlog`, kiitos", columnSet)

	if got := filters["cached_username"]; got != "serlog" {
		t.Fatalf("filters[cached_username] = %q, want serlog", got)
	}
	if remaining != "koita kiitos" {
		t.Fatalf("remaining = %q, want compact non-filter terms", remaining)
	}
}

func TestFilterbarAIQueryHandlerReturnsSortPlanWithoutDelegateRows(t *testing.T) {
	originalPlannerFunc := filterbarAIPlannerFunc
	originalColumnsReader := filterbarAIColumnsReader
	originalEmbeddingsReader := filterbarAIEmbeddingsReader
	originalDelegates := filterbarAIQueryDelegates
	allowFilterbarAIReadAuthorization(t)
	t.Cleanup(func() {
		filterbarAIPlannerFunc = originalPlannerFunc
		filterbarAIColumnsReader = originalColumnsReader
		filterbarAIEmbeddingsReader = originalEmbeddingsReader
		filterbarAIQueryDelegates = originalDelegates
	})

	filterbarAIColumnsReader = func(dataset string) ([]map[string]interface{}, error) {
		return []map[string]interface{}{
			{"column_name": "created_at"},
			{"column_name": "id"},
		}, nil
	}
	filterbarAIEmbeddingsReader = func(dataset string) (bool, error) {
		return true, nil
	}
	filterbarAIPlannerFunc = func(_ context.Context, payload filterbarAIQueryRequest, columns []map[string]interface{}, supportsEmbeddings bool) (filterbarAIPlannerResponse, error) {
		_ = payload
		_ = columns
		_ = supportsEmbeddings
		return filterbarAIPlannerResponse{
			Answer: "Järjestän tulokset vanhimmasta uusimpaan.",
			Plan: filterbarAIQueryPlan{
				Mode:        "rows_page",
				UsesSQL:     false,
				SortColumn:  "created_at",
				SortOrder:   "ASC",
				ApplyAsSort: true,
			},
		}, nil
	}

	filterbarAIQueryDelegates = map[string]http.HandlerFunc{
		"rows_page": func(w http.ResponseWriter, r *http.Request) {
			t.Fatal("rows_page delegate should not run when AI planner requests apply_as_sort")
		},
	}

	req := httptest.NewRequest(http.MethodPost, "/api/app/ai-chat/query", strings.NewReader(`{
		"dataset": "app_service_catalog",
		"query": "show results from oldest"
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
	if response.Answer != "Järjestän tulokset vanhimmasta uusimpaan." {
		t.Fatalf("response.Answer = %q, want LLM sort answer", response.Answer)
	}
	if !response.Plan.ApplyAsSort {
		t.Fatal("response.Plan.ApplyAsSort = false, want true")
	}
	if response.Plan.SortColumn != "created_at" {
		t.Fatalf("response.Plan.SortColumn = %q, want created_at", response.Plan.SortColumn)
	}
	if response.Plan.SortOrder != "ASC" {
		t.Fatalf("response.Plan.SortOrder = %q, want ASC", response.Plan.SortOrder)
	}
	if len(response.Result) != 0 {
		t.Fatalf("len(response.Result) = %d, want 0 for pure sort plan", len(response.Result))
	}
}

func TestFilterbarAICodexQueryHandlerRequiresDevMode(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "prod")

	req := httptest.NewRequest(http.MethodPost, "/api/app/ai-chat/codex-query", strings.NewReader(`{
		"dataset": "app_service_catalog",
		"query": "diagnose this"
	}`))
	rec := httptest.NewRecorder()

	FilterbarAICodexQueryHandler(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("FilterbarAICodexQueryHandler status = %d, want 404 outside dev", rec.Code)
	}
}

func TestFilterbarAICodexQueryHandlerCallsRunnerWithConversation(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	originalRunner := filterbarAICodexRunner
	originalColumnsReader := filterbarAIColumnsReader
	t.Cleanup(func() {
		filterbarAICodexRunner = originalRunner
		filterbarAIColumnsReader = originalColumnsReader
	})

	filterbarAIColumnsReader = func(dataset string) ([]map[string]interface{}, error) {
		return nil, errors.New("metadata unavailable in this prompt-only test")
	}
	filterbarAICodexRunner = func(_ context.Context, prompt string) (string, error) {
		if !strings.Contains(prompt, "Dataset: app_service_catalog") {
			t.Fatalf("prompt missing dataset: %s", prompt)
		}
		if !strings.Contains(prompt, "serlog-kayttaja") {
			t.Fatalf("prompt missing current query: %s", prompt)
		}
		if !strings.Contains(prompt, filterbarAIResultMemoryMarker) {
			t.Fatalf("prompt missing hidden result memory marker: %s", prompt)
		}
		if !strings.Contains(prompt, "the app server is up from the browser's point of view") {
			t.Fatalf("prompt missing runtime fact about the current backend request: %s", prompt)
		}
		if !strings.Contains(prompt, "Codex runtime/environment limitation") {
			t.Fatalf("prompt missing runtime limitation guidance: %s", prompt)
		}
		if !strings.Contains(prompt, "filesystem write access") {
			t.Fatalf("prompt missing DEV filesystem write access guidance: %s", prompt)
		}
		if strings.Contains(prompt, "- Do not edit files.") {
			t.Fatalf("prompt still forbids file edits: %s", prompt)
		}
		return "Todennakoinen ongelma on kayttajanimen ja user_id:n valinen haku.", nil
	}

	req := httptest.NewRequest(http.MethodPost, "/api/app/ai-chat/codex-query", strings.NewReader(`{
		"dataset": "app_service_catalog",
		"query": "Koita hakea serlog-kayttaja",
		"lang": "fi",
		"messages": [
			{"role": "user", "content": "Hei"},
			{"role": "system", "content": "[easelect_result_context]\n{\"rows\":[{\"title\":\"Serlog.com\"}]}"}
		]
	}`))
	rec := httptest.NewRecorder()

	FilterbarAICodexQueryHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("FilterbarAICodexQueryHandler status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	var response filterbarAICodexQueryResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("response JSON unmarshal error = %v", err)
	}
	if response.Mode != filterbarAICodexProvider {
		t.Fatalf("response.Mode = %q, want %q", response.Mode, filterbarAICodexProvider)
	}
	if !response.DevOnly {
		t.Fatal("response.DevOnly = false, want true")
	}
	if !strings.Contains(response.Answer, "user_id") {
		t.Fatalf("response.Answer = %q, want runner answer", response.Answer)
	}
}

func TestBuildFilterbarAICodexExecArgsUsesDevFullAccessSandbox(t *testing.T) {
	args := buildFilterbarAICodexExecArgs([]string{"@openai/codex"}, "/repo", "/tmp/out.txt")
	joined := strings.Join(args, " ")

	if !strings.Contains(joined, "exec --sandbox "+filterbarAICodexSandboxMode) {
		t.Fatalf("args = %#v, want Codex exec with %s sandbox", args, filterbarAICodexSandboxMode)
	}
	if strings.Contains(joined, "--sandbox read-only") {
		t.Fatalf("args = %#v, still use read-only mode", args)
	}
	if !strings.Contains(joined, `approval_policy="never"`) {
		t.Fatalf("args = %#v, want non-interactive approval policy", args)
	}
	if !strings.Contains(joined, "--cd /repo") || !strings.Contains(joined, "--output-last-message /tmp/out.txt") {
		t.Fatalf("args = %#v, want working dir and output file wiring", args)
	}
}

func TestFilterbarAICodexQueryHandlerIncludesBackendFilterProbe(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	originalRunner := filterbarAICodexRunner
	originalColumnsReader := filterbarAIColumnsReader
	originalFilterableColumnsReader := filterbarAIFilterableColumnsReader
	originalEmbeddingsReader := filterbarAIEmbeddingsReader
	originalDelegates := filterbarAIQueryDelegates
	t.Cleanup(func() {
		filterbarAICodexRunner = originalRunner
		filterbarAIColumnsReader = originalColumnsReader
		filterbarAIFilterableColumnsReader = originalFilterableColumnsReader
		filterbarAIEmbeddingsReader = originalEmbeddingsReader
		filterbarAIQueryDelegates = originalDelegates
	})

	filterbarAIColumnsReader = func(dataset string) ([]map[string]interface{}, error) {
		if dataset != "app_service_catalog" {
			t.Fatalf("columns dataset = %q, want app_service_catalog", dataset)
		}
		return []map[string]interface{}{
			{"column_name": "id"},
			{"column_name": "header"},
			{"column_name": "user_id"},
			{"column_name": "cached_username"},
		}, nil
	}
	filterbarAIEmbeddingsReader = func(dataset string) (bool, error) {
		return true, nil
	}
	filterbarAIQueryDelegates = map[string]http.HandlerFunc{
		"rows_page": func(w http.ResponseWriter, r *http.Request) {
			if got := r.URL.Query().Get("cached_username"); got != "serlog" {
				t.Fatalf("delegate cached_username filter = %q, want serlog", got)
			}
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"columns": []string{"id", "header", "user_id", "cached_username"},
				"data": []map[string]interface{}{
					{"id": 166, "header": "Serlog.com -palvelukatalogi", "user_id": 40821, "cached_username": "serlog"},
				},
				"row_count": 1,
			})
		},
	}
	filterbarAICodexRunner = func(_ context.Context, prompt string) (string, error) {
		if !strings.Contains(prompt, "Backend-collected runtime diagnostics JSON") {
			t.Fatalf("prompt missing backend diagnostics: %s", prompt)
		}
		if !strings.Contains(prompt, `"canonical_url": "/api/get-results?cached_username=serlog`) {
			t.Fatalf("prompt missing canonical get-results probe: %s", prompt)
		}
		if !strings.Contains(prompt, `"rows_returned": 1`) {
			t.Fatalf("prompt missing probe row count: %s", prompt)
		}
		if !strings.Contains(prompt, "Serlog.com -palvelukatalogi") {
			t.Fatalf("prompt missing probed Serlog row: %s", prompt)
		}
		return "Backend-probe vahvistaa, että canonical get-results palauttaa Serlog-rivin.", nil
	}

	req := httptest.NewRequest(http.MethodPost, "/api/app/ai-chat/codex-query", strings.NewReader(`{
		"dataset": "app_service_catalog",
		"query": "Koita uudelleen \u0060cached_username:serlog\u0060"
	}`))
	rec := httptest.NewRecorder()

	FilterbarAICodexQueryHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("FilterbarAICodexQueryHandler status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	var response filterbarAICodexQueryResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("response JSON unmarshal error = %v", err)
	}
	if response.Plan == nil {
		t.Fatal("response.Plan = nil, want canonical probe plan")
	}
	if got := response.Plan.Filters["cached_username"]; got != "serlog" {
		t.Fatalf("response.Plan.Filters[cached_username] = %q, want serlog", got)
	}
	if response.Result == nil || countFilterbarAIResultRows(response.Result) != 1 {
		t.Fatalf("response.Result = %#v, want one probed row", response.Result)
	}
	if response.Memory == nil || !strings.Contains(response.Memory.Content, "Serlog.com -palvelukatalogi") {
		t.Fatalf("response.Memory = %#v, want probed Serlog result memory", response.Memory)
	}
	if response.Diagnostics == nil || !response.Diagnostics.DeterministicFilterProbeUsed {
		t.Fatalf("response.Diagnostics = %#v, want deterministic probe signal", response.Diagnostics)
	}
}

func TestFilterbarAICodexQueryHandlerFallsBackToFilterableColumns(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	originalRunner := filterbarAICodexRunner
	originalColumnsReader := filterbarAIColumnsReader
	originalFilterableColumnsReader := filterbarAIFilterableColumnsReader
	originalDelegates := filterbarAIQueryDelegates
	t.Cleanup(func() {
		filterbarAICodexRunner = originalRunner
		filterbarAIColumnsReader = originalColumnsReader
		filterbarAIFilterableColumnsReader = originalFilterableColumnsReader
		filterbarAIQueryDelegates = originalDelegates
	})

	filterbarAIColumnsReader = func(dataset string) ([]map[string]interface{}, error) {
		return []map[string]interface{}{
			{"column_name": "id"},
			{"column_name": "header"},
		}, nil
	}
	filterbarAIFilterableColumnsReader = func(dataset string) ([]string, error) {
		return []string{"id", "header", "user_id", "cached_username"}, nil
	}
	filterbarAIQueryDelegates = map[string]http.HandlerFunc{
		"rows_page": func(w http.ResponseWriter, r *http.Request) {
			if got := r.URL.Query().Get("cached_username"); got != "serlog" {
				t.Fatalf("delegate cached_username filter = %q, want serlog", got)
			}
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"columns": []string{"id", "header", "user_id", "cached_username"},
				"data": []map[string]interface{}{
					{"id": 166, "header": "Serlog.com -palvelukatalogi", "user_id": 40821, "cached_username": "serlog"},
				},
				"row_count": 1,
			})
		},
	}
	filterbarAICodexRunner = func(_ context.Context, prompt string) (string, error) {
		if !strings.Contains(prompt, `"cached_username": "serlog"`) {
			t.Fatalf("prompt missing fallback-filtered cached_username evidence: %s", prompt)
		}
		return "Fallback filterable columns found the Serlog service.", nil
	}

	req := httptest.NewRequest(http.MethodPost, "/api/app/ai-chat/codex-query", strings.NewReader(`{
		"dataset": "app_service_catalog",
		"query": "cached_username:serlog"
	}`))
	rec := httptest.NewRecorder()

	FilterbarAICodexQueryHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("FilterbarAICodexQueryHandler status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
}

func TestFilterbarAICodexQueryHandlerAllowsOwnerHiddenFilterFallback(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	originalRunner := filterbarAICodexRunner
	originalColumnsReader := filterbarAIColumnsReader
	originalFilterableColumnsReader := filterbarAIFilterableColumnsReader
	originalDelegates := filterbarAIQueryDelegates
	t.Cleanup(func() {
		filterbarAICodexRunner = originalRunner
		filterbarAIColumnsReader = originalColumnsReader
		filterbarAIFilterableColumnsReader = originalFilterableColumnsReader
		filterbarAIQueryDelegates = originalDelegates
	})

	filterbarAIColumnsReader = func(dataset string) ([]map[string]interface{}, error) {
		return []map[string]interface{}{
			{"column_name": "id"},
			{"column_name": "header"},
		}, nil
	}
	filterbarAIFilterableColumnsReader = func(dataset string) ([]string, error) {
		return []string{"id", "header"}, nil
	}
	filterbarAIQueryDelegates = map[string]http.HandlerFunc{
		"rows_page": func(w http.ResponseWriter, r *http.Request) {
			if got := r.URL.Query().Get("cached_username"); got != "serlog" {
				t.Fatalf("delegate cached_username filter = %q, want serlog", got)
			}
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"columns": []string{"id", "header", "cached_username"},
				"data": []map[string]interface{}{
					{"id": 166, "header": "Serlog.com -palvelukatalogi", "cached_username": "serlog"},
				},
				"row_count": 1,
			})
		},
	}
	filterbarAICodexRunner = func(_ context.Context, prompt string) (string, error) {
		if strings.Contains(prompt, "field:value text was present") {
			t.Fatalf("prompt should not contain skipped field:value probe: %s", prompt)
		}
		return "Hidden owner filter probe found Serlog.", nil
	}

	req := httptest.NewRequest(http.MethodPost, "/api/app/ai-chat/codex-query", strings.NewReader(`{
		"dataset": "app_service_catalog",
		"query": "cached_username:serlog"
	}`))
	rec := httptest.NewRecorder()

	FilterbarAICodexQueryHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("FilterbarAICodexQueryHandler status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	var response filterbarAICodexQueryResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("response JSON unmarshal error = %v", err)
	}
	if response.Plan == nil || response.Plan.Filters["cached_username"] != "serlog" {
		t.Fatalf("response.Plan = %#v, want hidden cached_username filter", response.Plan)
	}
	if response.Result == nil || countFilterbarAIResultRows(response.Result) != 1 {
		t.Fatalf("response.Result = %#v, want one hidden-filtered row", response.Result)
	}
	if response.Memory == nil || !strings.Contains(response.Memory.Content, `"cached_username":"serlog"`) {
		t.Fatalf("response.Memory = %#v, want hidden filter result memory", response.Memory)
	}
}

func TestFilterbarAICodexQueryHandlerLetsCodexPlanCanonicalFilters(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	originalRunner := filterbarAICodexRunner
	originalColumnsReader := filterbarAIColumnsReader
	originalFilterableColumnsReader := filterbarAIFilterableColumnsReader
	originalDelegates := filterbarAIQueryDelegates
	t.Cleanup(func() {
		filterbarAICodexRunner = originalRunner
		filterbarAIColumnsReader = originalColumnsReader
		filterbarAIFilterableColumnsReader = originalFilterableColumnsReader
		filterbarAIQueryDelegates = originalDelegates
	})

	filterbarAIColumnsReader = func(dataset string) ([]map[string]interface{}, error) {
		return []map[string]interface{}{
			{"column_name": "id"},
			{"column_name": "header"},
		}, nil
	}
	filterbarAIFilterableColumnsReader = func(dataset string) ([]string, error) {
		return []string{"id", "header"}, nil
	}
	filterbarAIQueryDelegates = map[string]http.HandlerFunc{
		"rows_page": func(w http.ResponseWriter, r *http.Request) {
			if got := r.URL.Query().Get("cached_username"); got != "serlog" {
				t.Fatalf("delegate cached_username filter = %q, want serlog", got)
			}
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"columns": []string{"id", "header", "user_id", "cached_username"},
				"data": []map[string]interface{}{
					{"id": 166, "header": "Serlog.com -palvelukatalogi", "user_id": 40821, "cached_username": "serlog"},
				},
				"row_count": 1,
			})
		},
	}
	runnerCalls := 0
	filterbarAICodexRunner = func(_ context.Context, prompt string) (string, error) {
		runnerCalls++
		switch runnerCalls {
		case 1:
			if !strings.Contains(prompt, "Return one JSON object only") {
				t.Fatalf("planner prompt missing JSON-only instruction: %s", prompt)
			}
			if !strings.Contains(prompt, `"cached_username"`) {
				t.Fatalf("planner prompt missing available hidden owner column: %s", prompt)
			}
			if !strings.Contains(prompt, "Hae serlog-käyttäjän omistama palvelu") {
				t.Fatalf("planner prompt missing user request: %s", prompt)
			}
			return `{"mode":"rows_page","answer":"Haen serlog-käyttäjän palvelun.","filters":{"cached_username":"serlog"}}`, nil
		case 2:
			if !strings.Contains(prompt, `"source": "codex_api_plan"`) {
				t.Fatalf("final prompt missing Codex API plan source: %s", prompt)
			}
			if !strings.Contains(prompt, `"cached_username": "serlog"`) {
				t.Fatalf("final prompt missing planned cached_username evidence: %s", prompt)
			}
			if !strings.Contains(prompt, "Serlog.com -palvelukatalogi") {
				t.Fatalf("final prompt missing planned Serlog row: %s", prompt)
			}
			return "Loytyi Serlog-kayttajan palvelu canonical API -filtterilla.", nil
		default:
			t.Fatalf("unexpected Codex runner call %d", runnerCalls)
		}
		return "", nil
	}

	req := httptest.NewRequest(http.MethodPost, "/api/app/ai-chat/codex-query", strings.NewReader(`{
		"dataset": "app_service_catalog",
		"query": "Hae serlog-käyttäjän omistama palvelu"
	}`))
	rec := httptest.NewRecorder()

	FilterbarAICodexQueryHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("FilterbarAICodexQueryHandler status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if runnerCalls != 2 {
		t.Fatalf("Codex runner calls = %d, want planner and final answer calls", runnerCalls)
	}

	var response filterbarAICodexQueryResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("response JSON unmarshal error = %v", err)
	}
	if response.Plan == nil || response.Plan.Filters["cached_username"] != "serlog" {
		t.Fatalf("response.Plan = %#v, want Codex-planned cached_username filter", response.Plan)
	}
	if response.Result == nil || countFilterbarAIResultRows(response.Result) != 1 {
		t.Fatalf("response.Result = %#v, want one Codex-planned filtered row", response.Result)
	}
	if response.Memory == nil || !strings.Contains(response.Memory.Content, "Serlog.com -palvelukatalogi") {
		t.Fatalf("response.Memory = %#v, want Codex-planned result memory", response.Memory)
	}
	if response.Diagnostics == nil || response.Diagnostics.Source != "codex_api_plan" {
		t.Fatalf("response.Diagnostics = %#v, want codex_api_plan source", response.Diagnostics)
	}
}

func TestResolveFilterbarAICodexTimeoutAllowsLongDevRuns(t *testing.T) {
	t.Setenv("FILTERBAR_AI_CODEX_TIMEOUT_SECONDS", "")
	if got := resolveFilterbarAICodexTimeout(); got != 40*time.Minute {
		t.Fatalf("default Codex timeout = %s, want 40m0s", got)
	}

	t.Setenv("FILTERBAR_AI_CODEX_TIMEOUT_SECONDS", "2400")
	if got := resolveFilterbarAICodexTimeout(); got != 40*time.Minute {
		t.Fatalf("configured Codex timeout = %s, want 40m0s", got)
	}

	t.Setenv("FILTERBAR_AI_CODEX_TIMEOUT_SECONDS", "7200")
	if got := resolveFilterbarAICodexTimeout(); got != 40*time.Minute {
		t.Fatalf("clamped Codex timeout = %s, want 40m0s", got)
	}
}
