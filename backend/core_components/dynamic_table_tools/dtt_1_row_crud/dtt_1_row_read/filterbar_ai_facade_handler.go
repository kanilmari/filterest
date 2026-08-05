// filterbar_ai_facade_handler.go
// Exposes a narrow filter bar AI capability facade for dataset reads.
// Bridges AI-facing app routes and the canonical get-results / intelligent-results handlers.
// Exists to replace legacy SQL-first chat expansion with an API-first read surface.
package dtt_1_row_read

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sort"
	"strconv"
	"strings"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/dynamic_table_tools/dtt_2_column_crud"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/permissions"
)

type filterbarAICapabilitiesResponse struct {
	Dataset            string                        `json:"dataset"`
	Modes              []string                      `json:"modes"`
	CanonicalReadPaths map[string]string             `json:"canonical_read_paths"`
	Search             filterbarAISearchCapabilities `json:"search"`
	Columns            []map[string]interface{}      `json:"columns"`
	Notes              []string                      `json:"notes"`
}

type filterbarAISearchCapabilities struct {
	SupportsMultilingualEmbeddings bool `json:"supports_multilingual_embeddings"`
}

type filterbarAIQueryRequest struct {
	Dataset  string                      `json:"dataset"`
	Mode     string                      `json:"mode"`
	Query    string                      `json:"query,omitempty"`
	Lang     string                      `json:"lang,omitempty"`
	Messages []aiChatConversationMessage `json:"messages,omitempty"`
	Offset   int                         `json:"offset,omitempty"`
	RowCount *int                        `json:"row_count,omitempty"`
}

type filterbarAIQueryPlan struct {
	Dataset       string            `json:"dataset,omitempty"`
	Mode          string            `json:"mode"`
	CanonicalPath string            `json:"canonical_path"`
	UsesSQL       bool              `json:"uses_sql"`
	SearchQuery   string            `json:"search_query,omitempty"`
	Filters       map[string]string `json:"filters,omitempty"`
	SortColumn    string            `json:"sort_column,omitempty"`
	SortOrder     string            `json:"sort_order,omitempty"`
	ApplyAsSort   bool              `json:"apply_as_sort,omitempty"`
}

type filterbarAIQueryResponse struct {
	Dataset               string                            `json:"dataset"`
	Answer                string                            `json:"answer"`
	Plan                  filterbarAIQueryPlan              `json:"plan"`
	Plans                 []filterbarAIQueryPlan            `json:"plans,omitempty"`
	Result                map[string]interface{}            `json:"result"`
	Results               []filterbarAIQueryResultItem      `json:"results,omitempty"`
	Memory                *aiChatConversationMessage        `json:"memory,omitempty"`
	Usage                 *filterbarAIUsageSummary          `json:"usage,omitempty"`
	ConfigurationRequired *filterbarAIConfigurationRequired `json:"configuration_required,omitempty"`
}

type filterbarAIConfigurationRequired struct {
	Code string `json:"code"`
}

type filterbarAIQueryResultItem struct {
	Dataset string                 `json:"dataset"`
	Plan    filterbarAIQueryPlan   `json:"plan"`
	Result  map[string]interface{} `json:"result,omitempty"`
}

type filterbarAIDelegateResponseError struct {
	Recorder *httptest.ResponseRecorder
}

func (err *filterbarAIDelegateResponseError) Error() string {
	if err == nil || err.Recorder == nil {
		return ""
	}
	return strings.TrimSpace(err.Recorder.Body.String())
}

var filterbarAIColumnsReader = dtt_2_column_crud.GetTableColumnsWithTypesAndIDs
var filterbarAIFilterableColumnsReader = readFilterbarAIFilterableColumnNames
var filterbarAIEmbeddingsReader = readFilterbarAIEmbeddingsCapability
var filterbarAIQueryDelegates = map[string]http.HandlerFunc{
	"rows_page":   GetResultsHandlerWrapper,
	"text_search": GetIntelligentResultsHandlerWrapper,
}
var filterbarAIPlannerFunc = planFilterbarAIQueryWithLLM
var filterbarAIAnswererFunc = answerFilterbarAIQueryWithLLM
var filterbarAIWorkspaceReader = readFilterbarAIWorkspaceCapabilities
var filterbarAIReadAuthorizer = authorizeFilterbarAIRead

