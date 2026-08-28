// latest_stable_release_checker_test.go
// Verifies stable release comparison, privacy-safe failures, and request caching.
// Bridges a local HTTP fixture with the production update-status contract.
// Exists so tests never depend on GitHub or an internet connection.
package release_updates

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (function roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

func releaseResponseClient(body string, requestCount *atomic.Int32) *http.Client {
	return &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if requestCount != nil {
			requestCount.Add(1)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader(body)),
			Request:    request,
		}, nil
	})}
}

func TestCheckerComparesCurrentVersionWithLatestStable(t *testing.T) {
	body := `{
			"tag_name":"v8.30.1",
			"html_url":"https://github.com/kanilmari/filterest/releases/tag/v8.30.1",
			"draft":false,
			"prerelease":false
		}`

	tests := []struct {
		current         string
		wantStatus      UpdateStatus
		updateAvailable bool
	}{
		{current: "8.30.0", wantStatus: UpdateStatusAvailable, updateAvailable: true},
		{current: "8.30.1", wantStatus: UpdateStatusCurrent},
		{current: "8.31.0", wantStatus: UpdateStatusAheadOfStable},
	}
	for _, test := range tests {
		checker := NewChecker(releaseResponseClient(body, nil), "https://updates.invalid/latest")
		result := checker.Check(context.Background(), test.current)
		if result.UpdateStatus != test.wantStatus || result.UpdateAvailable != test.updateAvailable {
			t.Fatalf("Check(%q) = %#v, want status=%q available=%v", test.current, result, test.wantStatus, test.updateAvailable)
		}
		if result.LatestStableVersion != "8.30.1" || result.CheckedAt == "" {
			t.Fatalf("Check(%q) release metadata = %#v", test.current, result)
		}
	}
}

func TestCheckerCachesLatestReleaseResponse(t *testing.T) {
	var requestCount atomic.Int32
	checker := NewChecker(
		releaseResponseClient(`{"tag_name":"v8.30.1","draft":false,"prerelease":false}`, &requestCount),
		"https://updates.invalid/latest",
	)
	checker.Check(context.Background(), "8.30.0")
	checker.Check(context.Background(), "8.30.1")

	if requestCount.Load() != 1 {
		t.Fatalf("release API requests = %d, want 1 cached request", requestCount.Load())
	}
}

func TestCheckerRefreshesSuccessfulResponseAfterFiveMinutes(t *testing.T) {
	var requestCount atomic.Int32
	currentTime := time.Date(2026, time.August, 25, 12, 0, 0, 0, time.UTC)
	checker := NewChecker(
		releaseResponseClient(`{"tag_name":"v8.30.1","draft":false,"prerelease":false}`, &requestCount),
		"https://updates.invalid/latest",
	)
	checker.now = func() time.Time { return currentTime }

	checker.Check(context.Background(), "8.30.0")
	currentTime = currentTime.Add(latestReleaseSuccessTTL - time.Second)
	checker.Check(context.Background(), "8.30.0")
	if requestCount.Load() != 1 {
		t.Fatalf("release API requests before five-minute expiry = %d, want 1", requestCount.Load())
	}

	currentTime = currentTime.Add(time.Second)
	result := checker.Check(context.Background(), "8.30.0")
	if requestCount.Load() != 2 || !result.UpstreamCheckPerformed {
		t.Fatalf("expired cache result = %#v, requests = %d, want fresh second request", result, requestCount.Load())
	}
}

func TestCheckerCheckNowBypassesCacheAfterShortCooldown(t *testing.T) {
	var requestCount atomic.Int32
	currentTime := time.Date(2026, time.August, 25, 12, 0, 0, 0, time.UTC)
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		version := "v8.30.1"
		if requestCount.Add(1) > 1 {
			version = "v8.30.2"
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     make(http.Header),
			Body: io.NopCloser(strings.NewReader(
				`{"tag_name":"` + version + `","draft":false,"prerelease":false}`,
			)),
			Request: request,
		}, nil
	})}
	checker := NewChecker(client, "https://updates.invalid/latest")
	checker.now = func() time.Time { return currentTime }

	initial := checker.Check(context.Background(), "8.30.0")
	currentTime = currentTime.Add(latestReleaseForcedCheckCooldown - time.Second)
	coalesced := checker.CheckNow(context.Background(), "8.30.0")
	if requestCount.Load() != 1 || coalesced.UpstreamCheckPerformed {
		t.Fatalf("cooldown result = %#v, requests = %d, want cached response", coalesced, requestCount.Load())
	}
	if coalesced.LatestStableVersion != initial.LatestStableVersion || coalesced.RefreshAllowedAt == "" {
		t.Fatalf("cooldown metadata = %#v, want original version and refresh time", coalesced)
	}

	currentTime = currentTime.Add(time.Second)
	refreshed := checker.CheckNow(context.Background(), "8.30.0")
	if requestCount.Load() != 2 || !refreshed.UpstreamCheckPerformed {
		t.Fatalf("forced refresh = %#v, requests = %d, want second upstream request", refreshed, requestCount.Load())
	}
	if refreshed.LatestStableVersion != "8.30.2" || refreshed.CheckedAt == initial.CheckedAt {
		t.Fatalf("forced refresh metadata = %#v, want new release and check time", refreshed)
	}
}

