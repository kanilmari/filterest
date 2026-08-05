// llm_provider_for_translations.go
// Provider adapter layer for AI-assisted translation generation.
// Bridges env-driven provider selection, retry/fallback policy, and provider-specific API calls.
// Exists to keep translation prompts stable even when credentials or LLM vendors change.
package lang

import (
	"context"
	"fmt"
	"log"
	"os"
	"regexp"
	"strings"

	anthropic "github.com/anthropics/anthropic-sdk-go"
	anthropicOption "github.com/anthropics/anthropic-sdk-go/option"
	"github.com/sashabaranov/go-openai"
)

// translationLLMProvider determines which LLM provider to use for translations.
// Returns "anthropic" or "openai".
func translationLLMProvider() string {
	val := strings.TrimSpace(os.Getenv("USE_ANTHROPIC"))
	// Default to "1" (Anthropic) if not set
	if val == "" || val == "1" || strings.EqualFold(val, "true") {
		return "anthropic"
	}
	return "openai"
}

// translationLLMConfig holds the resolved provider, key, and model for a translation call.
type translationLLMConfig struct {
	Provider string // "anthropic" or "openai"
	APIKey   string
	Model    string
}

// resolveTranslationLLMConfig determines which provider to use for translations.
// It checks the primary provider first, then falls back to the other if the
// primary provider's API key is missing.
func resolveTranslationLLMConfig() (translationLLMConfig, error) {
	primary := translationLLMProvider()

	anthropicKey := strings.TrimSpace(os.Getenv("ANTHROPIC_API_KEY"))
	anthropicModel := strings.TrimSpace(os.Getenv("ANTHROPIC_MODEL"))
	if anthropicModel == "" {
		anthropicModel = "claude-haiku-4-5-20251001"
	}

	openaiKey := strings.TrimSpace(os.Getenv("OPENAI_API_KEY"))
	openaiModel := strings.TrimSpace(os.Getenv("OPENAI_API_MODEL"))
	if openaiModel == "" {
		openaiModel = "gpt-5.5"
	}

	if primary == "anthropic" {
		if anthropicKey != "" {
			return translationLLMConfig{Provider: "anthropic", APIKey: anthropicKey, Model: anthropicModel}, nil
		}
		// Fallback to OpenAI
		if openaiKey != "" {
			log.Printf("[LLM] Anthropic API key missing — falling back to OpenAI")
			return translationLLMConfig{Provider: "openai", APIKey: openaiKey, Model: openaiModel}, nil
		}
	} else {
		if openaiKey != "" {
			return translationLLMConfig{Provider: "openai", APIKey: openaiKey, Model: openaiModel}, nil
		}
		// Fallback to Anthropic
		if anthropicKey != "" {
			log.Printf("[LLM] OpenAI API key missing — falling back to Anthropic")
			return translationLLMConfig{Provider: "anthropic", APIKey: anthropicKey, Model: anthropicModel}, nil
		}
	}

	return translationLLMConfig{}, fmt.Errorf("no LLM API keys configured (set OPENAI_API_KEY or ANTHROPIC_API_KEY)")
}

// chatCompletionForTranslation sends a system+user message to the configured LLM
// provider and returns the text response. Supports automatic fallback when the
// primary provider returns a rate-limit (429) or server error (5xx).
func chatCompletionForTranslation(ctx context.Context, systemMessage, userMessage string) (string, error) {
	cfg, err := resolveTranslationLLMConfig()
	if err != nil {
		return "", err
	}

	result, err := callLLMProvider(ctx, cfg, systemMessage, userMessage)
	if err != nil {
		// Check if error is a rate-limit or server error — try the other provider
		errStr := strings.ToLower(err.Error())
		isRetryable := strings.Contains(errStr, "429") ||
			strings.Contains(errStr, "too many requests") ||
			strings.Contains(errStr, "rate limit") ||
			strings.Contains(errStr, "500") ||
			strings.Contains(errStr, "502") ||
			strings.Contains(errStr, "503") ||
			strings.Contains(errStr, "overloaded")

		if isRetryable {
			fallbackCfg, fallbackErr := getFallbackConfig(cfg)
			if fallbackErr == nil {
				log.Printf("[LLM] %s returned retryable error (%v) — trying fallback: %s/%s",
					cfg.Provider, err, fallbackCfg.Provider, fallbackCfg.Model)
				result, fallbackCallErr := callLLMProvider(ctx, fallbackCfg, systemMessage, userMessage)
				if fallbackCallErr == nil {
					return result, nil
				}
				// Both providers failed — return the fallback error
				return "", fmt.Errorf("both providers failed — primary (%s): %v, fallback (%s): %v",
					cfg.Provider, err, fallbackCfg.Provider, fallbackCallErr)
			}
		}
		return "", fmt.Errorf("%s error: %w", cfg.Provider, err)
	}

	return result, nil
}

// callLLMProvider calls the specified provider with the given messages.
func callLLMProvider(ctx context.Context, cfg translationLLMConfig, systemMessage, userMessage string) (string, error) {
	switch cfg.Provider {
	case "anthropic":
		return callAnthropicForTranslation(ctx, cfg.APIKey, cfg.Model, systemMessage, userMessage)
	case "openai":
		return callOpenAIForTranslation(ctx, cfg.APIKey, cfg.Model, systemMessage, userMessage)
	default:
		return "", fmt.Errorf("unknown LLM provider: %s", cfg.Provider)
	}
}

