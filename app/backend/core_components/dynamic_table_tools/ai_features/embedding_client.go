// embedding_client.go
// Provider-agnostic embedding client supporting Google and OpenAI backends.
// Between AI feature handlers and external embedding APIs.
// Exists to abstract provider selection behind a single GenerateEmbedding call.
package ai_features

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/sashabaranov/go-openai"
)

const (
	embeddingProviderGoogle = "google"
	embeddingProviderOpenAI = "openai"

	defaultGoogleEmbeddingModel = "gemini-embedding-001"
	defaultOpenAIEmbeddingModel = "text-embedding-ada-002"

	// googleEmbeddingDimensions is the vector length requested from Google.
	// At this length Google does not scale its vectors to unit length.
	googleEmbeddingDimensions = 1536
)

// configuredEmbeddingProvider is the site's embedding provider, read from the
// EMBEDDING_PROVIDER environment variable: "google" selects Google, anything
// else OpenAI. Every embedding path and the admin status read this one answer.
func configuredEmbeddingProvider() string {
	if strings.EqualFold(strings.TrimSpace(os.Getenv("EMBEDDING_PROVIDER")), embeddingProviderGoogle) {
		return embeddingProviderGoogle
	}
	return embeddingProviderOpenAI
}

// configuredEmbeddingModel is the model the configured provider is asked for.
func configuredEmbeddingModel(provider string) string {
	if provider == embeddingProviderGoogle {
		if model := strings.TrimSpace(os.Getenv("GOOGLE_EMBEDDING_MODEL")); model != "" {
			return model
		}
		return defaultGoogleEmbeddingModel
	}
	if model := strings.TrimSpace(os.Getenv("OPENAI_EMBEDDING_MODEL")); model != "" {
		return model
	}
	return defaultOpenAIEmbeddingModel
}

// Search compares meaning by cosine distance (1 − cosine similarity). It
// ignores vector length, so a cut-off means the same whether a provider scales
// its vectors to length one (OpenAI) or not (Google at 1536 dimensions). Each
// model still spreads its distances differently, so the cut-off is per model.
// Calibrate a new model before adding it: unknown models use their provider's
// default, which fails towards showing fewer AI results rather than unrelated ones.
var semanticDistanceCutoffs = map[string]float64{
	defaultOpenAIEmbeddingModel: openAISemanticDistanceCutoff,
	defaultGoogleEmbeddingModel: googleSemanticDistanceCutoff,
}

// openAISemanticDistanceCutoff keeps the former rule, a Euclidean distance of
// at most 0.70, which on OpenAI's unit vectors is this cosine distance (0.70² / 2).
const openAISemanticDistanceCutoff = 0.245

// googleSemanticDistanceCutoff was measured on the local service catalog with
// 15 Finnish and English queries (2026-09-22). Unrelated rows lay at 0.44 or
// farther (one loosely related row at 0.41); genuine matches of Finnish
// queries at 0.34-0.42.
// English queries against mostly Finnish rows reached their match only at
// 0.42-0.49, so some of them are left to the text search rather than let
// unrelated rows through.
const googleSemanticDistanceCutoff = 0.43

var defaultSemanticDistanceCutoffs = map[string]float64{
	embeddingProviderOpenAI: openAISemanticDistanceCutoff,
	embeddingProviderGoogle: googleSemanticDistanceCutoff,
}

// SemanticDistanceCutoff is the largest cosine distance at which the
// configured model's search result still counts as related in meaning.
func SemanticDistanceCutoff() float64 {
	provider := configuredEmbeddingProvider()
	if cutoff, ok := semanticDistanceCutoffs[configuredEmbeddingModel(provider)]; ok {
		return cutoff
	}
	return defaultSemanticDistanceCutoffs[provider]
}

// GenerateEmbedding returns a float32 embedding vector for the given text.
// It dispatches to Google or OpenAI based on the EMBEDDING_PROVIDER env var.
func GenerateEmbedding(ctx context.Context, text string) ([]float32, error) {
	if configuredEmbeddingProvider() == embeddingProviderGoogle {
		return generateGoogleEmbedding(ctx, text)
	}
	return generateOpenAIEmbedding(ctx, text)
}

