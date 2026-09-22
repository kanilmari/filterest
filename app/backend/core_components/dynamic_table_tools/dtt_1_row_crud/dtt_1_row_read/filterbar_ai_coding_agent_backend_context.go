// filterbar_ai_coding_agent_backend_context.go
// Collects the running application's own view of a code-workspace chat turn.
// Bridges the chat request, the canonical dataset read API and the runner's job request.
// Exists so Codex starts from the real API result without a second model call or its own localhost probes.
package dtt_1_row_read

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

// codingAgentRunnerRequestLimit keeps one runner request under the runner's
// 128 KiB acceptance limit, with room for the socket's HTTP framing.
const codingAgentRunnerRequestLimit = 120 * 1024

// codingAgentBackendContextResultLimit bounds the probe's result rows inside
// the context; the plan and row count always fit.
const codingAgentBackendContextResultLimit = 24 * 1024

// codingAgentBackendContext is what the application knew before the job began.
type codingAgentBackendContext struct {
	RouteReached                 bool                    `json:"route_reached"`
	AppServerReachedFromBrowser  bool                    `json:"app_server_reached_from_browser"`
	Dataset                      string                  `json:"dataset"`
	Note                         string                  `json:"note"`
	DeterministicFilterProbe     *codingAgentFilterProbe `json:"deterministic_filter_probe,omitempty"`
	DeterministicFilterProbeSkip string                  `json:"deterministic_filter_probe_skip,omitempty"`
	DeterministicFilterProbeErr  string                  `json:"deterministic_filter_probe_error,omitempty"`
}

// codingAgentFilterProbe is one canonical API read derived without a model.
type codingAgentFilterProbe struct {
	Mode         string                    `json:"mode"`
	CanonicalURL string                    `json:"canonical_url"`
	Source       string                    `json:"source,omitempty"`
	Plan         filterbarAIQueryPlan      `json:"plan"`
	RowsReturned int                       `json:"rows_returned"`
	Result       *filterbarAIResultContext `json:"result,omitempty"`
}

// buildCodingAgentBackendContext maps exact field:value text in the question
// to the dataset's canonical filters and runs that read as the asking
// administrator. It replaces the old second Codex planning call.
func buildCodingAgentBackendContext(original *http.Request, payload codingAgentChatRequest) codingAgentBackendContext {
	context := codingAgentBackendContext{
		RouteReached:                true,
		AppServerReachedFromBrowser: true,
		Dataset:                     payload.Dataset,
		Note:                        "Collected by the running application before the job started; prefer it over localhost probes.",
	}

	probeText := buildCodingAgentProbeText(payload)
	if strings.TrimSpace(probeText) == "" {
		context.DeterministicFilterProbeSkip = "no user query text available for deterministic API filter probing"
		return context
	}

	columns, err := filterbarAIColumnsReader(payload.Dataset)
	if err != nil {
		context.DeterministicFilterProbeErr = err.Error()
		return context
	}
	columnNames := extractFilterbarAIColumnNames(columns)
	columnSet := make(map[string]struct{}, len(columnNames))
	for _, columnName := range columnNames {
		columnSet[columnName] = struct{}{}
	}
	filters, _ := extractFilterbarAIColumnFilters(probeText, columnSet)
	if len(filters) == 0 {
		fallbackColumnNames, fallbackErr := filterbarAIFilterableColumnsReader(payload.Dataset)
		if fallbackErr != nil {
			context.DeterministicFilterProbeErr = fallbackErr.Error()
			return context
		}
		for _, columnName := range fallbackColumnNames {
			columnName = strings.TrimSpace(columnName)
			if columnName != "" {
				columnSet[columnName] = struct{}{}
			}
		}
		filters, _ = extractFilterbarAIColumnFilters(probeText, columnSet)
	}
	if len(filters) == 0 {
		addCodingAgentOwnerHiddenFilterColumns(columnSet)
		filters, _ = extractFilterbarAIColumnFilters(probeText, columnSet)
	}
	if len(filters) == 0 {
		if strings.Contains(probeText, ":") {
			context.DeterministicFilterProbeSkip = "field:value text was present, but none of the fields matched dataset columns or aliases"
			return context
		}
		context.DeterministicFilterProbeSkip = "no exact field:value token could be mapped to canonical API filters"
		return context
	}

	plannerResponse := filterbarAIPlannerResponse{
		Plan: filterbarAIQueryPlan{
			Mode:    "rows_page",
			UsesSQL: false,
			Filters: filters,
		},
	}
	probe, err := executeCodingAgentFilterProbe(original, payload, plannerResponse, "exact_field_filter")
	if err != nil {
		context.DeterministicFilterProbeErr = err.Error()
		return context
	}
	context.DeterministicFilterProbe = probe
	return context
}