const (
	filterbarAIWorkspaceMaxDatasets = 48
	filterbarAIWorkspaceMaxColumns  = 24
)

var errFilterbarAIForbidden = errors.New("forbidden")

// FilterbarAICapabilitiesHandler returns the first narrow AI-facing capability contract for one dataset.
func FilterbarAICapabilitiesHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only GET accepted")
		return
	}

	dataset := strings.TrimSpace(r.URL.Query().Get("dataset"))
	if dataset == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "missing 'dataset' query parameter")
		return
	}

	columns, err := filterbarAIColumnsReader(dataset)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpresponse.RespondWithError(w, http.StatusNotFound, "dataset not found")
			return
		}
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error fetching dataset columns")
		return
	}

	supportsEmbeddings, err := filterbarAIEmbeddingsReader(dataset)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpresponse.RespondWithError(w, http.StatusNotFound, "dataset not found")
			return
		}
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error fetching dataset AI capabilities")
		return
	}

	response := filterbarAICapabilitiesResponse{
		Dataset: dataset,
		Modes:   []string{"text_search", "rows_page"},
		CanonicalReadPaths: map[string]string{
			"rows_page":   "/api/get-results",
			"text_search": "/api/get-intelligent-results",
		},
		Search: filterbarAISearchCapabilities{
			SupportsMultilingualEmbeddings: supportsEmbeddings,
		},
		Columns: columns,
		Notes: []string{
			"API-first facade: this capability surface does not accept SQL.",
			"MCP tools should call this capability layer instead of bypassing it.",
		},
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error encoding capability response")
		return
	}
}

// FilterbarAIQueryHandler delegates narrow AI read intents to canonical dataset read handlers.
func FilterbarAIQueryHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only POST accepted")
		return
	}

	var payload filterbarAIQueryRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid JSON request body")
		return
	}

	payload.Dataset = strings.TrimSpace(payload.Dataset)
	if payload.Dataset == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "dataset is required")
		return
	}

	plannerResponse, result, results, memory, err := executeFilterbarAIQuery(r, payload)
	if err != nil {
		if errors.Is(err, errFilterbarAIOpenAIKeyMissing) {
			httpresponse.RespondWithJSON(w, http.StatusOK, filterbarAIQueryResponse{
				Dataset: payload.Dataset,
				Result:  map[string]interface{}{},
				ConfigurationRequired: &filterbarAIConfigurationRequired{
					Code: "openai_api_key_missing",
				},
			})
			return
		}
		var delegateErr *filterbarAIDelegateResponseError
		if errors.As(err, &delegateErr) {
			copyFilterbarAIErrorResponse(w, delegateErr.Recorder)
			return
		}

		statusCode := http.StatusInternalServerError
		if errors.Is(err, errFilterbarAIInvalidPlannerResult) {
			statusCode = http.StatusBadGateway
		} else if errors.Is(err, errFilterbarAIForbidden) {
			statusCode = http.StatusForbidden
		}
		httpresponse.RespondWithError(w, statusCode, err.Error())
		return
	}

	response := filterbarAIQueryResponse{
		Dataset: payload.Dataset,
		Answer:  plannerResponse.Answer,
		Plan:    plannerResponse.Plan,
		Plans:   extractFilterbarAIResponsePlans(plannerResponse.Calls),
		Result:  result,
		Results: results,
		Memory:  memory,
		Usage:   plannerResponse.Usage,
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error encoding query response")
		return
	}
}

func executeFilterbarAIQuery(r *http.Request, payload filterbarAIQueryRequest) (filterbarAIPlannerResponse, map[string]interface{}, []filterbarAIQueryResultItem, *aiChatConversationMessage, error) {
	if strings.TrimSpace(payload.Mode) == "" {
		return executeFilterbarAIPlannedQuery(r, payload)
	}
	return executeFilterbarAIExplicitQuery(r, payload)
}

