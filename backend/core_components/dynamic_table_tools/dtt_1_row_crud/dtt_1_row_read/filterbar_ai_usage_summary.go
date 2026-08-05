// filterbar_ai_usage_summary.go
// Builds dev-visible AI usage and cost summaries for filterbar chat replies.
// Bridges provider token usage objects, model pricing, and the browser chat metadata contract.
// Exists so API cost inspection stays backend-owned instead of being guessed in the UI.
package dtt_1_row_read

import (
	"math"
	"os"
	"strings"

	"github.com/sashabaranov/go-openai"
)

const (
	filterbarAIUsageProviderOpenAI = "openai"
	filterbarAIUSDPerMillion       = 1000000.0
)

type filterbarAIUsageSummary struct {
	Provider          string                 `json:"provider,omitempty"`
	Model             string                 `json:"model,omitempty"`
	Effort            string                 `json:"effort,omitempty"`
	InputTokens       int                    `json:"input_tokens,omitempty"`
	CachedInputTokens int                    `json:"cached_input_tokens,omitempty"`
	OutputTokens      int                    `json:"output_tokens,omitempty"`
	ReasoningTokens   int                    `json:"reasoning_tokens,omitempty"`
	TotalTokens       int                    `json:"total_tokens,omitempty"`
	CostUSD           float64                `json:"cost_usd,omitempty"`
	Estimated         bool                   `json:"estimated,omitempty"`
	PricingNote       string                 `json:"pricing_note,omitempty"`
	Calls             []filterbarAIUsageCall `json:"calls,omitempty"`
}

type filterbarAIUsageCall struct {
	Label             string  `json:"label,omitempty"`
	Provider          string  `json:"provider,omitempty"`
	Model             string  `json:"model,omitempty"`
	Effort            string  `json:"effort,omitempty"`
	InputTokens       int     `json:"input_tokens,omitempty"`
	CachedInputTokens int     `json:"cached_input_tokens,omitempty"`
	OutputTokens      int     `json:"output_tokens,omitempty"`
	ReasoningTokens   int     `json:"reasoning_tokens,omitempty"`
	TotalTokens       int     `json:"total_tokens,omitempty"`
	CostUSD           float64 `json:"cost_usd,omitempty"`
	Estimated         bool    `json:"estimated,omitempty"`
	PricingNote       string  `json:"pricing_note,omitempty"`
}

type filterbarAIModelPricing struct {
	InputUSDPerMillion       float64
	CachedInputUSDPerMillion float64
	OutputUSDPerMillion      float64
	Note                     string
}

func resolveFilterbarAIOpenAIEffort() string {
	for _, envName := range []string{"OPENAI_API_EFFORT", "OPENAI_REASONING_EFFORT"} {
		value := strings.TrimSpace(os.Getenv(envName))
		if value != "" {
			return value
		}
	}
	return "default"
}

func buildFilterbarAIOpenAIUsageCall(label string, modelName string, effort string, usage openai.Usage) filterbarAIUsageCall {
	cachedInputTokens := 0
	if usage.PromptTokensDetails != nil {
		cachedInputTokens = usage.PromptTokensDetails.CachedTokens
	}
	reasoningTokens := 0
	if usage.CompletionTokensDetails != nil {
		reasoningTokens = usage.CompletionTokensDetails.ReasoningTokens
	}
	totalTokens := usage.TotalTokens
	if totalTokens <= 0 {
		totalTokens = usage.PromptTokens + usage.CompletionTokens
	}

	call := filterbarAIUsageCall{
		Label:             strings.TrimSpace(label),
		Provider:          filterbarAIUsageProviderOpenAI,
		Model:             strings.TrimSpace(modelName),
		Effort:            strings.TrimSpace(effort),
		InputTokens:       maxFilterbarAIUsageInt(0, usage.PromptTokens),
		CachedInputTokens: maxFilterbarAIUsageInt(0, cachedInputTokens),
		OutputTokens:      maxFilterbarAIUsageInt(0, usage.CompletionTokens),
		ReasoningTokens:   maxFilterbarAIUsageInt(0, reasoningTokens),
		TotalTokens:       maxFilterbarAIUsageInt(0, totalTokens),
	}

	pricing, ok := resolveFilterbarAIModelPricing(call.Provider, call.Model)
	if !ok {
		call.PricingNote = "No standard pricing row is configured for this model."
		return call
	}

	billableInputTokens := maxFilterbarAIUsageInt(0, call.InputTokens-call.CachedInputTokens)
	call.CostUSD = roundFilterbarAIUsageCost(
		(float64(billableInputTokens)*pricing.InputUSDPerMillion +
			float64(call.CachedInputTokens)*pricing.CachedInputUSDPerMillion +
			float64(call.OutputTokens)*pricing.OutputUSDPerMillion) / filterbarAIUSDPerMillion,
	)
	call.PricingNote = pricing.Note
	return call
}

