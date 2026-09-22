// embedding_client_google_test.go
// Verifies that the Google embedding request carries its API key only in a header.
// Bridges the embedding client with a local stand-in for Google's embedContent address.
// Exists because a failed request's error repeats its address, and errors reach logs and browsers.
package ai_features

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const fixtureGoogleKey = "fixture-google-key-not-a-secret"

func useGoogleEmbeddingFixture(t *testing.T, endpoint string) {
	t.Helper()
	t.Setenv("GOOGLE_API_KEY", fixtureGoogleKey)
	saved := googleEmbeddingEndpoint
	googleEmbeddingEndpoint = endpoint
	t.Cleanup(func() { googleEmbeddingEndpoint = saved })
}

func TestGoogleEmbeddingSendsItsKeyOnlyInAHeader(t *testing.T) {
	var gotKey, gotAddress string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotKey, gotAddress = r.Header.Get("x-goog-api-key"), r.URL.String()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"embedding":{"values":[0.1,0.2]}}`))
	}))
	defer server.Close()
	useGoogleEmbeddingFixture(t, server.URL+"/models/%s:embedContent")

	values, err := generateGoogleEmbedding(context.Background(), "car")
	if err != nil || len(values) != 2 {
		t.Fatalf("values = %v, err = %v", values, err)
	}
	if gotKey != fixtureGoogleKey || strings.Contains(gotAddress, fixtureGoogleKey) {
		t.Fatalf("key header %q, address %q", gotKey, gotAddress)
	}
}

func TestAFailedGoogleEmbeddingRequestNeverRepeatsTheKey(t *testing.T) {
	server := httptest.NewServer(http.NotFoundHandler())
	endpoint := server.URL + "/models/%s:embedContent"
	server.Close() // nothing listens any more, so the request itself fails
	useGoogleEmbeddingFixture(t, endpoint)

	_, err := generateGoogleEmbedding(context.Background(), "car")
	if err == nil || strings.Contains(err.Error(), fixtureGoogleKey) {
		t.Fatalf("err = %v", err)
	}
}