// getFallbackConfig returns the alternative provider config, if available.
func getFallbackConfig(primary translationLLMConfig) (translationLLMConfig, error) {
	if primary.Provider == "anthropic" {
		key := strings.TrimSpace(os.Getenv("OPENAI_API_KEY"))
		if key == "" {
			return translationLLMConfig{}, fmt.Errorf("no OpenAI fallback available")
		}
		model := strings.TrimSpace(os.Getenv("OPENAI_API_MODEL"))
		if model == "" {
			model = "gpt-5.5"
		}
		return translationLLMConfig{Provider: "openai", APIKey: key, Model: model}, nil
	}
	// primary is openai → fallback to anthropic
	key := strings.TrimSpace(os.Getenv("ANTHROPIC_API_KEY"))
	if key == "" {
		return translationLLMConfig{}, fmt.Errorf("no Anthropic fallback available")
	}
	model := strings.TrimSpace(os.Getenv("ANTHROPIC_MODEL"))
	if model == "" {
		model = "claude-haiku-4-5-20251001"
	}
	return translationLLMConfig{Provider: "anthropic", APIKey: key, Model: model}, nil
}

// callAnthropicForTranslation calls the Anthropic Messages API.
func callAnthropicForTranslation(ctx context.Context, apiKey, model, systemMessage, userMessage string) (string, error) {
	client := anthropic.NewClient(
		anthropicOption.WithAPIKey(apiKey),
	)

	resp, err := client.Messages.New(ctx, anthropic.MessageNewParams{
		Model:       anthropic.Model(model),
		MaxTokens:   4096,
		Temperature: anthropic.Float(0.3),
		System: []anthropic.TextBlockParam{
			{Text: systemMessage},
		},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(
				anthropic.NewTextBlock(userMessage),
			),
		},
	})
	if err != nil {
		return "", err
	}

	// Extract text from response content blocks
	var textParts []string
	for _, block := range resp.Content {
		if block.Type == "text" {
			textParts = append(textParts, block.Text)
		}
	}

	if len(textParts) == 0 {
		return "", fmt.Errorf("Anthropic response contained no text blocks")
	}

	return strings.Join(textParts, ""), nil
}

// callOpenAIForTranslation calls the OpenAI ChatCompletion API.
func callOpenAIForTranslation(ctx context.Context, apiKey, model, systemMessage, userMessage string) (string, error) {
	client := openai.NewClient(apiKey)

	msgs := []openai.ChatCompletionMessage{
		{Role: openai.ChatMessageRoleSystem, Content: systemMessage},
		{Role: openai.ChatMessageRoleUser, Content: userMessage},
	}

	resp, err := client.CreateChatCompletion(ctx, buildOpenAITranslationRequest(model, msgs, 0.3))
	if err != nil {
		return "", err
	}

	if len(resp.Choices) == 0 {
		return "", fmt.Errorf("no AI choices returned")
	}

	return resp.Choices[0].Message.Content, nil
}

// shouldSendOpenAITranslationTemperature reports whether the selected model accepts custom temperature.
// Between: translation model selection and OpenAI chat-completion request construction.
// Why: Newer reasoning models reject non-default temperature values with HTTP 400.
func shouldSendOpenAITranslationTemperature(model string) bool {
	normalized := strings.ToLower(strings.TrimSpace(model))
	if normalized == "" {
		return false
	}
	if strings.HasPrefix(normalized, "gpt-5") || strings.HasPrefix(normalized, "o1") ||
		strings.HasPrefix(normalized, "o3") || strings.HasPrefix(normalized, "o4") {
		return false
	}
	return true
}

// buildOpenAITranslationRequest keeps OpenAI request defaults model-aware.
// Between: translation prompts and the OpenAI client library.
// Why: Chat Completions accepts temperature for older chat models, but not for default-only reasoning models.
func buildOpenAITranslationRequest(model string, messages []openai.ChatCompletionMessage, temperature float32) openai.ChatCompletionRequest {
	request := openai.ChatCompletionRequest{
		Model:    model,
		Messages: messages,
	}
	if shouldSendOpenAITranslationTemperature(model) {
		request.Temperature = temperature
	}
	return request
}

// markdownCodeFencePattern matches ```json ... ``` or ``` ... ``` wrappers
// that LLMs (especially Anthropic) often add around JSON responses.
var markdownCodeFencePattern = regexp.MustCompile("(?s)^\\s*```(?:json)?\\s*\n?(.*?)\n?\\s*```\\s*$")

// extractJSONFromLLMResponse strips markdown code fences from LLM output.
// Many LLMs wrap JSON in ```json ... ``` even when told not to.
// If no fences are found, the original text is returned trimmed.
func extractJSONFromLLMResponse(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if matches := markdownCodeFencePattern.FindStringSubmatch(trimmed); len(matches) > 1 {
		return strings.TrimSpace(matches[1])
	}
	return trimmed
}