func executeFilterbarAIExplicitQuery(r *http.Request, payload filterbarAIQueryRequest) (filterbarAIPlannerResponse, map[string]interface{}, []filterbarAIQueryResultItem, *aiChatConversationMessage, error) {
	delegateReq, canonicalPath, mode, err := buildFilterbarAIDelegateRequest(r, payload)
	if err != nil {
		return filterbarAIPlannerResponse{}, nil, nil, nil, err
	}
	if err := filterbarAIReadAuthorizer(r, canonicalPath, payload.Dataset); err != nil {
		return filterbarAIPlannerResponse{}, nil, nil, nil, err
	}

	result, err := executeFilterbarAIDelegate(mode, delegateReq)
	if err != nil {
		return filterbarAIPlannerResponse{}, nil, nil, nil, err
	}

	plannerResponse := filterbarAIPlannerResponse{
		Answer: buildFilterbarAIAnswer(mode, delegateReq.URL.Query(), result),
		Plan: filterbarAIQueryPlan{
			Dataset:       payload.Dataset,
			Mode:          mode,
			CanonicalPath: canonicalPath,
			UsesSQL:       false,
			SearchQuery:   strings.TrimSpace(delegateReq.URL.Query().Get("query")),
			Filters:       extractFilterbarAIPlanFiltersFromQuery(delegateReq.URL.Query()),
			SortColumn:    strings.TrimSpace(delegateReq.URL.Query().Get("sort_column")),
			SortOrder:     strings.ToUpper(strings.TrimSpace(delegateReq.URL.Query().Get("sort_order"))),
			ApplyAsSort:   false,
		},
	}
	resultContext := buildFilterbarAIResultContext(payload.Dataset, plannerResponse.Plan, result)
	return plannerResponse, result, nil, buildFilterbarAIResultMemory(resultContext), nil
}