func buildFilterbarAIUsageSummary(calls []filterbarAIUsageCall) *filterbarAIUsageSummary {
	normalizedCalls := make([]filterbarAIUsageCall, 0, len(calls))
	for _, call := range calls {
		call.Provider = strings.TrimSpace(call.Provider)
		call.Model = strings.TrimSpace(call.Model)
		if call.Provider == "" && call.Model == "" && call.TotalTokens == 0 && strings.TrimSpace(call.PricingNote) == "" {
			continue
		}
		normalizedCalls = append(normalizedCalls, call)
	}
	if len(normalizedCalls) == 0 {
		return nil
	}

	summary := &filterbarAIUsageSummary{
		Provider: normalizedCalls[0].Provider,
		Model:    normalizedCalls[0].Model,
		Effort:   normalizedCalls[0].Effort,
		Calls:    normalizedCalls,
	}
	pricingNotes := make([]string, 0, len(normalizedCalls))
	for _, call := range normalizedCalls {
		if call.Provider != summary.Provider {
			summary.Provider = "mixed"
		}
		if call.Model != summary.Model {
			summary.Model = "mixed"
		}
		if call.Effort != summary.Effort {
			summary.Effort = "mixed"
		}
		summary.InputTokens += call.InputTokens
		summary.CachedInputTokens += call.CachedInputTokens
		summary.OutputTokens += call.OutputTokens
		summary.ReasoningTokens += call.ReasoningTokens
		summary.TotalTokens += call.TotalTokens
		summary.CostUSD += call.CostUSD
		summary.Estimated = summary.Estimated || call.Estimated
		if note := strings.TrimSpace(call.PricingNote); note != "" && !containsFilterbarAIUsageString(pricingNotes, note) {
			pricingNotes = append(pricingNotes, note)
		}
	}
	summary.CostUSD = roundFilterbarAIUsageCost(summary.CostUSD)
	summary.PricingNote = strings.Join(pricingNotes, " ")
	return summary
}

func mergeFilterbarAIUsageSummaries(summaries ...*filterbarAIUsageSummary) *filterbarAIUsageSummary {
	calls := []filterbarAIUsageCall{}
	for _, summary := range summaries {
		if summary == nil {
			continue
		}
		if len(summary.Calls) > 0 {
			calls = append(calls, summary.Calls...)
			continue
		}
		calls = append(calls, filterbarAIUsageCall{
			Provider:          summary.Provider,
			Model:             summary.Model,
			Effort:            summary.Effort,
			InputTokens:       summary.InputTokens,
			CachedInputTokens: summary.CachedInputTokens,
			OutputTokens:      summary.OutputTokens,
			ReasoningTokens:   summary.ReasoningTokens,
			TotalTokens:       summary.TotalTokens,
			CostUSD:           summary.CostUSD,
			Estimated:         summary.Estimated,
			PricingNote:       summary.PricingNote,
		})
	}
	return buildFilterbarAIUsageSummary(calls)
}

