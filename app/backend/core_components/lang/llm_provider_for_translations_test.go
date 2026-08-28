// llm_provider_for_translations_test.go
// Verifies OpenAI model defaults and request shaping for translation generation.
// Bridges environment-driven LLM selection and provider request construction.
// Exists so GPT-5 default-only parameters do not break production translation prompts.
package lang

import (
	"testing"

	"github.com/sashabaranov/go-openai"
)

func TestResolveTranslationLLMConfigDefaultsOpenAIToGPT55(t *testing.T) {
	t.Setenv("USE_ANTHROPIC", "0")
	t.Setenv("OPENAI_API_KEY", "test-key")
	t.Setenv("OPENAI_API_MODEL", "")
	t.Setenv("ANTHROPIC_API_KEY", "")

	config, err := resolveTranslationLLMConfig()
	if err != nil {
		t.Fatalf("resolveTranslationLLMConfig() error = %v", err)
	}
	if config.Provider != "openai" {
		t.Fatalf("Provider = %q, want openai", config.Provider)
	}
	if config.Model != "gpt-5.5" {
		t.Fatalf("Model = %q, want gpt-5.5", config.Model)
	}
}

func TestGetFallbackConfigDefaultsOpenAIToGPT55(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "test-key")
	t.Setenv("OPENAI_API_MODEL", "")

	config, err := getFallbackConfig(translationLLMConfig{Provider: "anthropic"})
	if err != nil {
		t.Fatalf("getFallbackConfig(anthropic) error = %v", err)
	}
	if config.Provider != "openai" {
		t.Fatalf("Provider = %q, want openai", config.Provider)
	}
	if config.Model != "gpt-5.5" {
		t.Fatalf("Model = %q, want gpt-5.5", config.Model)
	}
}

func TestBuildOpenAITranslationRequestOmitsTemperatureForGPT55(t *testing.T) {
	request := buildOpenAITranslationRequest("gpt-5.5", []openai.ChatCompletionMessage{
		{Role: openai.ChatMessageRoleUser, Content: "translate"},
	}, 0.3)

	if request.Temperature != 0 {
		t.Fatalf("Temperature = %v, want zero so JSON omits temperature for GPT-5.5", request.Temperature)
	}
}

func TestBuildOpenAITranslationRequestKeepsTemperatureForOlderChatModels(t *testing.T) {
	request := buildOpenAITranslationRequest("gpt-4o", []openai.ChatCompletionMessage{
		{Role: openai.ChatMessageRoleUser, Content: "translate"},
	}, 0.3)

	if request.Temperature != 0.3 {
		t.Fatalf("Temperature = %v, want 0.3 for older chat models", request.Temperature)
	}
}
