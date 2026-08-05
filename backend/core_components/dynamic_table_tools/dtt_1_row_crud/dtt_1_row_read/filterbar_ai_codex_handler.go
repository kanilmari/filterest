// filterbar_ai_codex_handler.go
// Exposes a DEV-only Codex-backed diagnostic path for filterbar AI chat.
// Bridges browser chat messages to the local Codex CLI without changing dataset rows.
// Exists so developers can ask code-aware questions from the app without leaving the browser.
package dtt_1_row_read

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"easelect/backend/core_components/httpresponse"
)

const (
	filterbarAICodexProvider           = "codex"
	filterbarAICodexDefaultTimeout     = 40 * time.Minute
	filterbarAICodexMaxTimeout         = 40 * time.Minute
	filterbarAICodexMaxConversation    = 24
	filterbarAICodexMaxMessageChars    = 6000
	filterbarAICodexMaxOutputTailChars = 4000
	filterbarAICodexSandboxMode        = "danger-full-access"
)

type filterbarAICodexQueryRequest struct {
	Dataset  string                      `json:"dataset"`
	Query    string                      `json:"query"`
	Lang     string                      `json:"lang,omitempty"`
	Messages []aiChatConversationMessage `json:"messages,omitempty"`
}

type filterbarAICodexQueryResponse struct {
	Dataset     string                          `json:"dataset"`
	Answer      string                          `json:"answer"`
	Mode        string                          `json:"mode"`
	DevOnly     bool                            `json:"dev_only"`
	Plan        *filterbarAIQueryPlan           `json:"plan,omitempty"`
	Result      map[string]interface{}          `json:"result,omitempty"`
	Memory      *aiChatConversationMessage      `json:"memory,omitempty"`
	Diagnostics *filterbarAICodexResponseSignal `json:"diagnostics,omitempty"`
	Usage       *filterbarAIUsageSummary        `json:"usage,omitempty"`
}

type filterbarAICodexRuntimeDiagnostics struct {
	RouteReached                 bool                         `json:"route_reached"`
	AppServerReachedFromBrowser  bool                         `json:"app_server_reached_from_browser"`
	Dataset                      string                       `json:"dataset"`
	Note                         string                       `json:"note"`
	CodexAPIPlan                 *filterbarAIQueryPlan        `json:"codex_api_plan,omitempty"`
	CodexAPIPlanSkip             string                       `json:"codex_api_plan_skip,omitempty"`
	CodexAPIPlanErr              string                       `json:"codex_api_plan_error,omitempty"`
	DeterministicFilterProbe     *filterbarAICodexFilterProbe `json:"deterministic_filter_probe,omitempty"`
	DeterministicFilterProbeSkip string                       `json:"deterministic_filter_probe_skip,omitempty"`
	DeterministicFilterProbeErr  string                       `json:"deterministic_filter_probe_error,omitempty"`
}

type filterbarAICodexFilterProbe struct {
	Mode         string                     `json:"mode"`
	CanonicalURL string                     `json:"canonical_url"`
	Source       string                     `json:"source,omitempty"`
	Plan         filterbarAIQueryPlan       `json:"plan"`
	RowsReturned int                        `json:"rows_returned"`
	Result       filterbarAIResultContext   `json:"result"`
	ResultBody   map[string]interface{}     `json:"-"`
	Memory       *aiChatConversationMessage `json:"-"`
}

type filterbarAICodexResponseSignal struct {
	DeterministicFilterProbeUsed bool   `json:"deterministic_filter_probe_used,omitempty"`
	CanonicalURL                 string `json:"canonical_url,omitempty"`
	RowsReturned                 int    `json:"rows_returned,omitempty"`
	Source                       string `json:"source,omitempty"`
}

var filterbarAICodexRunner = runFilterbarAICodexCLI
var filterbarAICodexWorkingDir = os.Getwd

