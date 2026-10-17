// filterbar_ai_planner_payload_test.go
// Verifies planner prompts, multi-dataset payloads, aliases and column filters.
// Connects AI planning contracts to the facade's pure prompt and payload functions.
// Keeps natural-language guidance and filter normalization independently covered.

package dtt_1_row_read

import (
	"strings"
	"testing"
)

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
