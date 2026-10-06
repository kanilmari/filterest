// latest_stable_release_checker.go
// Checks the newest published stable Filterest release without changing the app.
// Bridges GitHub's public release API with administrator-facing version status.
// Exists so update awareness stays bounded, cached, and independent of readiness.
package release_updates

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	latestStableReleaseEndpoint = "https://api.github.com/repos/kanilmari/filterest/releases/latest"
	latestReleaseResponseLimit  = 512 * 1024
	latestReleaseSuccessTTL     = 5 * time.Minute
	latestReleaseFailureTTL     = 15 * time.Minute
	// A short process-wide cooldown absorbs double-clicks and overlapping admin tabs
	// without making a deliberate retry wait for the normal five-minute cache.
	latestReleaseForcedCheckCooldown = 30 * time.Second
)

type UpdateStatus string

const (
	UpdateStatusAvailable     UpdateStatus = "available"
	UpdateStatusCurrent       UpdateStatus = "current"
	UpdateStatusAheadOfStable UpdateStatus = "ahead_of_stable"
	UpdateStatusUnavailable   UpdateStatus = "unavailable"
)

// Status is the safe administrator-facing result of one cached stable-release check.
type Status struct {
	LatestStableVersion    string       `json:"latest_stable_version,omitempty"`
	UpdateStatus           UpdateStatus `json:"update_status"`
	UpdateAvailable        bool         `json:"update_available"`
	ReleaseURL             string       `json:"latest_release_url,omitempty"`
	CheckedAt              string       `json:"update_checked_at,omitempty"`
	RefreshAllowedAt       string       `json:"refresh_allowed_at,omitempty"`
	UpstreamCheckPerformed bool         `json:"upstream_check_performed"`
	LastSuccessfulCheckAt  string       `json:"last_successful_check_at,omitempty"`
}

type publishedRelease struct {
	TagName    string `json:"tag_name"`
	HTMLURL    string `json:"html_url"`
	Draft      bool   `json:"draft"`
	Prerelease bool   `json:"prerelease"`
}

type cachedPublishedRelease struct {
	lastSuccessfulRelease publishedRelease
	lastSuccessfulAt      time.Time
	err                   error
	checkedAt             time.Time
	expiresAt             time.Time
}

// Checker owns the bounded HTTP client and in-memory release lookup cache.
type Checker struct {
	client   *http.Client
	endpoint string
	now      func() time.Time

	mu    sync.Mutex
	cache cachedPublishedRelease
}

// NewChecker creates a stable-release checker. Tests may provide a local HTTP
// endpoint; production uses the package-level fixed GitHub repository endpoint.
func NewChecker(client *http.Client, endpoint string) *Checker {
	if client == nil {
		client = defaultHTTPClient()
	}
	return &Checker{
		client:   client,
		endpoint: strings.TrimSpace(endpoint),
		now:      time.Now,
	}
}

var defaultChecker = NewChecker(defaultHTTPClient(), latestStableReleaseEndpoint)

// CheckLatestStable compares the running semantic version with the newest
// published, non-draft, non-prerelease Filterest release. Failures are data,
// never readiness errors, so offline installations continue to operate.
func CheckLatestStable(ctx context.Context, currentVersion string) Status {
	return defaultChecker.Check(ctx, currentVersion)
}

// CheckLatestStableNow bypasses the ordinary cache after a short process-wide
// cooldown. The same checker mutex coalesces overlapping administrator requests.
func CheckLatestStableNow(ctx context.Context, currentVersion string) Status {
	return defaultChecker.CheckNow(ctx, currentVersion)
}

// Check performs one cached comparison against the configured release source.
func (checker *Checker) Check(ctx context.Context, currentVersion string) Status {
	return checker.check(ctx, currentVersion, false)
}

// CheckNow requests a fresh upstream lookup unless another lookup completed
// during the short anti-spam cooldown.
func (checker *Checker) CheckNow(ctx context.Context, currentVersion string) Status {
	return checker.check(ctx, currentVersion, true)
}

func (checker *Checker) check(ctx context.Context, currentVersion string, force bool) Status {
	result := Status{UpdateStatus: UpdateStatusUnavailable}
	current, err := parseSemanticVersion(currentVersion)
	if err != nil {
		return result
	}

	snapshot, refreshAllowedAt, upstreamCheckMade := checker.latestPublishedRelease(ctx, force)
	if !snapshot.checkedAt.IsZero() {
		result.CheckedAt = snapshot.checkedAt.UTC().Format(time.RFC3339)
	}
	if !refreshAllowedAt.IsZero() {
		result.RefreshAllowedAt = refreshAllowedAt.UTC().Format(time.RFC3339)
	}
	result.UpstreamCheckPerformed = upstreamCheckMade
	if snapshot.lastSuccessfulAt.IsZero() {
		return result
	}
	result.LastSuccessfulCheckAt = snapshot.lastSuccessfulAt.UTC().Format(time.RFC3339)
	latestVersion := strings.TrimPrefix(strings.TrimSpace(snapshot.lastSuccessfulRelease.TagName), "v")
	result.LatestStableVersion = latestVersion
	result.ReleaseURL = validatedFilterestReleaseURL(snapshot.lastSuccessfulRelease.HTMLURL)
	// A failed lookup keeps the last release as explicitly historical evidence;
	// it must never keep the available marker or claim a successful comparison.
	if snapshot.err != nil {
		return result
	}
	latest, err := parseSemanticVersion(latestVersion)
	if err != nil {
		return result
	}
	switch compareSemanticVersions(current, latest) {
	case -1:
		result.UpdateStatus = UpdateStatusAvailable
		result.UpdateAvailable = true
	case 0:
		result.UpdateStatus = UpdateStatusCurrent
	default:
		result.UpdateStatus = UpdateStatusAheadOfStable
	}
	return result
}

