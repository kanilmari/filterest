// provider.go
// Defines the provider-neutral image selection contract and safe HTTP helpers.
// Bridges external photo APIs and Filterest's same-origin picker endpoints.
// Exists to keep provider credentials, URL parsing, and response limits server-side.
package image_source_picker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	SchemaVersion            = "1"
	maxProviderResponseBytes = 2 << 20
)

var (
	ErrInvalidSourceURL  = errors.New("invalid source URL")
	ErrUnsupportedSource = errors.New("unsupported image provider")
)

type ProviderInfo struct {
	Key              string `json:"key"`
	Name             string `json:"name"`
	Configured       bool   `json:"configured"`
	HomepageURL      string `json:"homepage_url"`
	LicenseName      string `json:"license_name"`
	LicenseURL       string `json:"license_url"`
	APIGuidelinesURL string `json:"api_guidelines_url"`
}

type LicenseReference struct {
	Name   string `json:"name"`
	URL    string `json:"url"`
	Source string `json:"source"`
}

type Attribution struct {
	Text               string `json:"text"`
	CreatorURL         string `json:"creator_url,omitempty"`
	ProviderName       string `json:"provider_name"`
	ProviderURL        string `json:"provider_url"`
	APIRequirementNote string `json:"api_requirement_note"`
}

type ImageResource struct {
	PreviewURL  string `json:"preview_url"`
	OriginalURL string `json:"original_url"`
	Width       int    `json:"width,omitempty"`
	Height      int    `json:"height,omitempty"`
	AltText     string `json:"alt_text,omitempty"`
}

type Selection struct {
	SchemaVersion       string           `json:"schema_version"`
	Provider            string           `json:"provider"`
	ProviderName        string           `json:"provider_name"`
	ProviderAssetID     string           `json:"provider_asset_id"`
	SourcePageURL       string           `json:"source_page_url"`
	CreatorName         string           `json:"creator_name"`
	CreatorProfileURL   string           `json:"creator_profile_url,omitempty"`
	Description         string           `json:"description,omitempty"`
	License             LicenseReference `json:"license"`
	Attribution         Attribution      `json:"attribution"`
	Image               ImageResource    `json:"image"`
	MetadataSource      string           `json:"metadata_source"`
	DownloadTrackingURL string           `json:"-"`
	ResolvedAt          time.Time        `json:"resolved_at"`
}

type resolverError struct {
	Status  int
	Code    string
	Message string
	Cause   error
}

func (err *resolverError) Error() string {
	if err.Cause == nil {
		return err.Message
	}
	return err.Message + ": " + err.Cause.Error()
}

func (err *resolverError) Unwrap() error { return err.Cause }

type provider interface {
	Info() ProviderInfo
	ParseURL(*url.URL) (assetID string, matched bool, err error)
	Resolve(context.Context, string) (Selection, error)
}

func parsePublicSourceURL(raw string) (*url.URL, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || len(raw) > 2048 {
		return nil, ErrInvalidSourceURL
	}
	parsed, err := url.ParseRequestURI(raw)
	if err != nil || parsed.Host == "" || parsed.Scheme != "https" || parsed.User != nil || parsed.Port() != "" {
		return nil, ErrInvalidSourceURL
	}
	return parsed, nil
}

func isHost(parsed *url.URL, allowed ...string) bool {
	host := strings.ToLower(parsed.Hostname())
	for _, candidate := range allowed {
		if host == candidate {
			return true
		}
	}
	return false
}

func getJSON(ctx context.Context, client *http.Client, request *http.Request, destination any) error {
	response, err := client.Do(request.WithContext(ctx))
	if err != nil {
		return &resolverError{Status: http.StatusBadGateway, Code: "provider_unavailable", Message: "The image provider could not be reached.", Cause: err}
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
		status, code, message := http.StatusBadGateway, "provider_error", "The image provider rejected the request."
		if response.StatusCode == http.StatusNotFound {
			status, code, message = http.StatusNotFound, "image_not_found", "The image was not found from the provider."
		} else if response.StatusCode == http.StatusTooManyRequests {
			status, code, message = http.StatusServiceUnavailable, "provider_rate_limited", "The image provider rate limit has been reached."
		}
		return &resolverError{Status: status, Code: code, Message: message}
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, maxProviderResponseBytes))
	if err := decoder.Decode(destination); err != nil {
		return &resolverError{Status: http.StatusBadGateway, Code: "invalid_provider_response", Message: "The image provider returned an invalid response.", Cause: err}
	}
	return nil
}

func newGETRequest(rawURL string) (*http.Request, error) {
	request, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build provider request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "Filterest-Image-Source-Picker/1.0")
	return request, nil
}

func notConfigured(providerName, environmentVariable string) error {
	return &resolverError{Status: http.StatusServiceUnavailable, Code: "provider_not_configured", Message: fmt.Sprintf("%s is not configured. Set %s on the server.", providerName, environmentVariable)}
}

func finalPathSegment(path string) string {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) == 0 {
		return ""
	}
	return parts[len(parts)-1]
}

func pathContainsSegment(path string, allowed ...string) bool {
	for _, part := range strings.Split(strings.Trim(path, "/"), "/") {
		for _, candidate := range allowed {
			if strings.EqualFold(part, candidate) {
				return true
			}
		}
	}
	return false
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func invalidProviderPhotoURL(providerName string) error {
	return &resolverError{Status: http.StatusBadRequest, Code: "invalid_provider_photo_url", Message: "The " + providerName + " URL does not identify an individual photo."}
}

func invalidProviderPayload(providerName string) error {
	return &resolverError{Status: http.StatusBadGateway, Code: "incomplete_provider_response", Message: providerName + " did not return the required image and creator metadata."}
}