func TestCheckerCoalescesConcurrentCheckNowRequests(t *testing.T) {
	var requestCount atomic.Int32
	currentTime := time.Date(2026, time.August, 25, 12, 0, 0, 0, time.UTC)
	forcedRequestStarted := make(chan struct{})
	releaseForcedRequest := make(chan struct{})
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		count := requestCount.Add(1)
		if count == 2 {
			close(forcedRequestStarted)
			<-releaseForcedRequest
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     make(http.Header),
			Body: io.NopCloser(strings.NewReader(
				`{"tag_name":"v8.30.2","draft":false,"prerelease":false}`,
			)),
			Request: request,
		}, nil
	})}
	checker := NewChecker(client, "https://updates.invalid/latest")
	checker.now = func() time.Time { return currentTime }
	checker.Check(context.Background(), "8.30.0")
	currentTime = currentTime.Add(latestReleaseForcedCheckCooldown)

	start := make(chan struct{})
	results := make(chan Status, 2)
	var requests sync.WaitGroup
	requests.Add(2)
	for range 2 {
		go func() {
			defer requests.Done()
			<-start
			results <- checker.CheckNow(context.Background(), "8.30.0")
		}()
	}
	close(start)
	<-forcedRequestStarted
	close(releaseForcedRequest)
	requests.Wait()
	close(results)

	performedCount := 0
	for result := range results {
		if result.UpstreamCheckPerformed {
			performedCount++
		}
	}
	if requestCount.Load() != 2 || performedCount != 1 {
		t.Fatalf(
			"concurrent checks made %d upstream requests with %d performed results, want 2 total requests and one performed refresh",
			requestCount.Load(),
			performedCount,
		)
	}
}

func TestCheckerTreatsNetworkAndUnstableResponsesAsUnavailable(t *testing.T) {
	tests := []string{
		`{"tag_name":"v8.30.1","draft":true,"prerelease":false}`,
		`{"tag_name":"v8.30.1","draft":false,"prerelease":true}`,
		`{"tag_name":"nightly","draft":false,"prerelease":false}`,
	}
	for _, body := range tests {
		checker := NewChecker(releaseResponseClient(body, nil), "https://updates.invalid/latest")
		result := checker.Check(context.Background(), "8.30.0")
		if result.UpdateStatus != UpdateStatusUnavailable || result.UpdateAvailable {
			t.Fatalf("Check() = %#v for body %s, want unavailable", result, body)
		}
	}
}

func TestCheckerTreatsTransportFailureAsUnavailable(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return nil, errors.New("offline")
	})}
	checker := NewChecker(client, "https://updates.invalid/latest")

	result := checker.Check(context.Background(), "8.30.0")

	if result.UpdateStatus != UpdateStatusUnavailable || result.UpdateAvailable || result.CheckedAt == "" {
		t.Fatalf("Check() = %#v, want cached unavailable result with check time", result)
	}
}

func TestCheckerRejectsOversizedResponse(t *testing.T) {
	checker := NewChecker(
		releaseResponseClient(strings.Repeat("x", latestReleaseResponseLimit+1), nil),
		"https://updates.invalid/latest",
	)

	result := checker.Check(context.Background(), "8.30.0")

	if result.UpdateStatus != UpdateStatusUnavailable || result.UpdateAvailable {
		t.Fatalf("Check() = %#v, want unavailable for oversized response", result)
	}
}

func TestValidatedFilterestReleaseURLRejectsOtherHosts(t *testing.T) {
	if got := validatedFilterestReleaseURL("https://example.com/kanilmari/filterest/releases/tag/v8.30.1"); got != "" {
		t.Fatalf("validatedFilterestReleaseURL() = %q, want empty", got)
	}
}
