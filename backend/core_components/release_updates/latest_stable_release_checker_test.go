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
	"sync/atomic"
	"testing"
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
