// config.go
// Loads server-only provider credentials for the reusable image source picker.
// Bridges operator-owned environment values and the provider API clients.
// Exists so public frontend code never receives Unsplash, Pexels, or Pixabay keys.
package image_source_picker

import (
	"net/http"
	"os"
	"strings"
	"time"
)

const defaultRequestTimeout = 20 * time.Second

// Config holds secrets and HTTP test seams. Production callers should leave
// the API base URLs empty so requests use the fixed provider endpoints.
type Config struct {
	UnsplashAccessKey string
	PexelsAPIKey      string
	PixabayAPIKey     string
	HTTPClient        *http.Client
	UnsplashAPIBase   string
	PexelsAPIBase     string
	PixabayAPIBase    string
}

// ConfigFromEnv reads credentials from the protected runtime environment.
// Missing values disable only the corresponding provider.
func ConfigFromEnv() Config {
	return Config{
		UnsplashAccessKey: strings.TrimSpace(os.Getenv("UNSPLASH_ACCESS_KEY")),
		PexelsAPIKey:      strings.TrimSpace(os.Getenv("PEXELS_API_KEY")),
		PixabayAPIKey:     strings.TrimSpace(os.Getenv("PIXABAY_API_KEY")),
	}
}

func (config Config) client() *http.Client {
	if config.HTTPClient != nil {
		return config.HTTPClient
	}
	return &http.Client{Timeout: defaultRequestTimeout}
}

func configuredBase(value, fallback string) string {
	value = strings.TrimRight(strings.TrimSpace(value), "/")
	if value == "" {
		return fallback
	}
	return value
}
