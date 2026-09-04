// service.go
// Coordinates provider detection, metadata resolution, tracking, and safe image downloads.
// Bridges a public photo-page URL and the local File object consumed by row creation.
// Exists to prevent arbitrary server-side fetches while honoring provider API requirements.
package image_source_picker

import (
	"context"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"time"
)

const maxImageBytes = 25 << 20

var allowedImageContentTypes = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/webp": ".webp",
	"image/avif": ".avif",
	"image/gif":  ".gif",
}

type DownloadedImage struct {
	Bytes       []byte
	ContentType string
	Filename    string
}

type Service struct {
	providers []provider
	client    *http.Client
	config    Config
	now       func() time.Time
}

func NewService(config Config) *Service {
	client := config.client()
	return &Service{
		providers: []provider{newUnsplashProvider(config, client), newPexelsProvider(config, client), newPixabayProvider(config, client)},
		client:    client,
		config:    config,
		now:       time.Now,
	}
}

func (service *Service) Providers() []ProviderInfo {
	result := make([]ProviderInfo, 0, len(service.providers))
	for _, item := range service.providers {
		result = append(result, item.Info())
	}
	return result
}

func (service *Service) Resolve(ctx context.Context, rawURL string) (Selection, error) {
	parsed, err := parsePublicSourceURL(rawURL)
	if err != nil {
		return Selection{}, &resolverError{Status: http.StatusBadRequest, Code: "invalid_source_url", Message: "Enter a complete Unsplash, Pexels, or Pixabay photo-page URL.", Cause: err}
	}
	for _, item := range service.providers {
		assetID, matched, parseErr := item.ParseURL(parsed)
		if !matched {
			continue
		}
		if parseErr != nil {
			return Selection{}, parseErr
		}
		selection, resolveErr := item.Resolve(ctx, assetID)
		if resolveErr != nil {
			return Selection{}, resolveErr
		}
		selection.SchemaVersion = SchemaVersion
		selection.MetadataSource = "provider_api"
		selection.ResolvedAt = service.now().UTC()
		return selection, nil
	}
	return Selection{}, &resolverError{Status: http.StatusBadRequest, Code: "unsupported_provider", Message: "Only Unsplash, Pexels, and Pixabay photo-page URLs are supported.", Cause: ErrUnsupportedSource}
}

func (service *Service) Download(ctx context.Context, rawURL, purpose string) (DownloadedImage, Selection, error) {
	if purpose != "preview" && purpose != "select" {
		return DownloadedImage{}, Selection{}, &resolverError{Status: http.StatusBadRequest, Code: "invalid_purpose", Message: "Image purpose must be preview or select."}
	}
	selection, err := service.Resolve(ctx, rawURL)
	if err != nil {
		return DownloadedImage{}, Selection{}, err
	}
	imageURL := selection.Image.PreviewURL
	if purpose == "select" {
		imageURL = selection.Image.OriginalURL
		if err := service.trackSelection(ctx, selection); err != nil {
			return DownloadedImage{}, Selection{}, err
		}
	}
	image, err := service.fetchImage(ctx, selection.Provider, selection.ProviderAssetID, imageURL)
	if err != nil {
		return DownloadedImage{}, Selection{}, err
	}
	return image, selection, nil
}

func (service *Service) trackSelection(ctx context.Context, selection Selection) error {
	if selection.Provider != "unsplash" || selection.DownloadTrackingURL == "" {
		return nil
	}
	parsed, err := url.Parse(selection.DownloadTrackingURL)
	if err != nil || parsed.Scheme != "https" || parsed.User != nil || parsed.Port() != "" || !isHost(parsed, "api.unsplash.com") {
		return &resolverError{Status: http.StatusBadGateway, Code: "invalid_tracking_url", Message: "Unsplash returned an invalid download tracking URL."}
	}
	request, err := newGETRequest(parsed.String())
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Client-ID "+strings.TrimSpace(service.config.UnsplashAccessKey))
	request.Header.Set("Accept-Version", "v1")
	response, err := service.client.Do(request.WithContext(ctx))
	if err != nil {
		return &resolverError{Status: http.StatusBadGateway, Code: "tracking_unavailable", Message: "Unsplash download tracking could not be completed.", Cause: err}
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return &resolverError{Status: http.StatusBadGateway, Code: "tracking_failed", Message: "Unsplash download tracking was rejected."}
	}
	return nil
}

