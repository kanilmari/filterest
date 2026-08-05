// filterbar_ai_usage_summary_test.go
// Verifies filterbar AI token usage and cost summaries.
// Bridges provider response usage objects and the dev-visible chat cost metadata.
// Exists so price math stays explicit when model pricing changes.
package dtt_1_row_read

import (
	"testing"

	"github.com/sashabaranov/go-openai"
)

func TestBuildFilterbarAIOpenAIUsageCallPricesCachedAndOutputTokens(t *testing.T) {
	call := buildFilterbarAIOpenAIUsageCall("answer", "gpt-5.5", "high", openai.Usage{
		PromptTokens:     1000,
		CompletionTokens: 200,
		TotalTokens:      1200,
		PromptTokensDetails: &openai.PromptTokensDetails{
			CachedTokens: 100,
		},
		CompletionTokensDetails: &openai.CompletionTokensDetails{
			ReasoningTokens: 40,
		},
	})

	if call.Provider != filterbarAIUsageProviderOpenAI {
		t.Fatalf("Provider = %q, want openai", call.Provider)
	}
	if call.Model != "gpt-5.5" {
		t.Fatalf("Model = %q, want gpt-5.5", call.Model)
	}
	if call.Effort != "high" {
		t.Fatalf("Effort = %q, want high", call.Effort)
	}
	if call.InputTokens != 1000 || call.CachedInputTokens != 100 || call.OutputTokens != 200 || call.TotalTokens != 1200 {
		t.Fatalf("token counts = %#v, want prompt/cache/output/total populated", call)
	}
	if call.ReasoningTokens != 40 {
		t.Fatalf("ReasoningTokens = %d, want 40", call.ReasoningTokens)
	}
	if call.CostUSD != 0.01055 {
		t.Fatalf("CostUSD = %.8f, want 0.01055", call.CostUSD)
	}
}

func TestBuildFilterbarAIUsageSummaryMergesPlannerAndAnswerCalls(t *testing.T) {
	summary := buildFilterbarAIUsageSummary([]filterbarAIUsageCall{
		{
			Label:        "planner",
			Provider:     "openai",
			Model:        "gpt-5.5",
			Effort:       "default",
			InputTokens:  100,
			OutputTokens: 10,
			TotalTokens:  110,
			CostUSD:      0.0008,
		},
		{
			Label:        "answer",
			Provider:     "openai",
			Model:        "gpt-5.5",
			Effort:       "default",
			InputTokens:  200,
			OutputTokens: 30,
			TotalTokens:  230,
			CostUSD:      0.0019,
		},
	})

	if summary == nil {
		t.Fatal("summary = nil, want usage summary")
	}
	if summary.InputTokens != 300 || summary.OutputTokens != 40 || summary.TotalTokens != 340 {
		t.Fatalf("summary token counts = %#v, want merged calls", summary)
	}
	if summary.CostUSD != 0.0027 {
		t.Fatalf("summary.CostUSD = %.8f, want 0.0027", summary.CostUSD)
	}
	if len(summary.Calls) != 2 {
		t.Fatalf("len(summary.Calls) = %d, want 2", len(summary.Calls))
	}
}
