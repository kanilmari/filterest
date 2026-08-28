// filterbar_ai_query_builder.go
// Builds LLM-backed plans for the API-first filter bar AI facade.
// Bridges dataset metadata, recent chat context, and the OpenAI chat-completions client.
// Exists so AI chat can interpret natural-language requests without reviving direct SQL execution.
package dtt_1_row_read

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/sashabaranov/go-openai"
)

var (
	errFilterbarAIInvalidPlannerResult = errors.New("invalid AI planner result")
	errFilterbarAIOpenAIKeyMissing     = errors.New("missing OPENAI_API_KEY")
)

const filterbarAIMaxPlannerCalls = 4
const filterbarAIDefaultOpenAIModel = "gpt-5.5"

type filterbarAIDatasetCapability struct {
	Dataset                        string   `json:"dataset"`
	Columns                        []string `json:"columns"`
	SupportsMultilingualEmbeddings bool     `json:"supports_multilingual_embeddings"`
}

type filterbarAIPlannedCall struct {
	Dataset  string
	Plan     filterbarAIQueryPlan
	Offset   *int
	RowCount *int
}

type filterbarAIPlannerResponse struct {
	Answer   string
	Plan     filterbarAIQueryPlan
	Calls    []filterbarAIPlannedCall
	Offset   *int
	RowCount *int
	Usage    *filterbarAIUsageSummary
}

type filterbarAIAnswerResponse struct {
	Answer string
	Usage  *filterbarAIUsageSummary
}

type filterbarAILLMPlannerPayload struct {
	Dataset     string                      `json:"dataset,omitempty"`
	Mode        string                      `json:"mode"`
	Answer      string                      `json:"answer"`
	SearchQuery string                      `json:"search_query,omitempty"`
	Filters     map[string]string           `json:"filters,omitempty"`
	SortColumn  string                      `json:"sort_column,omitempty"`
	SortOrder   string                      `json:"sort_order,omitempty"`
	ApplyAsSort bool                        `json:"apply_as_sort,omitempty"`
	Offset      *int                        `json:"offset,omitempty"`
	RowCount    *int                        `json:"row_count,omitempty"`
	Calls       []filterbarAILLMPlannerCall `json:"calls,omitempty"`
}

type filterbarAILLMPlannerCall struct {
	Dataset     string            `json:"dataset,omitempty"`
	Mode        string            `json:"mode"`
	SearchQuery string            `json:"search_query,omitempty"`
	Filters     map[string]string `json:"filters,omitempty"`
	SortColumn  string            `json:"sort_column,omitempty"`
	SortOrder   string            `json:"sort_order,omitempty"`
	ApplyAsSort bool              `json:"apply_as_sort,omitempty"`
	Offset      *int              `json:"offset,omitempty"`
	RowCount    *int              `json:"row_count,omitempty"`
}

// resolveFilterbarAIOpenAIModel chooses the chat model for API-AI planning and answering.
// Between: OpenAI chat request builders and environment configuration.
// Why: Keeps the product chat default separate from the DEV-only Codex path.
func resolveFilterbarAIOpenAIModel() string {
	modelName := strings.TrimSpace(os.Getenv("OPENAI_API_MODEL"))
	if modelName == "" {
		return filterbarAIDefaultOpenAIModel
	}
	return modelName
}

// shouldSendFilterbarAITemperature reports whether the selected model accepts custom temperature.
// Between: OpenAI model selection and chat-completion request construction.
// Why: Newer reasoning models reject non-default temperature values with HTTP 400.
func shouldSendFilterbarAITemperature(modelName string) bool {
	normalized := strings.ToLower(strings.TrimSpace(modelName))
	if normalized == "" {
		return false
	}
	if strings.HasPrefix(normalized, "gpt-5") || strings.HasPrefix(normalized, "o1") ||
		strings.HasPrefix(normalized, "o3") || strings.HasPrefix(normalized, "o4") {
		return false
	}
	return true
}