func (service *Service) fetchImage(ctx context.Context, providerKey, assetID, rawURL string) (DownloadedImage, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil || !allowedProviderMediaURL(providerKey, parsed) {
		return DownloadedImage{}, &resolverError{Status: http.StatusBadGateway, Code: "invalid_image_url", Message: "The provider returned an unsafe image URL."}
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return DownloadedImage{}, err
	}
	request.Header.Set("Accept", "image/avif,image/webp,image/png,image/jpeg,image/gif")
	request.Header.Set("User-Agent", "Filterest-Image-Source-Picker/1.0")

	client := *service.client
	previousRedirectPolicy := client.CheckRedirect
	client.CheckRedirect = func(next *http.Request, via []*http.Request) error {
		if len(via) >= 5 || !allowedProviderMediaURL(providerKey, next.URL) {
			return http.ErrUseLastResponse
		}
		if previousRedirectPolicy != nil {
			return previousRedirectPolicy(next, via)
		}
		return nil
	}
	response, err := client.Do(request)
	if err != nil {
		return DownloadedImage{}, &resolverError{Status: http.StatusBadGateway, Code: "image_unavailable", Message: "The selected image could not be downloaded.", Cause: err}
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
		return DownloadedImage{}, &resolverError{Status: http.StatusBadGateway, Code: "image_download_failed", Message: "The provider rejected the image download."}
	}
	if response.ContentLength > maxImageBytes {
		return DownloadedImage{}, &resolverError{Status: http.StatusRequestEntityTooLarge, Code: "image_too_large", Message: "The selected image exceeds the 25 MB limit."}
	}
	contents, err := io.ReadAll(io.LimitReader(response.Body, maxImageBytes+1))
	if err != nil {
		return DownloadedImage{}, &resolverError{Status: http.StatusBadGateway, Code: "image_read_failed", Message: "The selected image could not be read.", Cause: err}
	}
	if len(contents) > maxImageBytes {
		return DownloadedImage{}, &resolverError{Status: http.StatusRequestEntityTooLarge, Code: "image_too_large", Message: "The selected image exceeds the 25 MB limit."}
	}
	contentType := strings.ToLower(strings.TrimSpace(strings.Split(response.Header.Get("Content-Type"), ";")[0]))
	if _, ok := allowedImageContentTypes[contentType]; !ok {
		contentType = strings.ToLower(http.DetectContentType(contents))
	}
	extension, ok := allowedImageContentTypes[contentType]
	if !ok {
		return DownloadedImage{}, &resolverError{Status: http.StatusUnsupportedMediaType, Code: "unsupported_image_type", Message: "The provider response is not a supported raster image."}
	}
	filename := sanitizeFilename(providerKey + "-" + assetID + extension)
	return DownloadedImage{Bytes: contents, ContentType: contentType, Filename: filename}, nil
}

func allowedProviderMediaURL(providerKey string, parsed *url.URL) bool {
	if parsed == nil || parsed.Scheme != "https" || parsed.User != nil || parsed.Port() != "" {
		return false
	}
	switch providerKey {
	case "unsplash":
		return isHost(parsed, "images.unsplash.com", "plus.unsplash.com")
	case "pexels":
		return isHost(parsed, "images.pexels.com")
	case "pixabay":
		return isHost(parsed, "cdn.pixabay.com", "pixabay.com", "www.pixabay.com")
	default:
		return false
	}
}

func sanitizeFilename(value string) string {
	value = filepath.Base(strings.TrimSpace(value))
	value = strings.Map(func(char rune) rune {
		if char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9' || char == '-' || char == '_' || char == '.' {
			return char
		}
		return '-'
	}, value)
	if value == "" || value == "." {
		return "selected-image.jpg"
	}
	return value
}

func contentDisposition(filename string) string {
	return mime.FormatMediaType("attachment", map[string]string{"filename": filename})
}

func metadataFilename(selection Selection) string {
	extension := ".jpg"
	if parsed, err := url.Parse(selection.Image.OriginalURL); err == nil {
		if candidate := strings.ToLower(filepath.Ext(parsed.Path)); candidate != "" && len(candidate) <= 6 {
			extension = candidate
		}
	}
	return sanitizeFilename(fmt.Sprintf("%s-%s%s", selection.Provider, selection.ProviderAssetID, extension))
}
