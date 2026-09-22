// embedding_client_test.go
// Verifies that the provider, the model and its related-enough cut-off are read from one configuration.
// Bridges the environment settings with the embedding client and the AI search cut-off.
// Exists so a site switching provider or model also switches the search's meaning of "related".
package ai_features

import "testing"

func TestSemanticDistanceCutoffFollowsTheConfiguredModel(t *testing.T) {
	cases := []struct {
		provider, googleModel, openAIModel string
		want                               float64
	}{
		{provider: "google", want: googleSemanticDistanceCutoff},
		{provider: " Google ", want: googleSemanticDistanceCutoff},
		{provider: "google", googleModel: "some-future-model", want: googleSemanticDistanceCutoff},
		{provider: "", want: 0.245},
		{provider: "openai", openAIModel: "text-embedding-ada-002", want: 0.245},
		{provider: "openai", openAIModel: "not-yet-calibrated", want: 0.245},
	}
	for _, c := range cases {
		t.Setenv("EMBEDDING_PROVIDER", c.provider)
		t.Setenv("GOOGLE_EMBEDDING_MODEL", c.googleModel)
		t.Setenv("OPENAI_EMBEDDING_MODEL", c.openAIModel)
		if got := SemanticDistanceCutoff(); got != c.want {
			t.Fatalf("%+v: cut-off %v, want %v", c, got, c.want)
		}
	}
}

// The OpenAI cut-off must keep the former rule for unit vectors: a Euclidean
// distance of at most 0.70 is a cosine distance of at most 0.70² / 2.
func TestTheOpenAICutoffKeepsTheFormerRuleForUnitVectors(t *testing.T) {
	const formerEuclideanCutoff = 0.70
	if got := semanticDistanceCutoffs[defaultOpenAIEmbeddingModel]; got != formerEuclideanCutoff*formerEuclideanCutoff/2 {
		t.Fatalf("ada-002 cut-off %v, want %v", got, formerEuclideanCutoff*formerEuclideanCutoff/2)
	}
}
