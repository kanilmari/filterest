// providers.go
// Resolves public Unsplash, Pexels, and Pixabay photo-page URLs through their APIs.
// Bridges provider-specific payloads into one stable Filterest image selection shape.
// Exists so the browser can work with credited image metadata without learning API keys.
package image_source_picker

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

const (
	unsplashAPIBase = "https://api.unsplash.com"
	pexelsAPIBase   = "https://api.pexels.com/v1"
	pixabayAPIBase  = "https://pixabay.com/api"
)

var (
	unsplashIDPattern         = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)
	numericAssetSuffixPattern = regexp.MustCompile(`(?:^|-)([1-9][0-9]*)$`)
)

type unsplashProvider struct {
	accessKey string
	apiBase   string
	client    *http.Client
}

func newUnsplashProvider(config Config, client *http.Client) *unsplashProvider {
	return &unsplashProvider{accessKey: strings.TrimSpace(config.UnsplashAccessKey), apiBase: configuredBase(config.UnsplashAPIBase, unsplashAPIBase), client: client}
}

func (provider *unsplashProvider) Info() ProviderInfo {
	return ProviderInfo{Key: "unsplash", Name: "Unsplash", Configured: provider.accessKey != "", HomepageURL: "https://unsplash.com/", LicenseName: "Unsplash License", LicenseURL: "https://unsplash.com/license", APIGuidelinesURL: "https://help.unsplash.com/en/collections/1451694-api-guidelines"}
}

func (provider *unsplashProvider) ParseURL(parsed *url.URL) (string, bool, error) {
	if !isHost(parsed, "unsplash.com", "www.unsplash.com") {
		return "", false, nil
	}
	parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	if len(parts) < 2 || parts[0] != "photos" {
		return "", true, invalidProviderPhotoURL("Unsplash")
	}
	segment, err := url.PathUnescape(parts[1])
	if err != nil {
		return "", true, invalidProviderPhotoURL("Unsplash")
	}
	if unsplashIDPattern.MatchString(segment) {
		return segment, true, nil
	}
	if len(segment) > 11 {
		candidate := segment[len(segment)-11:]
		separatorIndex := len(segment) - 12
		if separatorIndex >= 0 && segment[separatorIndex] == '-' && unsplashIDPattern.MatchString(candidate) {
			return candidate, true, nil
		}
	}
	return "", true, invalidProviderPhotoURL("Unsplash")
}

func (provider *unsplashProvider) Resolve(ctx context.Context, assetID string) (Selection, error) {
	if provider.accessKey == "" {
		return Selection{}, notConfigured("Unsplash", "UNSPLASH_ACCESS_KEY")
	}
	request, err := newGETRequest(provider.apiBase + "/photos/" + url.PathEscape(assetID))
	if err != nil {
		return Selection{}, err
	}
	request.Header.Set("Authorization", "Client-ID "+provider.accessKey)
	request.Header.Set("Accept-Version", "v1")
	var payload struct {
		ID             string `json:"id"`
		Description    string `json:"description"`
		AltDescription string `json:"alt_description"`
		Width          int    `json:"width"`
		Height         int    `json:"height"`
		URLs           struct {
			Raw     string `json:"raw"`
			Full    string `json:"full"`
			Regular string `json:"regular"`
			Small   string `json:"small"`
		} `json:"urls"`
		Links struct {
			HTML             string `json:"html"`
			DownloadLocation string `json:"download_location"`
		} `json:"links"`
		User struct {
			Name  string `json:"name"`
			Links struct {
				HTML string `json:"html"`
			} `json:"links"`
		} `json:"user"`
	}
	if err := getJSON(ctx, provider.client, request, &payload); err != nil {
		return Selection{}, err
	}
	if payload.ID == "" || payload.Links.HTML == "" || payload.User.Name == "" {
		return Selection{}, invalidProviderPayload("Unsplash")
	}
	description := firstNonEmpty(payload.Description, payload.AltDescription)
	previewURL := firstNonEmpty(payload.URLs.Regular, payload.URLs.Small, payload.URLs.Full)
	originalURL := firstNonEmpty(payload.URLs.Full, payload.URLs.Raw, previewURL)
	if previewURL == "" || originalURL == "" {
		return Selection{}, invalidProviderPayload("Unsplash")
	}
	info := provider.Info()
	return Selection{
		Provider: "unsplash", ProviderName: info.Name, ProviderAssetID: payload.ID,
		SourcePageURL: payload.Links.HTML, CreatorName: payload.User.Name, CreatorProfileURL: payload.User.Links.HTML,
		Description: strings.TrimSpace(description), License: LicenseReference{Name: info.LicenseName, URL: info.LicenseURL, Source: "provider_terms"},
		Attribution:         Attribution{Text: fmt.Sprintf("Photo by %s on Unsplash", payload.User.Name), CreatorURL: payload.User.Links.HTML, ProviderName: info.Name, ProviderURL: info.HomepageURL, APIRequirementNote: "Unsplash API use requires attribution to the photographer and Unsplash."},
		Image:               ImageResource{PreviewURL: previewURL, OriginalURL: originalURL, Width: payload.Width, Height: payload.Height, AltText: strings.TrimSpace(payload.AltDescription)},
		DownloadTrackingURL: payload.Links.DownloadLocation,
	}, nil
}

