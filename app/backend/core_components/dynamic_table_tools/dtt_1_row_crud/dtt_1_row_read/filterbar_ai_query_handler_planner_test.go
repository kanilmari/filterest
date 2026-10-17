// filterbar_ai_query_handler_planner_test.go
// Verifies query-handler execution of AI plans, dataset permissions and sorting.
// Connects the filter-bar facade to stub planners, answerers and canonical delegates.
// Keeps planner execution behavior covered without database or provider access.

package dtt_1_row_read

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

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