func executeFilterbarAIPlannedQuery(r *http.Request, payload filterbarAIQueryRequest) (filterbarAIPlannerResponse, map[string]interface{}, []filterbarAIQueryResultItem, *aiChatConversationMessage, error) {
	columns, supportsEmbeddings, err := loadFilterbarAICapabilityInputs(payload.Dataset)
	if err != nil {
		return filterbarAIPlannerResponse{}, nil, nil, nil, err
	}

	plannerResponse, err := filterbarAIPlannerFunc(r.Context(), payload, columns, supportsEmbeddings)
	if err != nil {
		return filterbarAIPlannerResponse{}, nil, nil, nil, err
	}

	plannedCalls := normalizeFilterbarAIPlannerCalls(payload.Dataset, plannerResponse)
	if len(plannedCalls) == 0 {
		plannerResponse.Plan.CanonicalPath = ""
		plannerResponse.Plan.UsesSQL = false
		plannerResponse.Plan.Dataset = payload.Dataset
		plannerResponse.Plan.Mode = "answer_only"
		return plannerResponse, map[string]interface{}{}, nil, nil, nil
	}

	allowPartialResults := len(plannedCalls) > 1 || hasFilterbarAICrossDatasetCall(payload.Dataset, plannedCalls)
	results := make([]filterbarAIQueryResultItem, 0, len(plannedCalls))
	contexts := make([]filterbarAIResultContext, 0, len(plannedCalls))
	primaryResult := map[string]interface{}{}
	primaryPlan := filterbarAIQueryPlan{
		Dataset: payload.Dataset,
		Mode:    "answer_only",
		UsesSQL: false,
	}

	for _, plannedCall := range plannedCalls {
		queryPayload := filterbarAIQueryRequest{
			Dataset: plannedCall.Dataset,
			Query:   payload.Query,
			Lang:    payload.Lang,
		}
		callPlannerResponse := filterbarAIPlannerResponse{
			Answer:   plannerResponse.Answer,
			Plan:     plannedCall.Plan,
			Offset:   plannedCall.Offset,
			RowCount: plannedCall.RowCount,
		}
		delegateReq, canonicalPath, mode, err := buildFilterbarAIDelegateRequestFromPlanner(r, queryPayload, callPlannerResponse)
		if err != nil {
			return filterbarAIPlannerResponse{}, nil, nil, nil, err
		}
		plannedCall.Plan.Dataset = plannedCall.Dataset
		plannedCall.Plan.Mode = mode
		plannedCall.Plan.CanonicalPath = canonicalPath
		plannedCall.Plan.UsesSQL = false

		if plannedCall.Dataset == payload.Dataset && primaryPlan.Mode == "answer_only" {
			primaryPlan = plannedCall.Plan
		}

		if plannedCall.Plan.ApplyAsSort {
			if plannedCall.Dataset == payload.Dataset {
				primaryPlan = plannedCall.Plan
				if len(plannedCalls) > 1 {
					continue
				}
				plannerResponse.Plan = plannedCall.Plan
				plannerResponse.Calls = plannedCalls
				return plannerResponse, map[string]interface{}{}, nil, nil, nil
			}
			continue
		}

		if err := filterbarAIReadAuthorizer(r, canonicalPath, plannedCall.Dataset); err != nil {
			if !allowPartialResults {
				return filterbarAIPlannerResponse{}, nil, nil, nil, err
			}
			contexts = append(contexts, buildFilterbarAIErrorResultContext(plannedCall.Dataset, plannedCall.Plan, err))
			continue
		}

		result, err := executeFilterbarAIDelegate(mode, delegateReq)
		if err != nil {
			if !allowPartialResults {
				return filterbarAIPlannerResponse{}, nil, nil, nil, err
			}
			contexts = append(contexts, buildFilterbarAIErrorResultContext(plannedCall.Dataset, plannedCall.Plan, err))
			continue
		}

		results = append(results, filterbarAIQueryResultItem{
			Dataset: plannedCall.Dataset,
			Plan:    plannedCall.Plan,
			Result:  result,
		})
		contexts = append(contexts, buildFilterbarAIResultContext(plannedCall.Dataset, plannedCall.Plan, result))
		if plannedCall.Dataset == payload.Dataset {
			primaryResult = result
			primaryPlan = plannedCall.Plan
		}
	}

	plannerResponse.Plan = primaryPlan
	plannerResponse.Calls = plannedCalls
	resultContext := combineFilterbarAIResultContexts(payload.Dataset, contexts)
	if filterbarAIAnswererFunc != nil {
		answerResponse, answerErr := filterbarAIAnswererFunc(r.Context(), payload, plannerResponse, resultContext)
		if answerErr == nil {
			if strings.TrimSpace(answerResponse.Answer) != "" {
				plannerResponse.Answer = strings.TrimSpace(answerResponse.Answer)
			}
			plannerResponse.Usage = mergeFilterbarAIUsageSummaries(plannerResponse.Usage, answerResponse.Usage)
		}
	}

	return plannerResponse, primaryResult, results, buildFilterbarAIResultMemory(resultContext), nil
}

func authorizeFilterbarAIRead(r *http.Request, canonicalPath, dataset string) error {
	canonicalPath = strings.TrimSpace(canonicalPath)
	if canonicalPath == "" {
		return fmt.Errorf("%w: missing canonical read path", errFilterbarAIForbidden)
	}

	actor := dbutils.RequestActorContextFromRequest(r)
	if actor.UserID <= 0 {
		return fmt.Errorf("%w: missing request user", errFilterbarAIForbidden)
	}

	specificTableRelated, err := permissions.FunctionSpecificTableRelated(
		backend.Db,
		canonicalPath,
		permissions.DisabledFunctionStrictFalse,
	)
	if err != nil {
		return fmt.Errorf("check AI read permission route scope: %w", err)
	}

	scope := permissions.RouteTableScope{}
	if specificTableRelated {
		dataset = strings.TrimSpace(dataset)
		if dataset == "" {
			return fmt.Errorf("%w: missing dataset for %s", errFilterbarAIForbidden, canonicalPath)
		}
		scope.TableName = dataset
	}

	permissionCtx := permissions.NewPermissionContext(backend.Db, actor.UserID)
	allowed, err := permissionCtx.HasRouteTablePermission(canonicalPath, scope, permissions.StrictRouteTableOptions())
	if err != nil {
		return fmt.Errorf("check AI read permission: %w", err)
	}
	if !allowed {
		if scope.TableName != "" {
			return fmt.Errorf("%w: user %d cannot use %s for dataset %q", errFilterbarAIForbidden, actor.UserID, canonicalPath, scope.TableName)
		}
		return fmt.Errorf("%w: user %d cannot use %s", errFilterbarAIForbidden, actor.UserID, canonicalPath)
	}
	return nil
}