// --- OpenAI provider ---

func generateOpenAIEmbedding(ctx context.Context, text string) ([]float32, error) {
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		return nil, fmt.Errorf("missing OPENAI_API_KEY")
	}
	model := configuredEmbeddingModel(embeddingProviderOpenAI)

	client := openai.NewClient(apiKey)
	resp, err := client.CreateEmbeddings(ctx, openai.EmbeddingRequest{
		Model: openai.EmbeddingModel(model),
		Input: []string{text},
	})
	if err != nil {
		return nil, fmt.Errorf("openai embedding error: %w", err)
	}
	if len(resp.Data) == 0 {
		return nil, fmt.Errorf("openai embedding returned no data")
	}
	return resp.Data[0].Embedding, nil
}

// --- Google Gemini provider ---

// Google Gemini embedding API request/response structs (minimal, no SDK needed)
type geminiEmbedRequest struct {
	Model                string        `json:"model"`
	Content              geminiContent `json:"content"`
	OutputDimensionality int           `json:"outputDimensionality,omitempty"`
}

type geminiContent struct {
	Parts []geminiPart `json:"parts"`
}

type geminiPart struct {
	Text string `json:"text"`
}

type geminiEmbedResponse struct {
	Embedding *geminiEmbeddingData `json:"embedding"`
	Error     *geminiErrorDetail   `json:"error,omitempty"`
}

type geminiEmbeddingData struct {
	Values []float32 `json:"values"`
}

type geminiErrorDetail struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// googleEmbeddingEndpoint is the embedContent address for one model. The API
// key travels in the x-goog-api-key header, never in the address: a failed
// request's error repeats its address, and that error reaches the server log
// and the administrator's browser. Tests point this at a local server.
var googleEmbeddingEndpoint = "https://generativelanguage.googleapis.com/v1beta/models/%s:embedContent"

func generateGoogleEmbedding(ctx context.Context, text string) ([]float32, error) {
	apiKey := os.Getenv("GOOGLE_API_KEY")
	if apiKey == "" {
		return nil, fmt.Errorf("missing GOOGLE_API_KEY")
	}
	model := configuredEmbeddingModel(embeddingProviderGoogle)

	reqBody := geminiEmbedRequest{
		Model: "models/" + model,
		Content: geminiContent{
			Parts: []geminiPart{{Text: text}},
		},
		OutputDimensionality: googleEmbeddingDimensions,
	}

	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("google embedding: marshal error: %w", err)
	}

	url := fmt.Sprintf(googleEmbeddingEndpoint, model)
	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("google embedding: request error: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-goog-api-key", apiKey)

	httpClient := &http.Client{Timeout: 30 * time.Second}
	httpResp, err := httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("google embedding: http error: %w", err)
	}
	defer httpResp.Body.Close()

	respBytes, err := io.ReadAll(httpResp.Body)
	if err != nil {
		return nil, fmt.Errorf("google embedding: read error: %w", err)
	}

	if httpResp.StatusCode != 200 {
		log.Printf("[embedding_client] Google API error %d: %s", httpResp.StatusCode, string(respBytes))
		return nil, fmt.Errorf("google embedding: API returned %d: %s", httpResp.StatusCode, string(respBytes))
	}

	var geminiResp geminiEmbedResponse
	if err := json.Unmarshal(respBytes, &geminiResp); err != nil {
		return nil, fmt.Errorf("google embedding: unmarshal error: %w", err)
	}
	if geminiResp.Error != nil {
		return nil, fmt.Errorf("google embedding: API error %d: %s", geminiResp.Error.Code, geminiResp.Error.Message)
	}
	if geminiResp.Embedding == nil || len(geminiResp.Embedding.Values) == 0 {
		return nil, fmt.Errorf("google embedding: no data returned")
	}

	return geminiResp.Embedding.Values, nil
}