// buildFilterbarAIChatCompletionRequest keeps OpenAI request defaults model-aware.
// Between: planner/answer prompts and the OpenAI client library.
// Why: The Chat Completions API accepts temperature for older chat models, but not for default-only reasoning models.
func buildFilterbarAIChatCompletionRequest(modelName string, messages []openai.ChatCompletionMessage, temperature float32) openai.ChatCompletionRequest {
	request := openai.ChatCompletionRequest{
		Model:    modelName,
		Messages: messages,
	}
	if shouldSendFilterbarAITemperature(modelName) {
		request.Temperature = temperature
	}
	return request
}

// planFilterbarAIQueryWithLLM asks the chat model to choose a canonical read plan for one natural-language message.
func planFilterbarAIQueryWithLLM(ctx context.Context, payload filterbarAIQueryRequest, columns []map[string]interface{}, supportsEmbeddings bool) (filterbarAIPlannerResponse, error) {
	query := strings.TrimSpace(payload.Query)
	if query == "" {
		return filterbarAIPlannerResponse{}, errors.New("query is required when using the AI planner")
	}

	apiKey := strings.TrimSpace(os.Getenv("OPENAI_API_KEY"))
	if apiKey == "" {
		return filterbarAIPlannerResponse{}, errFilterbarAIOpenAIKeyMissing
	}

	modelName := resolveFilterbarAIOpenAIModel()

	columnNames := extractFilterbarAIColumnNames(columns)
	workspaceCapabilities, err := filterbarAIWorkspaceReader(ctx, payload.Dataset)
	if err != nil || len(workspaceCapabilities) == 0 {
		workspaceCapabilities = []filterbarAIDatasetCapability{{
			Dataset:                        payload.Dataset,
			Columns:                        columnNames,
			SupportsMultilingualEmbeddings: supportsEmbeddings,
		}}
	}

	systemPrompt := buildFilterbarAIPlannerSystemPromptForWorkspace(payload.Dataset, workspaceCapabilities)
	userPrompt, err := buildFilterbarAIPlannerUserPromptForWorkspace(payload, workspaceCapabilities)
	if err != nil {
		return filterbarAIPlannerResponse{}, err
	}

	client := openai.NewClient(apiKey)
	plannerCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()

	resp, err := client.CreateChatCompletion(plannerCtx, buildFilterbarAIChatCompletionRequest(
		modelName,
		[]openai.ChatCompletionMessage{
			{Role: openai.ChatMessageRoleSystem, Content: systemPrompt},
			{Role: openai.ChatMessageRoleUser, Content: userPrompt},
		},
		0.1,
	))
	if err != nil {
		return filterbarAIPlannerResponse{}, fmt.Errorf("error planning AI chat query with OpenAI: %w", err)
	}
	if len(resp.Choices) == 0 {
		return filterbarAIPlannerResponse{}, fmt.Errorf("error planning AI chat query with OpenAI: no choices returned")
	}

	rawContent := strings.TrimSpace(resp.Choices[0].Message.Content)
	rawJSON := extractFilterbarAIJSONResponse(rawContent)

	var plannerPayload filterbarAILLMPlannerPayload
	if err := json.Unmarshal([]byte(rawJSON), &plannerPayload); err != nil {
		return filterbarAIPlannerResponse{}, fmt.Errorf("%w: planner returned invalid JSON: %v", errFilterbarAIInvalidPlannerResult, err)
	}

	plannerResponse, err := validateFilterbarAIPlannerPayloadForDatasets(plannerPayload, payload.Dataset, workspaceCapabilities)
	if err != nil {
		return filterbarAIPlannerResponse{}, err
	}
	plannerResponse.Usage = buildFilterbarAIUsageSummary([]filterbarAIUsageCall{
		buildFilterbarAIOpenAIUsageCall("planner", modelName, resolveFilterbarAIOpenAIEffort(), resp.Usage),
	})
	return plannerResponse, nil
}

func buildFilterbarAIPlannerSystemPrompt(dataset string, columnNames []string, supportsEmbeddings bool) string {
	return buildFilterbarAIPlannerSystemPromptForWorkspace(dataset, []filterbarAIDatasetCapability{{
		Dataset:                        dataset,
		Columns:                        columnNames,
		SupportsMultilingualEmbeddings: supportsEmbeddings,
	}})
}