// FilterbarAICodexQueryHandler lets explicit DEV-mode browser chats ask local Codex for code-aware help.
func FilterbarAICodexQueryHandler(w http.ResponseWriter, r *http.Request) {
	if strings.TrimSpace(os.Getenv("ENVIRONMENT_TYPE")) != "dev" {
		httpresponse.RespondWithError(w, http.StatusNotFound, "Codex chat is available only in DEV mode")
		return
	}
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only POST accepted")
		return
	}

	var payload filterbarAICodexQueryRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid JSON request body")
		return
	}
	payload.Dataset = strings.TrimSpace(payload.Dataset)
	payload.Query = strings.TrimSpace(payload.Query)
	if payload.Dataset == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "dataset is required")
		return
	}
	if payload.Query == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "query is required")
		return
	}

	diagnostics := buildFilterbarAICodexRuntimeDiagnostics(r, payload)
	if shouldPlanFilterbarAICodexAPIQuery(diagnostics) {
		diagnostics = enrichFilterbarAICodexDiagnosticsWithAPIPlan(r, payload, diagnostics)
	}
	prompt := buildFilterbarAICodexPrompt(payload, diagnostics)
	answer, err := filterbarAICodexRunner(r.Context(), prompt)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadGateway, err.Error())
		return
	}
	answer = strings.TrimSpace(answer)
	if answer == "" {
		answer = "Codex completed without a visible answer."
	}

	response := filterbarAICodexQueryResponse{
		Dataset: payload.Dataset,
		Answer:  answer,
		Mode:    filterbarAICodexProvider,
		DevOnly: true,
		Usage: buildFilterbarAIUnavailableUsageSummary(
			filterbarAICodexProvider,
			resolveFilterbarAICodexModelLabel(),
			"Codex CLI did not return token usage to the backend, so no 100% API cost can be calculated for this turn.",
		),
	}
	if probe := diagnostics.DeterministicFilterProbe; probe != nil {
		plan := probe.Plan
		response.Plan = &plan
		response.Result = probe.ResultBody
		response.Memory = probe.Memory
		response.Diagnostics = &filterbarAICodexResponseSignal{
			DeterministicFilterProbeUsed: true,
			CanonicalURL:                 probe.CanonicalURL,
			RowsReturned:                 probe.RowsReturned,
			Source:                       probe.Source,
		}
	}

	httpresponse.RespondWithJSON(w, http.StatusOK, response)
}

func buildFilterbarAICodexPrompt(payload filterbarAICodexQueryRequest, diagnostics filterbarAICodexRuntimeDiagnostics) string {
	messagesJSON := "[]"
	if rawMessages, err := json.MarshalIndent(trimFilterbarAICodexMessages(payload.Messages), "", "  "); err == nil {
		messagesJSON = string(rawMessages)
	}
	diagnosticsJSON := "{}"
	if rawDiagnostics, err := json.MarshalIndent(diagnostics, "", "  "); err == nil {
		diagnosticsJSON = string(rawDiagnostics)
	}

	var builder strings.Builder
	builder.WriteString("You are Codex helping from inside the Easelect DEV filterbar AI chat.\n")
	builder.WriteString("Answer the user's current question using the visible conversation, hidden result-context messages, repository inspection, and repository file edits when useful.\n")
	builder.WriteString("Hard rules:\n")
	builder.WriteString("- This is a DEV-only route with filesystem write access. You may edit repository files when the user asks for implementation or fixes.\n")
	builder.WriteString("- Follow AGENTS.md, README.md, the Constitution, and DEV_GUIDE.md before changing project files.\n")
	builder.WriteString("- Do not run CREATE, ALTER, UPDATE, INSERT, DELETE, or DROP.\n")
	builder.WriteString("- Direct SQL, if absolutely needed, must be read-only SELECT via the project wrapper.\n")
	builder.WriteString("- Prefer application APIs and project wrappers over direct database access.\n")
	builder.WriteString("- After backend server-code changes, restart the native dev server with ./ctl before asking the user to test.\n")
	builder.WriteString("- Prefer diagnosing the app/API/tooling problem over suggesting another ordinary catalog search.\n")
	builder.WriteString("- This request reached the running Easelect backend route, so the app server is up from the browser's point of view.\n")
	builder.WriteString("- If localhost HTTP or DB commands fail inside Codex, treat that as a Codex runtime/environment limitation, not proof that Easelect is down.\n")
	builder.WriteString("- Prefer the backend-collected runtime diagnostics below over trying curl localhost from inside Codex.\n")
	builder.WriteString("- If deterministic_filter_probe has rows_returned greater than zero, treat that as the current canonical API result and do not claim the search returned zero rows.\n")
	builder.WriteString("- If codex_api_plan or deterministic_filter_probe is present, the backend has already validated and executed a canonical API read action for this chat turn.\n")
	builder.WriteString("- Keep shell probes short; prefer code inspection, backend diagnostics, and provided result-context over long live checks.\n")
	builder.WriteString("- If a code change is likely needed, name the likely files and the smallest next fix.\n")
	builder.WriteString("- Keep the answer concise and use the user's language when clear.\n\n")
	builder.WriteString(fmt.Sprintf("Dataset: %s\n", payload.Dataset))
	if lang := strings.TrimSpace(payload.Lang); lang != "" {
		builder.WriteString(fmt.Sprintf("UI language: %s\n", lang))
	}
	builder.WriteString("\nBackend-collected runtime diagnostics JSON:\n")
	builder.WriteString(diagnosticsJSON)
	builder.WriteString("\nConversation messages JSON:\n")
	builder.WriteString(messagesJSON)
	builder.WriteString("\n\nCurrent user message:\n")
	builder.WriteString(payload.Query)
	builder.WriteString("\n")
	return builder.String()
}

