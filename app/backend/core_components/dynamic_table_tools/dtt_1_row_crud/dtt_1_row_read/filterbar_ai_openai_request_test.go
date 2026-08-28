// filterbar_ai_openai_request_test.go
// Verifies OpenAI chat request shaping for the filterbar AI facade.
// Bridges model selection defaults and chat-completion request construction.
// Exists so GPT-5 default-only parameters do not break AI chat in production.
package dtt_1_row_read

import (
	"testing"

	"github.com/sashabaranov/go-openai"
)

func TestResolveFilterbarAIOpenAIModelDefaultsToGPT55(t *testing.T) {
	t.Setenv("OPENAI_API_MODEL", "")

	if got := resolveFilterbarAIOpenAIModel(); got != "gpt-5.5" {
		t.Fatalf("resolveFilterbarAIOpenAIModel() = %q, want gpt-5.5", got)
	}
}

func TestBuildFilterbarAIChatCompletionRequestOmitsTemperatureForGPT55(t *testing.T) {
	request := buildFilterbarAIChatCompletionRequest("gpt-5.5", []openai.ChatCompletionMessage{
		{Role: openai.ChatMessageRoleUser, Content: "plan"},
	}, 0.1)

	if request.Temperature != 0 {
		t.Fatalf("Temperature = %v, want zero so JSON omits temperature for GPT-5.5", request.Temperature)
	}
}

func TestBuildFilterbarAIChatCompletionRequestKeepsTemperatureForOlderChatModels(t *testing.T) {
	request := buildFilterbarAIChatCompletionRequest("gpt-4o", []openai.ChatCompletionMessage{
		{Role: openai.ChatMessageRoleUser, Content: "plan"},
	}, 0.1)

	if request.Temperature != 0.1 {
		t.Fatalf("Temperature = %v, want 0.1 for older chat models", request.Temperature)
	}
}