// buildFilterbarAIPlannerSystemPromptForWorkspace describes the bounded multi-dataset read surface.
// Between: dataset capability metadata and the OpenAI planner system message.
// Why: Lets the API chat plan multiple canonical reads without exposing SQL.
func buildFilterbarAIPlannerSystemPromptForWorkspace(dataset string, workspaceCapabilities []filterbarAIDatasetCapability) string {
	capabilitiesJSON, err := json.Marshal(workspaceCapabilities)
	if err != nil {
		capabilitiesJSON = []byte("[]")
	}
	return strings.TrimSpace(fmt.Sprintf(`
You are the Easelect filter bar AI planner for the current dataset %q.

Your job is to interpret the user's message and choose the best API-first read action or a bounded list of read actions.
You must never write, request, expose, or mention SQL.
You must never return a direct SQL query.

Available modes:
- "text_search": semantic/text search across the dataset. Fill "search_query".
- "rows_page": browsing, sorting, paging, or exact field filtering existing rows. For filters, fill "filters" with exact dataset column names as keys. For sort requests, set "apply_as_sort": true and provide exact "sort_column" and "sort_order".
- "answer_only": only reply conversationally when no dataset action should be triggered.

Rules:
- You may read the current dataset or another available dataset when the user's request needs it.
- You may return one call or multiple calls. Use at most %d calls.
- Each call must use an exact dataset name and exact column names from the available dataset capabilities JSON below.
- Prefer one well-targeted call when enough. Use multiple calls for comparison, cross-dataset questions, follow-up lookup, or when the user asks about a table other than the current dataset.
- If the user writes an exact field filter like "cached_username:serlog" or asks for rows owned by a username, prefer "rows_page" with "filters" instead of "text_search".
- Natural owner phrases must become exact filters when possible. Example: "serlog-käyttäjän omistama palvelu", "services owned by serlog", and "owner serlog" should return {"mode":"rows_page","filters":{"cached_username":"serlog"}} when "cached_username" exists; use "username" if that is the available owner-name column, or "user_id" only when the user gives a numeric id.
- Date/time and id ranges are filters too: when a base column exists, use "<column>_from" and "<column>_to" filter keys, for example {"created_from":"2026-05-01","created_to":"2026-05-06"} or {"id_from":"100","id_to":"200"}.
- Do not put column filters into "search_query"; use "filters".
- Keep "answer" short, helpful, and in the user's language.
- Recent conversation may include system messages starting with %q. Those are compact result snapshots from previous API reads; use them only when the user asks follow-up questions about earlier results.
- If the user asks for newest/latest/recent or oldest/earliest results, prefer the most suitable exact existing timestamp or id column from the relevant dataset metadata.
- If the user asks to change how current visible results are ordered, prefer "rows_page" on the current dataset with "apply_as_sort": true.
- If the user is clearly asking for dataset results, do not choose "answer_only".
- Return JSON only. No markdown. No commentary outside JSON.

Available dataset capabilities JSON: %s
`, dataset, filterbarAIMaxPlannerCalls, filterbarAIResultMemoryMarker, string(capabilitiesJSON)))
}

func buildFilterbarAIPlannerUserPrompt(payload filterbarAIQueryRequest, columnNames []string, supportsEmbeddings bool) (string, error) {
	return buildFilterbarAIPlannerUserPromptForWorkspace(payload, []filterbarAIDatasetCapability{{
		Dataset:                        payload.Dataset,
		Columns:                        columnNames,
		SupportsMultilingualEmbeddings: supportsEmbeddings,
	}})
}