func buildFilterbarAICodexRuntimeDiagnostics(original *http.Request, payload filterbarAICodexQueryRequest) filterbarAICodexRuntimeDiagnostics {
	diagnostics := filterbarAICodexRuntimeDiagnostics{
		RouteReached:                true,
		AppServerReachedFromBrowser: true,
		Dataset:                     payload.Dataset,
		Note:                        "Collected by the Easelect backend before launching Codex CLI; use this when Codex runtime localhost probes fail.",
	}

	probeText := buildFilterbarAICodexProbeText(payload)
	if strings.TrimSpace(probeText) == "" {
		diagnostics.DeterministicFilterProbeSkip = "no user query text available for deterministic API filter probing"
		return diagnostics
	}

	columns, err := filterbarAIColumnsReader(payload.Dataset)
	if err != nil {
		diagnostics.DeterministicFilterProbeErr = err.Error()
		return diagnostics
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
			diagnostics.DeterministicFilterProbeErr = fallbackErr.Error()
			return diagnostics
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
		addFilterbarAICodexOwnerHiddenFilterColumns(columnSet)
		filters, _ = extractFilterbarAIColumnFilters(probeText, columnSet)
	}
	if len(filters) == 0 {
		if strings.Contains(probeText, ":") {
			diagnostics.DeterministicFilterProbeSkip = "field:value text was present, but none of the fields matched dataset columns or aliases"
			return diagnostics
		}
		diagnostics.DeterministicFilterProbeSkip = "no exact field:value token could be mapped to canonical API filters"
		return diagnostics
	}

	plannerResponse := filterbarAIPlannerResponse{
		Plan: filterbarAIQueryPlan{
			Mode:    "rows_page",
			UsesSQL: false,
			Filters: filters,
		},
	}
	probe, err := executeFilterbarAICodexProbeFromPlanner(original, payload, plannerResponse, "exact_field_filter")
	if err != nil {
		diagnostics.DeterministicFilterProbeErr = err.Error()
		return diagnostics
	}
	diagnostics.DeterministicFilterProbe = probe
	return diagnostics
}

func addFilterbarAICodexOwnerHiddenFilterColumns(columnSet map[string]struct{}) {
	for _, columnName := range []string{"cached_username", "user_id"} {
		if strings.TrimSpace(columnName) != "" {
			columnSet[columnName] = struct{}{}
		}
	}
}

func shouldPlanFilterbarAICodexAPIQuery(diagnostics filterbarAICodexRuntimeDiagnostics) bool {
	return diagnostics.DeterministicFilterProbe == nil &&
		diagnostics.DeterministicFilterProbeErr == ""
}

