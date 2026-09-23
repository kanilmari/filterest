// embedding_provider_key_presence_test.go
// Verifies that the embedding status page reads each provider's key from the one registry the key form writes to.
// Bridges the provider key saver's setting names with the page's "key configured" answer.
// Exists so the page can never report a configured key the form did not install, or a missing one it did.
package ai_features

import (
	"testing"

	backend "easelect/backend/core_components"
)

func TestEmbeddingProviderKeyConfiguredFollowsTheSaversSettingNames(t *testing.T) {
	googleSetting, _ := backend.ProviderAPIKeyEnvironmentName(backend.APIKeyProviderGoogle)
	openAISetting, _ := backend.ProviderAPIKeyEnvironmentName(backend.APIKeyProviderOpenAI)

	t.Setenv(googleSetting, "")
	t.Setenv(openAISetting, "")
	if embeddingProviderKeyConfigured(backend.APIKeyProviderGoogle) ||
		embeddingProviderKeyConfigured(backend.APIKeyProviderOpenAI) {
		t.Fatal("an empty setting was reported as a configured key")
	}

	// One provider's key must never make the other look configured.
	t.Setenv(googleSetting, "test-google-key")
	if !embeddingProviderKeyConfigured(backend.APIKeyProviderGoogle) {
		t.Fatal("the Google key was not recognised")
	}
	if embeddingProviderKeyConfigured(backend.APIKeyProviderOpenAI) {
		t.Fatal("the Google key made OpenAI look configured")
	}

	t.Setenv(openAISetting, "   ")
	if embeddingProviderKeyConfigured(backend.APIKeyProviderOpenAI) {
		t.Fatal("a blank setting was reported as a configured key")
	}
	t.Setenv(openAISetting, "test-openai-key")
	if !embeddingProviderKeyConfigured(backend.APIKeyProviderOpenAI) {
		t.Fatal("the OpenAI key was not recognised")
	}

	if embeddingProviderKeyConfigured("anthropic") {
		t.Fatal("a provider this installation stores no key for was reported as configured")
	}
}