// buildFilterbarAIPlannerUserPromptForWorkspace adds per-turn query and conversation context.
// Between: browser chat payloads, workspace capabilities, and the OpenAI planner user message.
// Why: Keeps dynamic context late in the prompt while preserving exact dataset and column contracts.
func buildFilterbarAIPlannerUserPromptForWorkspace(payload filterbarAIQueryRequest, workspaceCapabilities []filterbarAIDatasetCapability) (string, error) {
	recentMessages := trimFilterbarAIPlannerMessages(payload.Messages, 12)
	messagesJSON, err := json.Marshal(recentMessages)
	if err != nil {
		return "", fmt.Errorf("failed to encode AI chat messages for planner prompt: %w", err)
	}

	workspaceJSON, err := json.Marshal(workspaceCapabilities)
	if err != nil {
		return "", fmt.Errorf("failed to encode AI chat dataset capabilities for planner prompt: %w", err)
	}

	return strings.TrimSpace(fmt.Sprintf(`
Current dataset: %s
Current UI language: %s
Available dataset capabilities: %s
Recent conversation messages (oldest first): %s
Latest user request: %s

Return one JSON object with this shape:
{
  "answer": "short reply in the user's language",
  "mode": "text_search | rows_page | answer_only",
  "dataset": "optional exact dataset name; defaults to current dataset",
  "search_query": "optional string",
  "filters": {"optional_exact_column_name": "optional filter value"},
  "sort_column": "optional exact dataset column name",
  "sort_order": "optional ASC or DESC",
  "apply_as_sort": true,
  "offset": 0,
  "calls": [
    {
      "dataset": "exact dataset name",
      "mode": "text_search | rows_page",
      "search_query": "optional string",
      "filters": {"optional_exact_column_name": "optional filter value"},
      "sort_column": "optional exact dataset column name",
      "sort_order": "optional ASC or DESC",
      "apply_as_sort": false,
      "offset": 0
    }
  ]
}
`, payload.Dataset, strings.TrimSpace(payload.Lang), string(workspaceJSON), string(messagesJSON), strconv.Quote(strings.TrimSpace(payload.Query)))), nil
}

func trimFilterbarAIPlannerMessages(messages []aiChatConversationMessage, limit int) []aiChatConversationMessage {
	normalized := make([]aiChatConversationMessage, 0, len(messages))
	for _, message := range messages {
		role := strings.TrimSpace(message.Role)
		content := strings.TrimSpace(message.Content)
		if role == "" || content == "" {
			continue
		}
		normalized = append(normalized, aiChatConversationMessage{
			Role:    role,
			Content: content,
		})
	}

	if limit > 0 && len(normalized) > limit {
		return normalized[len(normalized)-limit:]
	}
	return normalized
}

func extractFilterbarAIColumnNames(columns []map[string]interface{}) []string {
	columnNames := make([]string, 0, len(columns))
	seen := make(map[string]struct{}, len(columns))

	for _, column := range columns {
		columnName, _ := column["column_name"].(string)
		columnName = strings.TrimSpace(columnName)
		if columnName == "" {
			continue
		}
		if _, exists := seen[columnName]; exists {
			continue
		}
		seen[columnName] = struct{}{}
		columnNames = append(columnNames, columnName)
	}

	return columnNames
}

func extractFilterbarAIJSONResponse(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if strings.HasPrefix(trimmed, "```") {
		trimmed = strings.TrimPrefix(trimmed, "```json")
		trimmed = strings.TrimPrefix(trimmed, "```JSON")
		trimmed = strings.TrimPrefix(trimmed, "```")
		trimmed = strings.TrimSuffix(trimmed, "```")
	}
	return strings.TrimSpace(trimmed)
}

func validateFilterbarAIPlannerPayload(payload filterbarAILLMPlannerPayload, columnNames []string) (filterbarAIPlannerResponse, error) {
	call := filterbarAILLMPlannerCall{
		Dataset:     payload.Dataset,
		Mode:        payload.Mode,
		SearchQuery: payload.SearchQuery,
		Filters:     payload.Filters,
		SortColumn:  payload.SortColumn,
		SortOrder:   payload.SortOrder,
		ApplyAsSort: payload.ApplyAsSort,
		Offset:      payload.Offset,
		RowCount:    payload.RowCount,
	}
	response, err := validateFilterbarAIPlannerCallPayload(call, columnNames, strings.TrimSpace(payload.Answer))
	if err != nil {
		return filterbarAIPlannerResponse{}, err
	}
	response.Answer = normalizeFilterbarAIPlannerAnswer(payload.Answer)
	return response, nil
}