type pexelsProvider struct {
	apiKey, apiBase string
	client          *http.Client
}

func newPexelsProvider(config Config, client *http.Client) *pexelsProvider {
	return &pexelsProvider{apiKey: strings.TrimSpace(config.PexelsAPIKey), apiBase: configuredBase(config.PexelsAPIBase, pexelsAPIBase), client: client}
}

func (provider *pexelsProvider) Info() ProviderInfo {
	return ProviderInfo{Key: "pexels", Name: "Pexels", Configured: provider.apiKey != "", HomepageURL: "https://www.pexels.com/", LicenseName: "Pexels License", LicenseURL: "https://www.pexels.com/license/", APIGuidelinesURL: "https://www.pexels.com/api/documentation/"}
}

func (provider *pexelsProvider) ParseURL(parsed *url.URL) (string, bool, error) {
	if !isHost(parsed, "pexels.com", "www.pexels.com") {
		return "", false, nil
	}
	if !pathContainsSegment(parsed.Path, "photo") {
		return "", true, invalidProviderPhotoURL("Pexels")
	}
	match := numericAssetSuffixPattern.FindStringSubmatch(finalPathSegment(parsed.Path))
	if len(match) != 2 {
		return "", true, invalidProviderPhotoURL("Pexels")
	}
	return match[1], true, nil
}

func (provider *pexelsProvider) Resolve(ctx context.Context, assetID string) (Selection, error) {
	if provider.apiKey == "" {
		return Selection{}, notConfigured("Pexels", "PEXELS_API_KEY")
	}
	request, err := newGETRequest(provider.apiBase + "/photos/" + url.PathEscape(assetID))
	if err != nil {
		return Selection{}, err
	}
	request.Header.Set("Authorization", provider.apiKey)
	var payload struct {
		ID              int    `json:"id"`
		Width           int    `json:"width"`
		Height          int    `json:"height"`
		URL             string `json:"url"`
		Photographer    string `json:"photographer"`
		PhotographerURL string `json:"photographer_url"`
		Alt             string `json:"alt"`
		Src             struct {
			Original string `json:"original"`
			Large2x  string `json:"large2x"`
			Large    string `json:"large"`
			Medium   string `json:"medium"`
		} `json:"src"`
	}
	if err := getJSON(ctx, provider.client, request, &payload); err != nil {
		return Selection{}, err
	}
	if payload.ID == 0 || payload.URL == "" || payload.Photographer == "" {
		return Selection{}, invalidProviderPayload("Pexels")
	}
	previewURL := firstNonEmpty(payload.Src.Large, payload.Src.Medium, payload.Src.Large2x)
	originalURL := firstNonEmpty(payload.Src.Original, payload.Src.Large2x, previewURL)
	if previewURL == "" || originalURL == "" {
		return Selection{}, invalidProviderPayload("Pexels")
	}
	info := provider.Info()
	return Selection{
		Provider: "pexels", ProviderName: info.Name, ProviderAssetID: strconv.Itoa(payload.ID), SourcePageURL: payload.URL,
		CreatorName: payload.Photographer, CreatorProfileURL: payload.PhotographerURL, Description: strings.TrimSpace(payload.Alt),
		License:     LicenseReference{Name: info.LicenseName, URL: info.LicenseURL, Source: "provider_terms"},
		Attribution: Attribution{Text: fmt.Sprintf("Photo by %s on Pexels", payload.Photographer), CreatorURL: payload.PhotographerURL, ProviderName: info.Name, ProviderURL: info.HomepageURL, APIRequirementNote: "Pexels API use requires a prominent Pexels link and recommends photographer credit when possible."},
		Image:       ImageResource{PreviewURL: previewURL, OriginalURL: originalURL, Width: payload.Width, Height: payload.Height, AltText: strings.TrimSpace(payload.Alt)},
	}, nil
}

