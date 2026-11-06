// embedding_error_privacy_test.go
// Verifies provider bodies stay out of logs and returned errors by default.
// Connects the embedding client to in-memory settings and HTTP transports.
// Covers Google HTTP/JSON errors and OpenAI SDK errors without network access.
package ai_features

import (
	"bytes"
	"context"
	"database/sql/driver"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils/queryfixture"
	"easelect/backend/core_components/middlewares"
	"easelect/backend/core_components/system_config_cache"
	"github.com/lib/pq"
)

type embeddingErrorTransport struct {
	status int
	body   string
}

func TestEmbeddingRefreshErrorsRespectSearchTermSetting(t *testing.T) {
	const marker = "e2e_provider_search"
	for _, refresh := range []bool{false, true} {
		for _, enabled := range []bool{false, true} {
			t.Run(fmt.Sprintf("refresh=%t/on=%t", refresh, enabled), func(t *testing.T) {
				wrapped := fmt.Errorf("provider %s: %w", marker, &pq.Error{Code: "22003", Message: marker})
				db := queryfixture.Open(t, func(q string, _ []driver.NamedValue) (driver.Rows, error) {
					if strings.Contains(q, "SELECT boolean_value FROM system_config") {
						return queryfixture.Rows([]string{"boolean_value"}, []driver.Value{enabled}), nil
					}
					return nil, wrapped
				})
				oldDB, oldOutput := backend.Db, log.Writer()
				backend.Db = db
				var logs bytes.Buffer
				log.SetOutput(&logs)
				t.Cleanup(func() {
					backend.Db = oldDB
					log.SetOutput(oldOutput)
					system_config_cache.Delete(middlewares.AppLogSearchTermsKey)
				})
				var err error
				if refresh {
					err = generateLangEmbeddingsForRow(db, "e2e_embeddings", 17, []string{"en"})
				} else {
					_, err = needLangEmbeddingsForRow(db, "e2e_embeddings", 17, []string{"en"})
				}
				if err != wrapped || strings.Contains(logs.String(), marker) != enabled {
					t.Fatalf("returned error=%v, on=%t logs=%q", err, enabled, logs.String())
				}
				if enabled && !strings.Contains(logs.String(), wrapped.Error()) ||
					!enabled && !strings.Contains(logs.String(), "error_class=*pq.Error sqlstate=22003 handler=") {
					t.Fatalf("diagnostic changed: %q", logs.String())
				}
			})
		}
	}
}

func (transport embeddingErrorTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	return &http.Response{StatusCode: transport.status, Header: make(http.Header), Request: r,
		Body: io.NopCloser(strings.NewReader(transport.body))}, nil
}

func TestEmbeddingProviderErrorsRespectSearchTermSetting(t *testing.T) {
	for _, provider := range []string{"google-http", "google-json", "google-decode", "openai"} {
		for _, enabled := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/on=%t", provider, enabled), func(t *testing.T) {
				marker := "e2e_provider_search"
				if provider == "google-decode" {
					marker = "1e1000"
				}
				oldDB, oldTransport, oldOutput := backend.Db, http.DefaultTransport, log.Writer()
				backend.Db = queryfixture.Open(t, func(string, []driver.NamedValue) (driver.Rows, error) {
					return queryfixture.Rows([]string{"boolean_value"}, []driver.Value{enabled}), nil
				})
				t.Cleanup(func() {
					backend.Db, http.DefaultTransport = oldDB, oldTransport
					log.SetOutput(oldOutput)
					system_config_cache.Delete(middlewares.AppLogSearchTermsKey)
				})
				var logs bytes.Buffer
				log.SetOutput(&logs)
				body := `{"error":{"code":400,"message":"` + marker + `"}}`
				status := http.StatusBadRequest
				if provider == "google-json" || provider == "google-decode" {
					status = http.StatusOK
				}
				if provider == "google-decode" {
					body = `{"embedding":{"values":[1e1000]}}`
				}
				http.DefaultTransport = embeddingErrorTransport{status: status, body: body}
				t.Setenv("EMBEDDING_PROVIDER", "google")
				t.Setenv("GOOGLE_API_KEY", "offline-fixture")
				t.Setenv("OPENAI_API_KEY", "offline-fixture")
				if provider == "openai" {
					t.Setenv("EMBEDDING_PROVIDER", "openai")
				}
				_, err := GenerateEmbedding(context.Background(), marker)
				if err == nil {
					t.Fatal("provider error disappeared")
				}
				if strings.Contains(err.Error(), marker) != enabled {
					t.Fatalf("returned error: %q, on=%t", err, enabled)
				}
				if !enabled && strings.Contains(logs.String(), marker) {
					t.Fatalf("provider body leaked: %q", logs.String())
				}
				if provider == "google-decode" {
					want := "google embedding: decode failed (error_class=*json.UnmarshalTypeError)"
					if enabled {
						want = "google embedding: unmarshal error: json: cannot unmarshal number 1e1000 into Go struct field geminiEmbeddingData.embedding.values of type float32"
					}
					if err.Error() != want {
						t.Fatalf("decode error=%q; want %q", err, want)
					}
				}
				if provider == "google-http" {
					wantLog, wantError := "[embedding_client] Google API error 400", "google embedding: API returned 400"
					if enabled {
						wantLog += ": " + body
						wantError += ": " + body
					}
					if !strings.Contains(logs.String(), wantLog+"\n") || err.Error() != wantError {
						t.Fatalf("log=%q, error=%q; want %q, %q", logs.String(), err, wantLog, wantError)
					}
				}
			})
		}
	}
}