// validateFilterbarAIPlannerPayloadForDatasets validates one or more planner calls against known capabilities.
// Between: untrusted LLM JSON and canonical API delegate execution.
// Why: Prevents arbitrary table/column selection while allowing bounded cross-dataset reads.
func validateFilterbarAIPlannerPayloadForDatasets(payload filterbarAILLMPlannerPayload, defaultDataset string, capabilities []filterbarAIDatasetCapability) (filterbarAIPlannerResponse, error) {
	capabilityByDataset := make(map[string]filterbarAIDatasetCapability, len(capabilities))
	for _, capability := range capabilities {
		datasetName := strings.TrimSpace(capability.Dataset)
		if datasetName == "" {
			continue
		}
		capability.Dataset = datasetName
		capabilityByDataset[datasetName] = capability
	}
	if len(capabilityByDataset) == 0 {
		return filterbarAIPlannerResponse{}, fmt.Errorf("%w: no dataset capabilities available", errFilterbarAIInvalidPlannerResult)
	}

	answer := normalizeFilterbarAIPlannerAnswer(payload.Answer)
	rawCalls := payload.Calls
	if len(rawCalls) == 0 {
		rawCalls = []filterbarAILLMPlannerCall{{
			Dataset:     payload.Dataset,
			Mode:        payload.Mode,
			SearchQuery: payload.SearchQuery,
			Filters:     payload.Filters,
			SortColumn:  payload.SortColumn,
			SortOrder:   payload.SortOrder,
			ApplyAsSort: payload.ApplyAsSort,
			Offset:      payload.Offset,
			RowCount:    payload.RowCount,
		}}
	}
	if len(rawCalls) > filterbarAIMaxPlannerCalls {
		return filterbarAIPlannerResponse{}, fmt.Errorf("%w: planner returned too many calls", errFilterbarAIInvalidPlannerResult)
	}

	response := filterbarAIPlannerResponse{Answer: answer}
	for _, rawCall := range rawCalls {
		datasetName := strings.TrimSpace(rawCall.Dataset)
		if datasetName == "" {
			datasetName = strings.TrimSpace(defaultDataset)
		}
		capability, ok := capabilityByDataset[datasetName]
		if !ok {
			return filterbarAIPlannerResponse{}, fmt.Errorf("%w: planner selected unavailable dataset %q", errFilterbarAIInvalidPlannerResult, datasetName)
		}
		callResponse, err := validateFilterbarAIPlannerCallPayload(rawCall, capability.Columns, answer)
		if err != nil {
			return filterbarAIPlannerResponse{}, err
		}
		callResponse.Plan.Dataset = datasetName
		if callResponse.Plan.Mode == "answer_only" {
			if response.Plan.Mode == "" {
				response.Plan = callResponse.Plan
			}
			continue
		}
		response.Calls = append(response.Calls, filterbarAIPlannedCall{
			Dataset:  datasetName,
			Plan:     callResponse.Plan,
			Offset:   callResponse.Offset,
			RowCount: callResponse.RowCount,
		})
		if response.Plan.Mode == "" || datasetName == defaultDataset {
			response.Plan = callResponse.Plan
			response.Offset = callResponse.Offset
			response.RowCount = callResponse.RowCount
		}
	}

	if len(response.Calls) == 0 {
		response.Plan = filterbarAIQueryPlan{
			Dataset: strings.TrimSpace(defaultDataset),
			Mode:    "answer_only",
			UsesSQL: false,
		}
		return response, nil
	}
	if response.Plan.Mode == "" {
		firstCall := response.Calls[0]
		response.Plan = firstCall.Plan
		response.Offset = firstCall.Offset
		response.RowCount = firstCall.RowCount
	}
	return response, nil
}