func buildFilterbarAIUnavailableUsageSummary(provider string, model string, note string) *filterbarAIUsageSummary {
	provider = strings.TrimSpace(provider)
	model = strings.TrimSpace(model)
	note = strings.TrimSpace(note)
	if provider == "" && model == "" && note == "" {
		return nil
	}
	return &filterbarAIUsageSummary{
		Provider:    provider,
		Model:       model,
		PricingNote: note,
	}
}

func resolveFilterbarAIModelPricing(provider string, modelName string) (filterbarAIModelPricing, bool) {
	provider = strings.ToLower(strings.TrimSpace(provider))
	modelName = strings.ToLower(strings.TrimSpace(modelName))

	if provider == filterbarAIUsageProviderOpenAI {
		switch {
		case strings.Contains(modelName, "gpt-5.5"):
			return filterbarAIModelPricing{
				InputUSDPerMillion:       5.00,
				CachedInputUSDPerMillion: 0.50,
				OutputUSDPerMillion:      30.00,
				Note:                     "OpenAI standard token pricing; excludes batch, priority, regional, long-context, and tool-call adjustments.",
			}, true
		case strings.Contains(modelName, "gpt-5.4-mini") || strings.Contains(modelName, "gpt-5.4 mini"):
			return filterbarAIModelPricing{
				InputUSDPerMillion:       0.75,
				CachedInputUSDPerMillion: 0.075,
				OutputUSDPerMillion:      4.50,
				Note:                     "OpenAI standard token pricing; excludes batch, priority, regional, long-context, and tool-call adjustments.",
			}, true
		case strings.Contains(modelName, "gpt-5.4"):
			return filterbarAIModelPricing{
				InputUSDPerMillion:       2.50,
				CachedInputUSDPerMillion: 0.25,
				OutputUSDPerMillion:      15.00,
				Note:                     "OpenAI standard token pricing; excludes batch, priority, regional, long-context, and tool-call adjustments.",
			}, true
		}
	}

	if provider == "anthropic" {
		switch {
		case strings.Contains(modelName, "opus-4.1") || strings.Contains(modelName, "opus-4-1") || strings.Contains(modelName, "opus-4"):
			return filterbarAIModelPricing{
				InputUSDPerMillion:       15.00,
				CachedInputUSDPerMillion: 1.50,
				OutputUSDPerMillion:      75.00,
				Note:                     "Anthropic standard token pricing; excludes batch, cache-write, long-context, and tool-call adjustments.",
			}, true
		case strings.Contains(modelName, "sonnet-4") || strings.Contains(modelName, "sonnet-3.7"):
			return filterbarAIModelPricing{
				InputUSDPerMillion:       3.00,
				CachedInputUSDPerMillion: 0.30,
				OutputUSDPerMillion:      15.00,
				Note:                     "Anthropic standard token pricing; excludes batch, cache-write, long-context, and tool-call adjustments.",
			}, true
		case strings.Contains(modelName, "haiku-3.5"):
			return filterbarAIModelPricing{
				InputUSDPerMillion:       0.80,
				CachedInputUSDPerMillion: 0.08,
				OutputUSDPerMillion:      4.00,
				Note:                     "Anthropic standard token pricing; excludes batch, cache-write, long-context, and tool-call adjustments.",
			}, true
		case strings.Contains(modelName, "haiku-3"):
			return filterbarAIModelPricing{
				InputUSDPerMillion:       0.25,
				CachedInputUSDPerMillion: 0.03,
				OutputUSDPerMillion:      1.25,
				Note:                     "Anthropic standard token pricing; excludes batch, cache-write, long-context, and tool-call adjustments.",
			}, true
		}
	}

	return filterbarAIModelPricing{}, false
}

func roundFilterbarAIUsageCost(value float64) float64 {
	if value <= 0 || math.IsNaN(value) || math.IsInf(value, 0) {
		return 0
	}
	return math.Round(value*100000000) / 100000000
}

func maxFilterbarAIUsageInt(minimum int, value int) int {
	if value < minimum {
		return minimum
	}
	return value
}

func containsFilterbarAIUsageString(values []string, candidate string) bool {
	for _, value := range values {
		if value == candidate {
			return true
		}
	}
	return false
}