// normalizeFilterbarAIPlannerCalls turns legacy single-plan responses into bounded call lists.
// Between: planner output and canonical read delegate execution.
// Why: Preserves old single-dataset behavior while enabling multi-dataset API reads.
func normalizeFilterbarAIPlannerCalls(defaultDataset string, plannerResponse filterbarAIPlannerResponse) []filterbarAIPlannedCall {
	if len(plannerResponse.Calls) > 0 {
		normalizedCalls := make([]filterbarAIPlannedCall, 0, len(plannerResponse.Calls))
		for _, call := range plannerResponse.Calls {
			call.Dataset = strings.TrimSpace(call.Dataset)
			if call.Dataset == "" {
				call.Dataset = strings.TrimSpace(defaultDataset)
			}
			call.Plan.Dataset = call.Dataset
			call.Plan.UsesSQL = false
			if strings.TrimSpace(call.Plan.Mode) == "" {
				continue
			}
			if strings.EqualFold(call.Plan.Mode, "answer_only") {
				continue
			}
			normalizedCalls = append(normalizedCalls, call)
		}
		return normalizedCalls
	}

	mode := strings.ToLower(strings.TrimSpace(plannerResponse.Plan.Mode))
	if mode == "" || mode == "answer_only" {
		return nil
	}
	dataset := strings.TrimSpace(plannerResponse.Plan.Dataset)
	if dataset == "" {
		dataset = strings.TrimSpace(defaultDataset)
	}
	plan := plannerResponse.Plan
	plan.Dataset = dataset
	plan.UsesSQL = false
	return []filterbarAIPlannedCall{{
		Dataset:  dataset,
		Plan:     plan,
		Offset:   plannerResponse.Offset,
		RowCount: plannerResponse.RowCount,
	}}
}

// hasFilterbarAICrossDatasetCall reports whether a planned turn reaches beyond the visible dataset.
// Between: planner call lists and partial-result error handling.
// Why: Cross-dataset searches should degrade to an uncertain answer instead of failing the whole turn.
func hasFilterbarAICrossDatasetCall(defaultDataset string, calls []filterbarAIPlannedCall) bool {
	defaultDataset = strings.TrimSpace(defaultDataset)
	for _, call := range calls {
		if strings.TrimSpace(call.Dataset) != defaultDataset {
			return true
		}
	}
	return false
}

// extractFilterbarAIResponsePlans exposes multi-call plan details for API clients.
// Between: internal planned calls and the JSON response contract.
// Why: Keeps the primary plan backward-compatible while still surfacing extra reads.
func extractFilterbarAIResponsePlans(calls []filterbarAIPlannedCall) []filterbarAIQueryPlan {
	if len(calls) <= 1 {
		return nil
	}
	plans := make([]filterbarAIQueryPlan, 0, len(calls))
	for _, call := range calls {
		plans = append(plans, call.Plan)
	}
	return plans
}

func loadFilterbarAICapabilityInputs(dataset string) ([]map[string]interface{}, bool, error) {
	columns, err := filterbarAIColumnsReader(dataset)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, false, errors.New("dataset not found")
		}
		return nil, false, errors.New("error fetching dataset columns")
	}

	supportsEmbeddings, err := filterbarAIEmbeddingsReader(dataset)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, false, errors.New("dataset not found")
		}
		return nil, false, errors.New("error fetching dataset AI capabilities")
	}

	return columns, supportsEmbeddings, nil
}

