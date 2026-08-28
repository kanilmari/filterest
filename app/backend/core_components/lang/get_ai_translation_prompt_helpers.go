// get_ai_translation_prompt_helpers.go
// Normalizes untrusted metadata before it is embedded in AI translation prompts.
// Bridges dataset descriptions, usage explanations, and bounded prompt construction.
// Exists separately to keep the main translation handler within the repository size boundary.
package lang

import "strings"

func compactDatasetTranslationPurpose(description string) string {
	return compactTranslationPromptText(description, 320)
}

// compactTranslationPromptText normalizes and rune-bounds metadata before it reaches the model.
// It sits between database-authored context and the bulk translation prompt.
// This keeps useful meaning while preventing uncontrolled prompt growth.
func compactTranslationPromptText(value string, maxRunes int) string {
	compact := strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
	runes := []rune(compact)
	if maxRunes <= 0 || len(runes) <= maxRunes {
		return compact
	}
	return strings.TrimSpace(string(runes[:maxRunes])) + "…"
}