// validateFilterbarAIPlannerCallPayload normalizes a single call into the legacy plan shape.
// Between: planner call JSON and filterbarAIQueryPlan.
// Why: Reuses the existing rows/search guardrails for every multi-call step.
func validateFilterbarAIPlannerCallPayload(payload filterbarAILLMPlannerCall, columnNames []string, answer string) (filterbarAIPlannerResponse, error) {
	columnSet := make(map[string]struct{}, len(columnNames))
	for _, columnName := range columnNames {
		columnSet[columnName] = struct{}{}
	}

	mode := strings.ToLower(strings.TrimSpace(payload.Mode))
	answer = normalizeFilterbarAIPlannerAnswer(answer)

	normalizedFilters, err := normalizeFilterbarAIPlannerFilters(payload.Filters, columnSet)
	if err != nil {
		return filterbarAIPlannerResponse{}, err
	}

	response := filterbarAIPlannerResponse{
		Answer: answer,
		Plan: filterbarAIQueryPlan{
			Mode:        mode,
			UsesSQL:     false,
			SearchQuery: strings.TrimSpace(payload.SearchQuery),
			Filters:     normalizedFilters,
			SortColumn:  strings.TrimSpace(payload.SortColumn),
			SortOrder:   strings.ToUpper(strings.TrimSpace(payload.SortOrder)),
			ApplyAsSort: payload.ApplyAsSort,
		},
		Offset:   payload.Offset,
		RowCount: payload.RowCount,
	}
	if extractedFilters, remainingQuery := extractFilterbarAIColumnFilters(response.Plan.SearchQuery, columnSet); len(extractedFilters) > 0 {
		if response.Plan.Filters == nil {
			response.Plan.Filters = make(map[string]string, len(extractedFilters))
		}
		for key, value := range extractedFilters {
			if _, exists := response.Plan.Filters[key]; !exists {
				response.Plan.Filters[key] = value
			}
		}
		response.Plan.SearchQuery = remainingQuery
		if response.Plan.Mode == "text_search" {
			response.Plan.Mode = "rows_page"
		}
	}

	switch response.Plan.Mode {
	case "answer_only":
		response.Plan.SearchQuery = ""
		response.Plan.Filters = nil
		response.Plan.SortColumn = ""
		response.Plan.SortOrder = ""
		response.Plan.ApplyAsSort = false
		response.Offset = nil
		response.RowCount = nil
		return response, nil
	case "text_search":
		if response.Plan.SearchQuery == "" {
			return filterbarAIPlannerResponse{}, fmt.Errorf("%w: planner omitted search_query for text_search", errFilterbarAIInvalidPlannerResult)
		}
		response.Plan.Filters = nil
		response.Plan.SortColumn = ""
		response.Plan.SortOrder = ""
		response.Plan.ApplyAsSort = false
		return response, nil
	case "rows_page":
		if response.Offset != nil && *response.Offset < 0 {
			return filterbarAIPlannerResponse{}, fmt.Errorf("%w: planner returned a negative offset", errFilterbarAIInvalidPlannerResult)
		}
		if response.RowCount != nil && *response.RowCount < 0 {
			return filterbarAIPlannerResponse{}, fmt.Errorf("%w: planner returned a negative row_count", errFilterbarAIInvalidPlannerResult)
		}
		if response.Plan.SortColumn != "" {
			if _, ok := columnSet[response.Plan.SortColumn]; !ok {
				return filterbarAIPlannerResponse{}, fmt.Errorf("%w: planner selected unknown sort column %q", errFilterbarAIInvalidPlannerResult, response.Plan.SortColumn)
			}
		}
		if response.Plan.SortOrder != "" && !slices.Contains([]string{"ASC", "DESC"}, response.Plan.SortOrder) {
			return filterbarAIPlannerResponse{}, fmt.Errorf("%w: planner returned invalid sort order %q", errFilterbarAIInvalidPlannerResult, response.Plan.SortOrder)
		}
		if response.Plan.ApplyAsSort && (response.Plan.SortColumn == "" || response.Plan.SortOrder == "") {
			return filterbarAIPlannerResponse{}, fmt.Errorf("%w: planner requested apply_as_sort without sort_column and sort_order", errFilterbarAIInvalidPlannerResult)
		}
		response.Plan.SearchQuery = ""
		return response, nil
	default:
		return filterbarAIPlannerResponse{}, fmt.Errorf("%w: planner returned unsupported mode %q", errFilterbarAIInvalidPlannerResult, payload.Mode)
	}
}

// normalizeFilterbarAIPlannerAnswer provides a non-empty fallback draft answer.
// Between: optional planner prose and user-visible response assembly.
// Why: Keeps empty planner answers from leaking into later answer prompts.
func normalizeFilterbarAIPlannerAnswer(answer string) string {
	answer = strings.TrimSpace(answer)
	if answer == "" {
		return "Working on your request."
	}
	return answer
}

