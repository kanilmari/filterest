// filterbar_ai_coding_agent_backend_context_test.go
// Verifies the model-free filter probe a code workspace job starts from.
// Bridges exact field:value questions with the canonical get-results delegate through fakes.
// Keeps the probe that replaced the second Codex planning call honest about rows and limits.
package dtt_1_row_read

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// useCodingAgentProbeFixture serves one Serlog row for a cached_username filter.
func useCodingAgentProbeFixture(t *testing.T, columns []string, filterable []string) {
	t.Helper()
	originalColumnsReader := filterbarAIColumnsReader
	originalFilterableColumnsReader := filterbarAIFilterableColumnsReader
	originalDelegates := filterbarAIQueryDelegates
	t.Cleanup(func() {
		filterbarAIColumnsReader = originalColumnsReader
		filterbarAIFilterableColumnsReader = originalFilterableColumnsReader
		filterbarAIQueryDelegates = originalDelegates
	})
	allowFilterbarAIReadAuthorization(t)
	filterbarAIColumnsReader = func(dataset string) ([]map[string]interface{}, error) {
		if dataset != "app_service_catalog" {
			t.Fatalf("columns dataset = %q, want app_service_catalog", dataset)
		}
		rows := make([]map[string]interface{}, 0, len(columns))
		for _, column := range columns {
			rows = append(rows, map[string]interface{}{"column_name": column})
		}
		return rows, nil
	}
	filterbarAIFilterableColumnsReader = func(string) ([]string, error) { return filterable, nil }
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
}

func probeCodingAgentContext(query string) codingAgentBackendContext {
	request := httptest.NewRequest(http.MethodPost, "/api/app/ai-chat/codex-query", nil)
	return buildCodingAgentBackendContext(request, codingAgentChatRequest{Dataset: "app_service_catalog", Query: query, Mode: "code_workspace"})
}

func assertSerlogProbe(t *testing.T, context codingAgentBackendContext) {
	t.Helper()
	probe := context.DeterministicFilterProbe
	if probe == nil {
		t.Fatalf("no probe: %+v", context)
	}
	if probe.RowsReturned != 1 || probe.Plan.Filters["cached_username"] != "serlog" ||
		!strings.HasPrefix(probe.CanonicalURL, "/api/get-results?cached_username=serlog") {
		t.Fatalf("probe = %+v", probe)
	}
	raw, _ := json.Marshal(context)
	if !strings.Contains(string(raw), "Serlog.com -palvelukatalogi") {
		t.Fatalf("the probed row must reach the job context: %s", raw)
	}
}

func TestCodingAgentContextProbesAnExactFieldFilter(t *testing.T) {
	useCodingAgentProbeFixture(t, []string{"id", "header", "user_id", "cached_username"}, nil)
	assertSerlogProbe(t, probeCodingAgentContext("Koita uudelleen `cached_username:serlog`"))
}

func TestCodingAgentContextFallsBackToFilterableColumns(t *testing.T) {
	useCodingAgentProbeFixture(t, []string{"id", "header"}, []string{"id", "header", "cached_username"})
	assertSerlogProbe(t, probeCodingAgentContext("cached_username:serlog"))
}

func TestCodingAgentContextAllowsTheHiddenOwnerFilter(t *testing.T) {
	useCodingAgentProbeFixture(t, []string{"id", "header"}, []string{"id", "header"})
	context := probeCodingAgentContext("cached_username:serlog")
	assertSerlogProbe(t, context)
	if context.DeterministicFilterProbeSkip != "" {
		t.Fatalf("the owner filter must not be skipped: %q", context.DeterministicFilterProbeSkip)
	}
}

func TestCodingAgentContextSkipsQuestionsWithoutAFieldFilter(t *testing.T) {
	useCodingAgentProbeFixture(t, []string{"id", "header"}, []string{"id", "header"})
	context := probeCodingAgentContext("Hae serlog-käyttäjän omistama palvelu")
	if context.DeterministicFilterProbe != nil || !strings.Contains(context.DeterministicFilterProbeSkip, "no exact field:value") {
		t.Fatalf("a question without field:value text must not be guessed into a filter: %+v", context)
	}
}

func TestCodingAgentPayloadFitsTheRunnerLimit(t *testing.T) {
	rows := make([]map[string]interface{}, 400)
	for index := range rows {
		rows[index] = map[string]interface{}{"description": strings.Repeat("x", 200)}
	}
	result := buildFilterbarAIResultContext("fixture", filterbarAIQueryPlan{Mode: "rows_page"}, map[string]interface{}{"data": rows})
	messages := make([]aiChatConversationMessage, 0, 30)
	for index := 0; index < 30; index++ {
		messages = append(messages, aiChatConversationMessage{Role: "user", Content: strings.Repeat("m", 5000)})
	}
	payload := codingAgentRunnerPayload{
		codingAgentJobRequest: codingAgentJobRequest{codingAgentChatRequest: codingAgentChatRequest{
			Dataset: "fixture", Query: "Why?", Mode: "code_workspace", Messages: messages}},
		BackendContext: &codingAgentBackendContext{DeterministicFilterProbe: &codingAgentFilterProbe{
			Plan: filterbarAIQueryPlan{Mode: "rows_page", Filters: map[string]string{"owner": "serlog"}}, Result: &result}},
	}
	if err := fitCodingAgentRunnerPayload(&payload); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(payload)
	if len(raw) > codingAgentRunnerRequestLimit {
		t.Fatalf("payload is %d bytes, over the runner limit", len(raw))
	}
	if payload.Query != "Why?" || payload.BackendContext.DeterministicFilterProbe.Plan.Filters["owner"] != "serlog" {
		t.Fatal("the question and the filter plan must survive fitting")
	}
	if len(payload.Messages) == 0 || len(payload.Messages) == 30 {
		t.Fatalf("only the oldest turns give way: %d kept", len(payload.Messages))
	}
}