func enrichFilterbarAICodexDiagnosticsWithAPIPlan(original *http.Request, payload filterbarAICodexQueryRequest, diagnostics filterbarAICodexRuntimeDiagnostics) filterbarAICodexRuntimeDiagnostics {
	columnNames, err := loadFilterbarAICodexPlannerColumnNames(payload.Dataset)
	if err != nil {
		diagnostics.CodexAPIPlanErr = err.Error()
		return diagnostics
	}
	if len(columnNames) == 0 {
		diagnostics.CodexAPIPlanSkip = "no dataset columns available for Codex API planning"
		return diagnostics
	}

	plannerResponse, err := planFilterbarAICodexAPIQuery(original.Context(), payload, columnNames)
	if err != nil {
		diagnostics.CodexAPIPlanErr = err.Error()
		return diagnostics
	}
	plan := plannerResponse.Plan
	diagnostics.CodexAPIPlan = &plan
	if plan.Mode == "answer_only" {
		diagnostics.CodexAPIPlanSkip = "Codex API planner chose answer_only"
		return diagnostics
	}

	probe, err := executeFilterbarAICodexProbeFromPlanner(original, payload, plannerResponse, "codex_api_plan")
	if err != nil {
		diagnostics.CodexAPIPlanErr = err.Error()
		return diagnostics
	}
	diagnostics.DeterministicFilterProbe = probe
	return diagnostics
}

func loadFilterbarAICodexPlannerColumnNames(dataset string) ([]string, error) {
	columns, err := filterbarAIColumnsReader(dataset)
	if err != nil {
		return nil, err
	}
	columnSet := make(map[string]struct{})
	for _, columnName := range extractFilterbarAIColumnNames(columns) {
		if strings.TrimSpace(columnName) != "" {
			columnSet[columnName] = struct{}{}
		}
	}
	if fallbackColumnNames, err := filterbarAIFilterableColumnsReader(dataset); err == nil {
		for _, columnName := range fallbackColumnNames {
			columnName = strings.TrimSpace(columnName)
			if columnName != "" {
				columnSet[columnName] = struct{}{}
			}
		}
	}
	addFilterbarAICodexOwnerHiddenFilterColumns(columnSet)

	columnNames := make([]string, 0, len(columnSet))
	for columnName := range columnSet {
		columnNames = append(columnNames, columnName)
	}
	sort.Strings(columnNames)
	return columnNames, nil
}

func planFilterbarAICodexAPIQuery(ctx context.Context, payload filterbarAICodexQueryRequest, columnNames []string) (filterbarAIPlannerResponse, error) {
	prompt, err := buildFilterbarAICodexAPIPlanPrompt(payload, columnNames)
	if err != nil {
		return filterbarAIPlannerResponse{}, err
	}
	rawAnswer, err := filterbarAICodexRunner(ctx, prompt)
	if err != nil {
		return filterbarAIPlannerResponse{}, fmt.Errorf("Codex API planner failed: %w", err)
	}
	rawJSON := extractFilterbarAIJSONResponse(rawAnswer)

	var plannerPayload filterbarAILLMPlannerPayload
	if err := json.Unmarshal([]byte(rawJSON), &plannerPayload); err != nil {
		return filterbarAIPlannerResponse{}, fmt.Errorf("%w: Codex API planner returned invalid JSON: %v", errFilterbarAIInvalidPlannerResult, err)
	}
	return validateFilterbarAIPlannerPayload(plannerPayload, columnNames)
}