func normalizeFilterbarAIPlannerFilters(filters map[string]string, columnSet map[string]struct{}) (map[string]string, error) {
	if len(filters) == 0 {
		return nil, nil
	}
	normalized := make(map[string]string)
	for key, value := range filters {
		columnName := resolveFilterbarAIPlannerFilterColumn(key, columnSet)
		filterValue := strings.TrimSpace(value)
		if filterValue == "" {
			continue
		}
		if columnName == "" {
			return nil, fmt.Errorf("%w: planner selected unknown filter column %q", errFilterbarAIInvalidPlannerResult, key)
		}
		normalized[columnName] = filterValue
	}
	if len(normalized) == 0 {
		return nil, nil
	}
	return normalized, nil
}

func extractFilterbarAIColumnFilters(rawSearchQuery string, columnSet map[string]struct{}) (map[string]string, string) {
	rawSearchQuery = strings.TrimSpace(rawSearchQuery)
	if rawSearchQuery == "" {
		return nil, ""
	}

	filters := make(map[string]string)
	remainingTerms := make([]string, 0)
	for _, term := range splitFilterbarAISearchTerms(rawSearchQuery) {
		key, value, ok := splitFilterbarAIColumnFilterTerm(term)
		columnName := ""
		if ok {
			columnName = resolveFilterbarAIPlannerFilterColumn(key, columnSet)
		}
		if columnName == "" || strings.TrimSpace(value) == "" {
			remainingTerms = append(remainingTerms, term)
			continue
		}
		filters[columnName] = strings.Trim(strings.TrimSpace(value), `"'`)
	}

	if len(filters) == 0 {
		return nil, rawSearchQuery
	}
	return filters, strings.TrimSpace(strings.Join(remainingTerms, " "))
}

func splitFilterbarAISearchTerms(rawSearchQuery string) []string {
	terms := make([]string, 0)
	var builder strings.Builder
	var quote rune
	for _, char := range rawSearchQuery {
		if quote != 0 {
			builder.WriteRune(char)
			if char == quote {
				quote = 0
			}
			continue
		}
		if char == '"' || char == '\'' {
			quote = char
			builder.WriteRune(char)
			continue
		}
		if char == ' ' || char == '\t' || char == '\n' || char == '\r' {
			if builder.Len() > 0 {
				terms = append(terms, builder.String())
				builder.Reset()
			}
			continue
		}
		builder.WriteRune(char)
	}
	if builder.Len() > 0 {
		terms = append(terms, builder.String())
	}
	return terms
}

func splitFilterbarAIColumnFilterTerm(term string) (string, string, bool) {
	parts := strings.SplitN(strings.TrimSpace(term), ":", 2)
	if len(parts) != 2 {
		return "", "", false
	}
	key := strings.Trim(strings.TrimSpace(parts[0]), "`\"'([{")
	value := strings.Trim(strings.TrimSpace(parts[1]), "`\"'.,;)]}")
	if key == "" || value == "" {
		return "", "", false
	}
	return key, value, true
}

func resolveFilterbarAIPlannerFilterColumn(rawColumn string, columnSet map[string]struct{}) string {
	columnName := strings.TrimSpace(rawColumn)
	if columnName == "" {
		return ""
	}
	if _, ok := columnSet[columnName]; ok {
		return columnName
	}
	for _, suffix := range []string{"_from", "_to"} {
		if strings.HasSuffix(strings.ToLower(columnName), suffix) {
			baseColumn := resolveFilterbarAIPlannerFilterColumn(columnName[:len(columnName)-len(suffix)], columnSet)
			if baseColumn != "" {
				return baseColumn + suffix
			}
		}
	}
	lowered := strings.ToLower(columnName)
	for candidate := range columnSet {
		if strings.ToLower(candidate) == lowered {
			return candidate
		}
	}

	aliases := map[string][]string{
		"user":            {"cached_username", "username", "user_id"},
		"username":        {"cached_username", "username"},
		"owner":           {"cached_username", "username", "user_id"},
		"owner_username":  {"cached_username", "username"},
		"created_by_user": {"cached_username", "username"},
		"created_by_name": {"cached_username", "username"},
		"owner_id":        {"user_id", "created_by"},
		"userid":          {"user_id"},
	}
	if candidates, ok := aliases[lowered]; ok {
		for _, candidate := range candidates {
			if _, exists := columnSet[candidate]; exists {
				return candidate
			}
		}
	}
	return ""
}