func normalizeFilterbarAIQueryMode(payload filterbarAIQueryRequest) (string, error) {
	mode := strings.ToLower(strings.TrimSpace(payload.Mode))
	if mode == "" {
		return "", errors.New("mode is required when bypassing the AI planner")
	}

	switch mode {
	case "rows_page", "text_search":
		return mode, nil
	default:
		return "", errors.New("unsupported mode; expected 'text_search' or 'rows_page'")
	}
}

func buildFilterbarAIDelegateRequest(original *http.Request, payload filterbarAIQueryRequest) (*http.Request, string, string, error) {
	mode, err := normalizeFilterbarAIQueryMode(payload)
	if err != nil {
		return nil, "", "", err
	}

	queryParams := url.Values{}
	queryParams.Set("dataset", payload.Dataset)

	canonicalPath := "/api/get-results"
	switch mode {
	case "text_search":
		trimmedQuery := strings.TrimSpace(payload.Query)
		if trimmedQuery == "" {
			return nil, "", "", errors.New("query is required when mode is 'text_search'")
		}
		canonicalPath = "/api/get-intelligent-results"
		queryParams.Set("query", trimmedQuery)
		if lang := strings.TrimSpace(payload.Lang); lang != "" {
			queryParams.Set("lang", lang)
		}
	case "rows_page":
		if payload.Offset < 0 {
			return nil, "", "", errors.New("offset must be zero or positive")
		}
		queryParams.Set("offset", strconv.Itoa(payload.Offset))
	}

	delegateReq := original.Clone(original.Context())
	delegateReq.Method = http.MethodGet
	delegateReq.Body = http.NoBody

	delegateURL := *delegateReq.URL
	delegateURL.Path = canonicalPath
	delegateURL.RawQuery = queryParams.Encode()
	delegateReq.URL = &delegateURL
	delegateReq.RequestURI = canonicalPath
	if delegateURL.RawQuery != "" {
		delegateReq.RequestURI += "?" + delegateURL.RawQuery
	}

	return delegateReq, canonicalPath, mode, nil
}

func buildFilterbarAIDelegateRequestFromPlanner(original *http.Request, payload filterbarAIQueryRequest, plannerResponse filterbarAIPlannerResponse) (*http.Request, string, string, error) {
	mode := strings.ToLower(strings.TrimSpace(plannerResponse.Plan.Mode))
	if mode == "" {
		return nil, "", "", errors.New("AI planner did not return a mode")
	}

	queryParams := url.Values{}
	queryParams.Set("dataset", payload.Dataset)

	canonicalPath := "/api/get-results"
	switch mode {
	case "text_search":
		searchQuery := strings.TrimSpace(plannerResponse.Plan.SearchQuery)
		if searchQuery == "" {
			return nil, "", "", errors.New("AI planner did not return a search query")
		}
		canonicalPath = "/api/get-intelligent-results"
		queryParams.Set("query", searchQuery)
		if lang := strings.TrimSpace(payload.Lang); lang != "" {
			queryParams.Set("lang", lang)
		}
	case "rows_page":
		for _, key := range sortedFilterbarAIPlanFilterKeys(plannerResponse.Plan.Filters) {
			queryParams.Set(key, plannerResponse.Plan.Filters[key])
		}
		if plannerResponse.Offset != nil && *plannerResponse.Offset >= 0 {
			queryParams.Set("offset", strconv.Itoa(*plannerResponse.Offset))
		}
		if sortColumn := strings.TrimSpace(plannerResponse.Plan.SortColumn); sortColumn != "" {
			queryParams.Set("sort_column", sortColumn)
		}
		if sortOrder := strings.ToUpper(strings.TrimSpace(plannerResponse.Plan.SortOrder)); sortOrder != "" {
			queryParams.Set("sort_order", sortOrder)
		}
	default:
		return nil, "", "", errors.New("unsupported AI planner mode")
	}

	delegateReq := original.Clone(original.Context())
	delegateReq.Method = http.MethodGet
	delegateReq.Body = http.NoBody

	delegateURL := *delegateReq.URL
	delegateURL.Path = canonicalPath
	delegateURL.RawQuery = queryParams.Encode()
	delegateReq.URL = &delegateURL
	delegateReq.RequestURI = canonicalPath
	if delegateURL.RawQuery != "" {
		delegateReq.RequestURI += "?" + delegateURL.RawQuery
	}

	return delegateReq, canonicalPath, mode, nil
}