func buildFilterbarAICodexAPIPlanPrompt(payload filterbarAICodexQueryRequest, columnNames []string) (string, error) {
	columnNamesJSON, err := json.Marshal(columnNames)
	if err != nil {
		return "", fmt.Errorf("failed to encode Codex API planner columns: %w", err)
	}
	messagesJSON, err := json.Marshal(trimFilterbarAICodexMessages(payload.Messages))
	if err != nil {
		return "", fmt.Errorf("failed to encode Codex API planner messages: %w", err)
	}

	return strings.TrimSpace(fmt.Sprintf(`
You are Codex selecting one Easelect filterbar API read action from inside DEV chat.

Return one JSON object only. No markdown and no commentary.
For this API-read planning step only, do not edit files, write SQL, or call shell commands.

Dataset: %s
Available dataset/filter columns: %s
Recent conversation messages JSON: %s
Latest user request: %s

Allowed JSON shape:
{
  "mode": "rows_page | text_search | answer_only",
  "answer": "short draft in the user's language",
  "search_query": "optional text search string",
  "filters": {"exact_column_or_range_key": "filter value"},
  "sort_column": "optional exact column name",
  "sort_order": "optional ASC or DESC",
  "apply_as_sort": false,
  "offset": 0
}

Planning rules:
- Use "rows_page" for normal table browsing, exact filters, date/id ranges, and sorted reads.
- Use "text_search" only when the user asks for broad textual/semantic search and no exact field filter is better.
- Use "answer_only" only when no dataset read should be performed.
- Filters must use exact available columns, or range keys ending in "_from" or "_to" when the base column is available.
- Owner/user phrases should become filters, for example "serlog-käyttäjän palvelut" => {"filters":{"cached_username":"serlog"}} when cached_username is available.
- Field-specific searches should become filters, for example "header sisältää Serlog" => {"filters":{"header":"Serlog"}}.
- Date/id periods should become range filters, for example {"filters":{"created_from":"2026-05-01","created_to":"2026-05-06"}} or {"filters":{"id_from":"100","id_to":"200"}} when those base columns exist.
- For newest/latest/recent, sort by the best existing timestamp or id column DESC. For oldest/earliest, use ASC.
- Do not include "row_count"; the API computes the real total count.
`, payload.Dataset, string(columnNamesJSON), string(messagesJSON), strconv.Quote(strings.TrimSpace(payload.Query)))), nil
}

func executeFilterbarAICodexProbeFromPlanner(original *http.Request, payload filterbarAICodexQueryRequest, plannerResponse filterbarAIPlannerResponse, source string) (*filterbarAICodexFilterProbe, error) {
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
	memory := buildFilterbarAIResultMemory(resultContext)
	return &filterbarAICodexFilterProbe{
		Mode:         mode,
		CanonicalURL: delegateReq.URL.RequestURI(),
		Source:       source,
		Plan:         plannerResponse.Plan,
		RowsReturned: countFilterbarAIResultRows(result),
		Result:       resultContext,
		ResultBody:   result,
		Memory:       memory,
	}, nil
}

func buildFilterbarAICodexProbeText(payload filterbarAICodexQueryRequest) string {
	parts := []string{strings.TrimSpace(payload.Query)}
	for _, message := range trimFilterbarAICodexMessages(payload.Messages) {
		if message.Role != "user" {
			continue
		}
		if content := strings.TrimSpace(message.Content); content != "" {
			parts = append(parts, content)
		}
	}
	return strings.Join(parts, "\n")
}

func trimFilterbarAICodexMessages(messages []aiChatConversationMessage) []aiChatConversationMessage {
	if len(messages) == 0 {
		return []aiChatConversationMessage{}
	}
	start := 0
	if len(messages) > filterbarAICodexMaxConversation {
		start = len(messages) - filterbarAICodexMaxConversation
	}

	trimmed := make([]aiChatConversationMessage, 0, len(messages)-start)
	for _, message := range messages[start:] {
		role := strings.TrimSpace(message.Role)
		content := strings.TrimSpace(message.Content)
		if role == "" || content == "" {
			continue
		}
		if len([]rune(content)) > filterbarAICodexMaxMessageChars {
			runes := []rune(content)
			content = string(runes[:filterbarAICodexMaxMessageChars]) + "\n[truncated]"
		}
		trimmed = append(trimmed, aiChatConversationMessage{
			Role:    role,
			Content: content,
		})
	}
	return trimmed
}

