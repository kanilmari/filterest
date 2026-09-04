// image_source_picker_test.go
// Verifies provider URL parsing, secret-free metadata, and fail-closed image downloads.
// Bridges the external API adapter contract and Filterest's protected picker handlers.
// Exists to prevent SSRF, key disclosure, and provider-compliance regressions.
package image_source_picker

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (function roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

func response(status int, contentType, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Header:     http.Header{"Content-Type": []string{contentType}},
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}

func TestProviderURLParsingRejectsArbitraryHosts(t *testing.T) {
	service := NewService(Config{})
	_, err := service.Resolve(context.Background(), "https://127.0.0.1/photos/example")
	if err == nil || !strings.Contains(err.Error(), "Only Unsplash") {
		t.Fatalf("expected unsupported provider error, got %v", err)
	}
	if _, err := parsePublicSourceURL("http://unsplash.com/photos/abcdefghijk"); err == nil {
		t.Fatal("expected non-HTTPS source URL to be rejected")
	}
}

func TestUnsplashSlugExtractsStableAssetID(t *testing.T) {
	parsed, err := url.Parse("https://unsplash.com/photos/a-blue-lake-abcdefghijk")
	if err != nil {
		t.Fatal(err)
	}
	assetID, matched, err := newUnsplashProvider(Config{}, http.DefaultClient).ParseURL(parsed)
	if err != nil || !matched || assetID != "abcdefghijk" {
		t.Fatalf("unexpected parse result id=%q matched=%v err=%v", assetID, matched, err)
	}
}

func TestPexelsSelectionDownloadsThroughAllowlistedSameOriginBridge(t *testing.T) {
	requests := make([]string, 0, 3)
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		requests = append(requests, request.URL.String())
		switch request.URL.Host {
		case "api.pexels.test":
			if request.Header.Get("Authorization") != "pexels-secret" {
				t.Fatalf("missing server-side Pexels credential")
			}
			return response(http.StatusOK, "application/json", `{
				"id": 123, "width": 1200, "height": 800,
				"url": "https://www.pexels.com/photo/example-123/",
				"photographer": "Example Author",
				"photographer_url": "https://www.pexels.com/@example/",
				"alt": "Mountain lake",
				"src": {
					"original": "https://images.pexels.com/photos/123/original.jpeg",
					"large": "https://images.pexels.com/photos/123/large.jpeg"
				}
			}`), nil
		case "images.pexels.com":
			return response(http.StatusOK, "image/jpeg", "raster-image"), nil
		default:
			t.Fatalf("unexpected outbound host %q", request.URL.Host)
			return nil, nil
		}
	})}
	service := NewService(Config{PexelsAPIKey: "pexels-secret", PexelsAPIBase: "https://api.pexels.test/v1", HTTPClient: client})

	image, selection, err := service.Download(context.Background(), "https://www.pexels.com/photo/example-123/", "select")
	if err != nil {
		t.Fatal(err)
	}
	if selection.Provider != "pexels" || selection.Description != "Mountain lake" {
		t.Fatalf("unexpected selection: %#v", selection)
	}
	if image.ContentType != "image/jpeg" || image.Filename != "pexels-123.jpg" || string(image.Bytes) != "raster-image" {
		t.Fatalf("unexpected downloaded image: %#v", image)
	}
	encoded, err := json.Marshal(selection)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(encoded, []byte("pexels-secret")) {
		t.Fatal("selection leaked the provider credential")
	}
	if len(requests) != 2 {
		t.Fatalf("expected metadata and image requests, got %v", requests)
	}
}

func TestImageDownloadRejectsProviderMediaHostEscape(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		return response(http.StatusOK, "application/json", `{
			"id": 123, "width": 1200, "height": 800,
			"url": "https://www.pexels.com/photo/example-123/",
			"photographer": "Example Author",
			"src": {"original": "https://127.0.0.1/private.jpg", "large": "https://127.0.0.1/private.jpg"}
		}`), nil
	})}
	service := NewService(Config{PexelsAPIKey: "secret", PexelsAPIBase: "https://api.pexels.test/v1", HTTPClient: client})
	_, _, err := service.Download(context.Background(), "https://www.pexels.com/photo/example-123/", "preview")
	if err == nil || !strings.Contains(err.Error(), "unsafe image URL") {
		t.Fatalf("expected fail-closed media host rejection, got %v", err)
	}
}

func TestProvidersHandlerDoesNotExposeCredentials(t *testing.T) {
	previousProvider := serviceForRequest
	testService := NewService(Config{UnsplashAccessKey: "do-not-leak"})
	serviceForRequest = func() *Service { return testService }
	t.Cleanup(func() {
		serviceForRequest = previousProvider
	})

	request := httptest.NewRequest(http.MethodGet, "/api/image-source-picker/providers", nil)
	recorder := httptest.NewRecorder()
	ProvidersHandler(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}
	if strings.Contains(recorder.Body.String(), "do-not-leak") {
		t.Fatal("providers response leaked the credential")
	}
	if !strings.Contains(recorder.Body.String(), `"configured":true`) {
		t.Fatalf("expected configured capability, got %s", recorder.Body.String())
	}
}