type pixabayProvider struct {
	apiKey, apiBase string
	client          *http.Client
}

func newPixabayProvider(config Config, client *http.Client) *pixabayProvider {
	return &pixabayProvider{apiKey: strings.TrimSpace(config.PixabayAPIKey), apiBase: configuredBase(config.PixabayAPIBase, pixabayAPIBase), client: client}
}

func (provider *pixabayProvider) Info() ProviderInfo {
	return ProviderInfo{Key: "pixabay", Name: "Pixabay", Configured: provider.apiKey != "", HomepageURL: "https://pixabay.com/", LicenseName: "Pixabay Content License", LicenseURL: "https://pixabay.com/service/license-summary/", APIGuidelinesURL: "https://pixabay.com/api/docs/"}
}

func (provider *pixabayProvider) ParseURL(parsed *url.URL) (string, bool, error) {
	if !isHost(parsed, "pixabay.com", "www.pixabay.com") {
		return "", false, nil
	}
	if !pathContainsSegment(parsed.Path, "photos", "illustrations", "vectors") {
		return "", true, invalidProviderPhotoURL("Pixabay")
	}
	match := numericAssetSuffixPattern.FindStringSubmatch(finalPathSegment(parsed.Path))
	if len(match) != 2 {
		return "", true, invalidProviderPhotoURL("Pixabay")
	}
	return match[1], true, nil
}

func (provider *pixabayProvider) Resolve(ctx context.Context, assetID string) (Selection, error) {
	if provider.apiKey == "" {
		return Selection{}, notConfigured("Pixabay", "PIXABAY_API_KEY")
	}
	endpoint, err := url.Parse(provider.apiBase)
	if err != nil {
		return Selection{}, err
	}
	query := endpoint.Query()
	query.Set("key", provider.apiKey)
	query.Set("id", assetID)
	endpoint.RawQuery = query.Encode()
	request, err := newGETRequest(endpoint.String())
	if err != nil {
		return Selection{}, err
	}
	var payload struct {
		Hits []struct {
			ID            int    `json:"id"`
			ImageWidth    int    `json:"imageWidth"`
			ImageHeight   int    `json:"imageHeight"`
			UserID        int    `json:"user_id"`
			PageURL       string `json:"pageURL"`
			WebformatURL  string `json:"webformatURL"`
			LargeImageURL string `json:"largeImageURL"`
			ImageURL      string `json:"imageURL"`
			User          string `json:"user"`
			Tags          string `json:"tags"`
		} `json:"hits"`
	}
	if err := getJSON(ctx, provider.client, request, &payload); err != nil {
		return Selection{}, err
	}
	if len(payload.Hits) == 0 {
		return Selection{}, &resolverError{Status: http.StatusNotFound, Code: "image_not_found", Message: "The image was not found from Pixabay."}
	}
	item := payload.Hits[0]
	if item.ID == 0 || item.PageURL == "" || item.User == "" {
		return Selection{}, invalidProviderPayload("Pixabay")
	}
	profileURL := ""
	if item.UserID > 0 {
		profileURL = fmt.Sprintf("https://pixabay.com/users/%s-%d/", url.PathEscape(item.User), item.UserID)
	}
	previewURL := firstNonEmpty(item.WebformatURL, item.LargeImageURL, item.ImageURL)
	originalURL := firstNonEmpty(item.ImageURL, item.LargeImageURL, item.WebformatURL)
	if previewURL == "" || originalURL == "" {
		return Selection{}, invalidProviderPayload("Pixabay")
	}
	info := provider.Info()
	return Selection{
		Provider: "pixabay", ProviderName: info.Name, ProviderAssetID: strconv.Itoa(item.ID), SourcePageURL: item.PageURL,
		CreatorName: item.User, CreatorProfileURL: profileURL, Description: strings.TrimSpace(item.Tags),
		License:     LicenseReference{Name: info.LicenseName, URL: info.LicenseURL, Source: "provider_terms"},
		Attribution: Attribution{Text: fmt.Sprintf("Image by %s on Pixabay", item.User), CreatorURL: profileURL, ProviderName: info.Name, ProviderURL: info.HomepageURL, APIRequirementNote: "Pixabay asks API applications to show users where displayed results come from."},
		Image:       ImageResource{PreviewURL: previewURL, OriginalURL: originalURL, Width: item.ImageWidth, Height: item.ImageHeight, AltText: strings.TrimSpace(item.Tags)},
	}, nil
}