func runFilterbarAICodexCLI(ctx context.Context, prompt string) (string, error) {
	timeout := resolveFilterbarAICodexTimeout()
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	outputFile, err := os.CreateTemp("", "easelect-codex-chat-*.txt")
	if err != nil {
		return "", fmt.Errorf("could not create Codex output file: %w", err)
	}
	outputPath := outputFile.Name()
	_ = outputFile.Close()
	defer os.Remove(outputPath)

	commandName, commandArgs := resolveFilterbarAICodexCommand()
	workingDir, err := filterbarAICodexWorkingDir()
	if err != nil || strings.TrimSpace(workingDir) == "" {
		workingDir = "."
	}
	args := buildFilterbarAICodexExecArgs(commandArgs, workingDir, outputPath)

	cmd := exec.CommandContext(runCtx, commandName, args...)
	cmd.Dir = workingDir
	cmd.Stdin = strings.NewReader(prompt)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err = cmd.Run()
	if errors.Is(runCtx.Err(), context.DeadlineExceeded) {
		return "", fmt.Errorf("Codex timed out after %s", timeout)
	}
	if rawAnswer, readErr := os.ReadFile(outputPath); readErr == nil {
		if answer := strings.TrimSpace(string(rawAnswer)); answer != "" {
			return answer, nil
		}
	}
	if err != nil {
		return "", fmt.Errorf("Codex command failed: %w%s", err, formatFilterbarAICodexOutputTail(stdout.String(), stderr.String()))
	}
	if answer := strings.TrimSpace(stdout.String()); answer != "" {
		return answer, nil
	}
	return "", nil
}

func buildFilterbarAICodexExecArgs(commandArgs []string, workingDir string, outputPath string) []string {
	args := append([]string{}, commandArgs...)
	args = append(args,
		"exec",
		"--sandbox", filterbarAICodexSandboxMode,
		"-c", `approval_policy="never"`,
		"--ephemeral",
		"--color", "never",
		"--cd", workingDir,
		"--output-last-message", outputPath,
		"-",
	)
	return args
}

func resolveFilterbarAICodexCommand() (string, []string) {
	configured := strings.Fields(strings.TrimSpace(os.Getenv("FILTERBAR_AI_CODEX_COMMAND")))
	if len(configured) > 0 {
		return configured[0], configured[1:]
	}
	return "npx", []string{"@openai/codex"}
}

func resolveFilterbarAICodexModelLabel() string {
	if modelName := strings.TrimSpace(os.Getenv("FILTERBAR_AI_CODEX_MODEL")); modelName != "" {
		return modelName
	}

	commandParts := strings.Fields(strings.TrimSpace(os.Getenv("FILTERBAR_AI_CODEX_COMMAND")))
	for index, part := range commandParts {
		if (part == "--model" || part == "-m") && index+1 < len(commandParts) {
			if modelName := strings.TrimSpace(commandParts[index+1]); modelName != "" {
				return modelName
			}
		}
		if strings.HasPrefix(part, "--model=") {
			if modelName := strings.TrimSpace(strings.TrimPrefix(part, "--model=")); modelName != "" {
				return modelName
			}
		}
	}
	return "Codex CLI"
}

func resolveFilterbarAICodexTimeout() time.Duration {
	raw := strings.TrimSpace(os.Getenv("FILTERBAR_AI_CODEX_TIMEOUT_SECONDS"))
	if raw == "" {
		return filterbarAICodexDefaultTimeout
	}
	seconds, err := strconv.Atoi(raw)
	if err != nil || seconds < 10 {
		return filterbarAICodexDefaultTimeout
	}
	if time.Duration(seconds)*time.Second > filterbarAICodexMaxTimeout {
		return filterbarAICodexMaxTimeout
	}
	return time.Duration(seconds) * time.Second
}

func formatFilterbarAICodexOutputTail(stdoutText string, stderrText string) string {
	combined := strings.TrimSpace(strings.Join([]string{stdoutText, stderrText}, "\n"))
	if combined == "" {
		return ""
	}
	combined = filepath.ToSlash(combined)
	runes := []rune(combined)
	if len(runes) > filterbarAICodexMaxOutputTailChars {
		combined = string(runes[len(runes)-filterbarAICodexMaxOutputTailChars:])
	}
	return ": " + combined
}
