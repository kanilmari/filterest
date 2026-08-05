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

// GenerateEmbedding returns a float32 embedding vector for the given text.
// It dispatches to Google or OpenAI based on the EMBEDDING_PROVIDER env var.
func GenerateEmbedding(ctx context.Context, text string) ([]float32, error) {
	provider := strings.ToLower(os.Getenv("EMBEDDING_PROVIDER"))
	if provider == "google" {
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
	model := os.Getenv("OPENAI_EMBEDDING_MODEL")
	if model == "" {
		model = "text-embedding-ada-002"
	}

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

func generateGoogleEmbedding(ctx context.Context, text string) ([]float32, error) {
	apiKey := os.Getenv("GOOGLE_API_KEY")
	if apiKey == "" {
		return nil, fmt.Errorf("missing GOOGLE_API_KEY")
	}
	model := os.Getenv("GOOGLE_EMBEDDING_MODEL")
	if model == "" {
		model = "gemini-embedding-001"
	}

	reqBody := geminiEmbedRequest{
		Model: "models/" + model,
		Content: geminiContent{
			Parts: []geminiPart{{Text: text}},
		},
		OutputDimensionality: 1536,
	}

	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("google embedding: marshal error: %w", err)
	}

	url := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/%s:embedContent?key=%s", model, apiKey)
	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("google embedding: request error: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

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