func executeFilterbarAIDelegate(mode string, delegateReq *http.Request) (map[string]interface{}, error) {
	delegate, ok := filterbarAIQueryDelegates[mode]
	if !ok {
		return nil, errors.New("missing canonical delegate for query mode")
	}

	recorder := httptest.NewRecorder()
	delegate(recorder, delegateReq)

	if recorder.Code >= http.StatusBadRequest {
		return nil, &filterbarAIDelegateResponseError{Recorder: recorder}
	}

	var result map[string]interface{}
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		return nil, errors.New("canonical delegate returned non-JSON response")
	}

	return result, nil
}

func buildFilterbarAIAnswer(mode string, delegateQuery url.Values, result map[string]interface{}) string {
	rowCount := countFilterbarAIResultRows(result)
	if mode == "rows_page" {
		sortColumn := strings.TrimSpace(delegateQuery.Get("sort_column"))
		sortOrder := strings.ToUpper(strings.TrimSpace(delegateQuery.Get("sort_order")))
		if sortColumn != "" && (sortOrder == "ASC" || sortOrder == "DESC") {
			return "Sorted results by " + sortColumn + " " + sortOrder + "."
		}
		return "Loaded " + strconv.Itoa(rowCount) + " rows through rows_page."
	}
	return "Returned " + strconv.Itoa(rowCount) + " result rows through " + mode + "."
}