// answerFilterbarAIQueryWithLLM turns a canonical API result snapshot into the visible chat answer.
func answerFilterbarAIQueryWithLLM(ctx context.Context, payload filterbarAIQueryRequest, plannerResponse filterbarAIPlannerResponse, resultContext filterbarAIResultContext) (filterbarAIAnswerResponse, error) {
	apiKey := strings.TrimSpace(os.Getenv("OPENAI_API_KEY"))
	if apiKey == "" {
		return filterbarAIAnswerResponse{}, errFilterbarAIOpenAIKeyMissing
	}

	modelName := resolveFilterbarAIOpenAIModel()

	resultContextJSON, err := json.Marshal(resultContext)
	if err != nil {
		return filterbarAIAnswerResponse{}, fmt.Errorf("failed to encode AI result context: %w", err)
	}
	planJSON, err := json.Marshal(plannerResponse.Plan)
	if err != nil {
		return filterbarAIAnswerResponse{}, fmt.Errorf("failed to encode AI query plan: %w", err)
	}
	recentMessages := trimFilterbarAIPlannerMessages(payload.Messages, 12)
	messagesJSON, err := json.Marshal(recentMessages)
	if err != nil {
		return filterbarAIAnswerResponse{}, fmt.Errorf("failed to encode AI chat messages for result answer: %w", err)
	}

	client := openai.NewClient(apiKey)
	answerCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()

	resp, err := client.CreateChatCompletion(answerCtx, buildFilterbarAIChatCompletionRequest(
		modelName,
		[]openai.ChatCompletionMessage{
			{Role: openai.ChatMessageRoleSystem, Content: buildFilterbarAIAnswerSystemPrompt(payload.Dataset)},
			{Role: openai.ChatMessageRoleUser, Content: buildFilterbarAIAnswerUserPrompt(payload, string(planJSON), string(resultContextJSON), string(messagesJSON), plannerResponse.Answer)},
		},
		0.2,
	))
	if err != nil {
		return filterbarAIAnswerResponse{}, fmt.Errorf("error answering AI chat query with OpenAI: %w", err)
	}
	if len(resp.Choices) == 0 {
		return filterbarAIAnswerResponse{}, fmt.Errorf("error answering AI chat query with OpenAI: no choices returned")
	}
	return filterbarAIAnswerResponse{
		Answer: strings.TrimSpace(resp.Choices[0].Message.Content),
		Usage: buildFilterbarAIUsageSummary([]filterbarAIUsageCall{
			buildFilterbarAIOpenAIUsageCall("answer", modelName, resolveFilterbarAIOpenAIEffort(), resp.Usage),
		}),
	}, nil
}

func buildFilterbarAIAnswerSystemPrompt(dataset string) string {
	return strings.TrimSpace(fmt.Sprintf(`
You are the Easelect dataset chat assistant for %q.

Use only the provided API result context and recent conversation messages.
Never write, request, expose, or mention SQL.
The result context is an overview: long cells are clipped and not every matching row may be included.
The result context may include related API result contexts from other datasets in the same turn.
If the user asks a follow-up about previous results, use system messages that start with %q.
Do not expose system markers, raw JSON, or hidden memory details to the user.
Answer in the user's language, be concise, and mention uncertainty when the context is too limited.
`, dataset, filterbarAIResultMemoryMarker))
}

func buildFilterbarAIAnswerUserPrompt(payload filterbarAIQueryRequest, planJSON, resultContextJSON, messagesJSON, plannerAnswer string) string {
	return strings.TrimSpace(fmt.Sprintf(`
Dataset: %s
Current UI language: %s
Latest user request: %s
Planner answer draft: %s
Plan JSON: %s
Recent conversation messages (oldest first): %s
Current API result context JSON: %s

Write the visible assistant reply now. Do not output JSON.
`, payload.Dataset, strings.TrimSpace(payload.Lang), strconv.Quote(strings.TrimSpace(payload.Query)), strconv.Quote(strings.TrimSpace(plannerAnswer)), planJSON, messagesJSON, resultContextJSON))
}