// addCodingAgentOwnerHiddenFilterColumns lets "user: name" questions filter by
// row owner even when the owner columns are hidden from the dataset view.
func addCodingAgentOwnerHiddenFilterColumns(columnSet map[string]struct{}) {
	for _, columnName := range []string{"cached_username", "user_id"} {
		columnSet[columnName] = struct{}{}
	}
}

// executeCodingAgentFilterProbe runs the planned read through the same
// delegate the API AI chat uses, with the asking administrator's rights.
func executeCodingAgentFilterProbe(original *http.Request, payload codingAgentChatRequest, plannerResponse filterbarAIPlannerResponse, source string) (*codingAgentFilterProbe, error) {
	queryPayload := filterbarAIQueryRequest{
		Dataset: payload.Dataset,
		Query:   payload.Query,
		Lang:    payload.Lang,
	}
	delegateReq, canonicalPath, mode, err := buildFilterbarAIDelegateRequestFromPlanner(original, queryPayload, plannerResponse)
	if err != nil {
		return nil, err
	}
	result, err := executeFilterbarAIDelegate(mode, delegateReq)
	if err != nil {
		return nil, err
	}
	plannerResponse.Plan.Mode = mode
	plannerResponse.Plan.CanonicalPath = canonicalPath
	resultContext := buildFilterbarAIResultContext(payload.Dataset, plannerResponse.Plan, result)
	return &codingAgentFilterProbe{
		Mode:         mode,
		CanonicalURL: delegateReq.URL.RequestURI(),
		Source:       source,
		Plan:         plannerResponse.Plan,
		RowsReturned: countFilterbarAIResultRows(result),
		Result:       &resultContext,
	}, nil
}

// buildCodingAgentProbeText joins the question with the earlier user turns, so
// a filter named a few messages ago still applies.
func buildCodingAgentProbeText(payload codingAgentChatRequest) string {
	parts := []string{strings.TrimSpace(payload.Query)}
	for _, message := range trimCodingAgentMessages(payload.Messages) {
		if message.Role != "user" {
			continue
		}
		if content := strings.TrimSpace(message.Content); content != "" {
			parts = append(parts, content)
		}
	}
	return strings.Join(parts, "\n")
}

// fitCodingAgentRunnerPayload keeps a job request within the runner's size
// limit: first the probe's rows give way, then the oldest conversation turns.
// The question itself and the filter plan are never dropped.
func fitCodingAgentRunnerPayload(payload *codingAgentRunnerPayload) error {
	if context := payload.BackendContext; context != nil && context.DeterministicFilterProbe != nil {
		if raw, err := json.Marshal(context.DeterministicFilterProbe.Result); err == nil && len(raw) > codingAgentBackendContextResultLimit {
			context.DeterministicFilterProbe.Result = nil
		}
	}
	for {
		raw, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		if len(raw) <= codingAgentRunnerRequestLimit {
			return nil
		}
		if context := payload.BackendContext; context != nil && context.DeterministicFilterProbe != nil &&
			context.DeterministicFilterProbe.Result != nil {
			context.DeterministicFilterProbe.Result = nil
			continue
		}
		if len(payload.Messages) == 0 {
			return errors.New("the question is too large for one job")
		}
		payload.Messages = payload.Messages[1:]
	}
}