func sortedFilterbarAIPlanFilterKeys(filters map[string]string) []string {
	if len(filters) == 0 {
		return []string{}
	}
	keys := make([]string, 0, len(filters))
	for key, value := range filters {
		if strings.TrimSpace(key) == "" || strings.TrimSpace(value) == "" {
			continue
		}
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func extractFilterbarAIPlanFiltersFromQuery(queryValues url.Values) map[string]string {
	if len(queryValues) == 0 {
		return nil
	}
	filters := make(map[string]string)
	for key, values := range queryValues {
		normalizedKey := strings.TrimSpace(key)
		if normalizedKey == "" || isFilterbarAIReservedDelegateQueryParam(normalizedKey) {
			continue
		}
		if len(values) == 0 {
			continue
		}
		value := strings.TrimSpace(values[0])
		if value == "" {
			continue
		}
		filters[normalizedKey] = value
	}
	if len(filters) == 0 {
		return nil
	}
	return filters
}

func isFilterbarAIReservedDelegateQueryParam(paramName string) bool {
	switch strings.ToLower(strings.TrimSpace(paramName)) {
	case "dataset", "sort_column", "sort_order", "offset", "row_count", "lang", "include_card_support", "include_map_support", "query":
		return true
	default:
		return false
	}
}

func countFilterbarAIResultRows(result map[string]interface{}) int {
	rawRows, ok := result["data"]
	if !ok {
		return 0
	}

	rows, ok := rawRows.([]interface{})
	if !ok {
		return 0
	}

	return len(rows)
}

func copyFilterbarAIErrorResponse(w http.ResponseWriter, recorder *httptest.ResponseRecorder) {
	for header, values := range recorder.Header() {
		for _, value := range values {
			w.Header().Add(header, value)
		}
	}
	w.WriteHeader(recorder.Code)
	_, _ = w.Write(recorder.Body.Bytes())
}

func readFilterbarAIEmbeddingsCapability(dataset string) (bool, error) {
	var flag sql.NullBool
	err := backend.Db.QueryRow(`
		SELECT multi_lang_embeddings
		FROM system_db_tables
		WHERE table_name = $1
	`, dataset).Scan(&flag)
	if err != nil {
		return false, err
	}

	return flag.Valid && flag.Bool, nil
}

// readFilterbarAIWorkspaceCapabilities loads a bounded dataset catalog for the API chat planner.
// Between: system table metadata and OpenAI planner capabilities.
// Why: Lets the model choose other datasets through canonical APIs without direct SQL execution.
func readFilterbarAIWorkspaceCapabilities(ctx context.Context, currentDataset string) ([]filterbarAIDatasetCapability, error) {
	rows, err := backend.Db.Query(`
		SELECT
			t.table_name,
			COALESCE(t.multi_lang_embeddings, false),
			COALESCE(
				json_agg(cd.column_name ORDER BY cd.co_number)
					FILTER (WHERE c.column_name IS NOT NULL),
				'[]'::json
			)::text AS column_names
		FROM system_db_tables t
		LEFT JOIN system_column_details cd
		  ON cd.table_uid = t.table_uid
		LEFT JOIN information_schema.columns c
		  ON c.table_schema = 'public'
		 AND c.table_name = t.table_name
		 AND c.column_name = cd.column_name
		 AND c.column_name NOT IN ('embedding_vector', 'search_vector_simple')
		WHERE COALESCE(t.table_name, '') <> ''
		GROUP BY t.table_name, t.multi_lang_embeddings
		ORDER BY CASE WHEN t.table_name = $1 THEN 0 ELSE 1 END, t.table_name
		LIMIT $2
	`, currentDataset, filterbarAIWorkspaceMaxDatasets)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var permissionCtx permissions.PermissionContext
	shouldFilterByPermissions := false
	if actor, ok := dbutils.GetRequestActorContext(ctx); ok && actor.UserID > 0 {
		permissionCtx = permissions.NewPermissionContext(backend.Db, actor.UserID)
		shouldFilterByPermissions = true
	}

	capabilities := []filterbarAIDatasetCapability{}
	for rows.Next() {
		var capability filterbarAIDatasetCapability
		var columnsJSON string
		if err := rows.Scan(&capability.Dataset, &capability.SupportsMultilingualEmbeddings, &columnsJSON); err != nil {
			return nil, err
		}
		var columns []string
		if err := json.Unmarshal([]byte(columnsJSON), &columns); err != nil {
			return nil, fmt.Errorf("failed to decode AI dataset capability columns: %w", err)
		}
		capability.Columns = normalizeFilterbarAICapabilityColumns(columns)
		if strings.TrimSpace(capability.Dataset) == "" || len(capability.Columns) == 0 {
			continue
		}
		if shouldFilterByPermissions {
			allowed, err := permissionCtx.HasRouteTablePermission(
				"/api/get-results",
				permissions.RouteTableScope{TableName: capability.Dataset},
				permissions.StrictRouteTableOptions(),
			)
			if err != nil {
				return nil, err
			}
			if !allowed {
				continue
			}
		}
		capabilities = append(capabilities, capability)
	}
	return capabilities, rows.Err()
}

// normalizeFilterbarAICapabilityColumns trims, deduplicates, and bounds planner column metadata.
// Between: database column metadata and the planner prompt payload.
// Why: Keeps the prompt compact and stable even on wide datasets.
func normalizeFilterbarAICapabilityColumns(columns []string) []string {
	normalized := make([]string, 0, len(columns))
	seen := make(map[string]struct{}, len(columns))
	for _, columnName := range columns {
		columnName = strings.TrimSpace(columnName)
		if columnName == "" {
			continue
		}
		if _, exists := seen[columnName]; exists {
			continue
		}
		seen[columnName] = struct{}{}
		normalized = append(normalized, columnName)
		if len(normalized) >= filterbarAIWorkspaceMaxColumns {
			break
		}
	}
	return normalized
}

func readFilterbarAIFilterableColumnNames(dataset string) ([]string, error) {
	rows, err := backend.Db.Query(`
		SELECT column_name
		FROM information_schema.columns
		WHERE table_schema = 'public'
		  AND table_name = $1
		  AND column_name NOT IN ('embedding_vector', 'search_vector_simple')
		ORDER BY ordinal_position
	`, dataset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	columnNames := []string{}
	for rows.Next() {
		var columnName string
		if err := rows.Scan(&columnName); err != nil {
			return nil, err
		}
		columnName = strings.TrimSpace(columnName)
		if columnName != "" {
			columnNames = append(columnNames, columnName)
		}
	}
	return columnNames, rows.Err()
}
