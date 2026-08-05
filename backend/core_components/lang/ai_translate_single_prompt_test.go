// ai_translate_single_prompt_test.go
// Unit tests for dev-editor single-key AI translation prompt selection.
// Bridges environment overrides and the one-key translation endpoint contract.
// Exists so the bulk missing-key prompt cannot make single-key translation expect JSON arrays.
package lang

import (
	"strings"
	"testing"
)

// TestSingleKeyAITranslatorSystemMessageIgnoresBulkTranslatorOverride checks
// prompt ownership between bulk env config and the single-key dev endpoint.
func TestSingleKeyAITranslatorSystemMessageIgnoresBulkTranslatorOverride(t *testing.T) {
	t.Setenv("AI_TRANSLATOR_SYSTEM_MESSAGE", "Return ONLY valid JSON array of translation objects.")
	t.Setenv("AI_TRANSLATOR_SINGLE_SYSTEM_MESSAGE", "")

	got := singleKeyAITranslatorSystemMessage()

	if strings.Contains(got, "JSON array") {
		t.Fatalf("single-key prompt used the bulk translator prompt: %q", got)
	}
	for _, want := range []string{`"en"`, `"fi"`, `"ch"`, `"yue"`, "Cantonese", "JSON object"} {
		if !strings.Contains(got, want) {
			t.Fatalf("single-key prompt = %q, want it to mention %s", got, want)
		}
	}
}

// TestSingleKeyAITranslatorSystemMessageUsesSingleKeyOverride checks the
// optional one-key prompt override path for local experimentation.
func TestSingleKeyAITranslatorSystemMessageUsesSingleKeyOverride(t *testing.T) {
	t.Setenv("AI_TRANSLATOR_SYSTEM_MESSAGE", "bulk prompt")
	t.Setenv("AI_TRANSLATOR_SINGLE_SYSTEM_MESSAGE", "single-key prompt")

	if got := singleKeyAITranslatorSystemMessage(); got != "single-key prompt" {
		t.Fatalf("singleKeyAITranslatorSystemMessage() = %q, want single-key override", got)
	}
}

// TestSingleKeyAITranslatorUserMessagePrioritizesExistingEditorCopy checks
// that polished translations reach the model as source text instead of table IDs.
func TestSingleKeyAITranslatorUserMessagePrioritizesExistingEditorCopy(t *testing.T) {
	got := singleKeyAITranslatorUserMessage(aiTranslateSingleRequest{
		LangKey:          "search_for_app_service_catalog",
		UsageExplanation: "Table 'app_service_catalog'",
		Fi:               "Etsi palveluita",
		En:               "Search for services",
		Yue:              "搜尋服務",
	})

	for _, want := range []string{
		`en: "Search for services"`,
		`fi: "Etsi palveluita"`,
		`yue: "搜尋服務"`,
		"Non-empty current editor values are authoritative UI copy",
		"Do not translate technical identifiers such as app_service_catalog",
		"搜索服务",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("single-key user prompt missing %q:\n%s", want, got)
		}
	}
}