func (checker *Checker) latestPublishedRelease(
	ctx context.Context,
	force bool,
) (cachedPublishedRelease, time.Time, bool) {
	checker.mu.Lock()
	defer checker.mu.Unlock()

	now := checker.now().UTC()
	refreshAllowedAt := time.Time{}
	if !checker.cache.checkedAt.IsZero() {
		refreshAllowedAt = checker.cache.checkedAt.Add(latestReleaseForcedCheckCooldown)
	}
	if force && !refreshAllowedAt.IsZero() && now.Before(refreshAllowedAt) {
		return checker.cache, refreshAllowedAt, false
	}
	if !force && !checker.cache.expiresAt.IsZero() && now.Before(checker.cache.expiresAt) {
		return checker.cache, refreshAllowedAt, false
	}

	release, err := checker.fetchLatestPublishedRelease(ctx)
	ttl := latestReleaseSuccessTTL
	if err != nil {
		ttl = latestReleaseFailureTTL
	}
	lastSuccessfulRelease, lastSuccessfulAt := checker.cache.lastSuccessfulRelease, checker.cache.lastSuccessfulAt
	if err == nil {
		lastSuccessfulRelease, lastSuccessfulAt = release, now
	}
	checker.cache = cachedPublishedRelease{
		lastSuccessfulRelease: lastSuccessfulRelease,
		lastSuccessfulAt:      lastSuccessfulAt,
		err:                   err,
		checkedAt:             now,
		expiresAt:             now.Add(ttl),
	}
	return checker.cache, now.Add(latestReleaseForcedCheckCooldown), true
}

func (checker *Checker) fetchLatestPublishedRelease(ctx context.Context) (publishedRelease, error) {
	if checker.endpoint == "" {
		return publishedRelease{}, errors.New("latest release endpoint is empty")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, checker.endpoint, nil)
	if err != nil {
		return publishedRelease{}, fmt.Errorf("build latest release request: %w", err)
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("User-Agent", "Filterest-version-check")

	response, err := checker.client.Do(request)
	if err != nil {
		return publishedRelease{}, fmt.Errorf("fetch latest stable release: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return publishedRelease{}, fmt.Errorf("latest stable release returned HTTP %d", response.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(response.Body, latestReleaseResponseLimit+1))
	if err != nil {
		return publishedRelease{}, fmt.Errorf("read latest stable release: %w", err)
	}
	if len(body) > latestReleaseResponseLimit {
		return publishedRelease{}, errors.New("latest stable release response is too large")
	}

	var release publishedRelease
	if err := json.Unmarshal(body, &release); err != nil {
		return publishedRelease{}, fmt.Errorf("decode latest stable release: %w", err)
	}
	if release.Draft || release.Prerelease {
		return publishedRelease{}, errors.New("latest release is not a published stable release")
	}
	if strings.TrimSpace(release.TagName) == "" {
		return publishedRelease{}, errors.New("latest stable release has no tag")
	}
	if _, err := parseSemanticVersion(release.TagName); err != nil {
		return publishedRelease{}, err
	}
	return release, nil
}

func defaultHTTPClient() *http.Client {
	return &http.Client{
		Timeout: 3 * time.Second,
		CheckRedirect: func(request *http.Request, via []*http.Request) error {
			if len(via) >= 2 {
				return errors.New("too many release-check redirects")
			}
			if !strings.EqualFold(request.URL.Scheme, "https") || !strings.EqualFold(request.URL.Hostname(), "api.github.com") {
				return errors.New("release-check redirect left api.github.com")
			}
			return nil
		},
	}
}

func parseSemanticVersion(value string) ([3]int, error) {
	var parsed [3]int
	trimmed := strings.TrimPrefix(strings.TrimSpace(value), "v")
	parts := strings.Split(trimmed, ".")
	if len(parts) != len(parsed) {
		return parsed, fmt.Errorf("invalid semantic version %q", value)
	}
	for index, part := range parts {
		if part == "" {
			return parsed, fmt.Errorf("invalid semantic version %q", value)
		}
		number, err := strconv.Atoi(part)
		if err != nil || number < 0 {
			return parsed, fmt.Errorf("invalid semantic version %q", value)
		}
		parsed[index] = number
	}
	return parsed, nil
}

func compareSemanticVersions(left [3]int, right [3]int) int {
	for index := range left {
		if left[index] < right[index] {
			return -1
		}
		if left[index] > right[index] {
			return 1
		}
	}
	return 0
}

func validatedFilterestReleaseURL(value string) string {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || !strings.EqualFold(parsed.Scheme, "https") || !strings.EqualFold(parsed.Hostname(), "github.com") {
		return ""
	}
	if !strings.HasPrefix(parsed.EscapedPath(), "/kanilmari/filterest/releases/") {
		return ""
	}
	return parsed.String()
}
