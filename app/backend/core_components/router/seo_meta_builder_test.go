// seo_meta_builder_test.go
// Regression tests for browser-facing SEO metadata values.
// Bridges request host headers, SITE_NAME fallback config, and index template metadata.
// Exists to keep domain deployments from leaking stale branding into page titles.
package router

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestResolvePageMetaUsesRequestHostForTitleSiteName(t *testing.T) {
	t.Setenv("SITE_NAME", "Serlog.com")

	req := httptest.NewRequest(http.MethodGet, "https://filterest.com/", nil)
	meta := resolvePageMeta(req)

	if meta.PageTitle != "filterest.com" {
		t.Fatalf("PageTitle = %q, want %q", meta.PageTitle, "filterest.com")
	}
	if meta.SiteName != "filterest.com" {
		t.Fatalf("SiteName = %q, want %q", meta.SiteName, "filterest.com")
	}
	if strings.Contains(strings.ToLower(meta.OGDescription), "serlog") {
		t.Fatalf("OGDescription leaked stale site name: %q", meta.OGDescription)
	}
}

func TestResolvePageSiteNameUsesForwardedHostAndStripsPort(t *testing.T) {
	t.Setenv("SITE_NAME", "Serlog.com")

	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/", nil)
	req.Host = "127.0.0.1:8082"
	req.Header.Set("X-Forwarded-Host", "Filterest.com:443")

	if got := resolvePageSiteName(req); got != "filterest.com" {
		t.Fatalf("resolvePageSiteName() = %q, want %q", got, "filterest.com")
	}
}

func TestResolvePageSiteNamePrefersAdministratorOwnedIdentity(t *testing.T) {
	original := configuredSiteNameReader
	configuredSiteNameReader = func(context.Context, *sql.DB) string { return "Customer Workspace" }
	t.Cleanup(func() { configuredSiteNameReader = original })

	req := httptest.NewRequest(http.MethodGet, "https://filterest.example/", nil)
	if got := resolvePageSiteName(req); got != "Customer Workspace" {
		t.Fatalf("resolvePageSiteName() = %q, want %q", got, "Customer Workspace")
	}
}

func TestResolvePageSiteNameFallsBackToEnvWithoutRequestHost(t *testing.T) {
	t.Setenv("SITE_NAME", "Serlog.com")

	if got := resolvePageSiteName(nil); got != "Serlog.com" {
		t.Fatalf("resolvePageSiteName(nil) = %q, want %q", got, "Serlog.com")
	}
}

func TestGetSiteNameFallsBackToCheckoutProductIdentity(t *testing.T) {
	t.Setenv("SITE_NAME", "")
	t.Chdir(t.TempDir())
	if err := os.WriteFile("VERSION_APP", []byte("8.27.99\n"), 0o644); err != nil {
		t.Fatalf("WriteFile(VERSION_APP) error = %v", err)
	}

	if got := getSiteName(); got != "Filterest" {
		t.Fatalf("getSiteName() = %q, want %q", got, "Filterest")
	}
}

func TestResolveBaseURLStripsDefaultForwardedPort(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/", nil)
	req.Header.Set("X-Forwarded-Proto", "https")
	req.Header.Set("X-Forwarded-Host", "filterest.com:443")

	if got := resolveBaseURL(req); got != "https://filterest.com" {
		t.Fatalf("resolveBaseURL() = %q, want %q", got, "https://filterest.com")
	}
}

func TestResolveBaseURLPreservesNonDefaultLocalPort(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "https://localhost:8082/", nil)
	req.Host = "localhost:8082"

	if got := resolveBaseURL(req); got != "https://localhost:8082" {
		t.Fatalf("resolveBaseURL() = %q, want %q", got, "https://localhost:8082")
	}
}

// sharedTitleExamples is the one example set both title implementations answer.
// Its frontend reader is site_identity_reader.test.js.
type sharedTitleExamples struct {
	TitleAlreadyOpensWithSiteName []struct {
		Title    string `json:"title"`
		SiteName string `json:"siteName"`
		Expected bool   `json:"expected"`
	} `json:"titleAlreadyOpensWithSiteName"`
	HumanizeDatasetNameForTitle []struct {
		DatasetName string `json:"datasetName"`
		Expected    string `json:"expected"`
	} `json:"humanizeDatasetNameForTitle"`
	MainTabLangKey []struct {
		Why         string `json:"why"`
		TabIdentity string `json:"tabIdentity"`
		Expected    string `json:"expected"`
	} `json:"mainTabLangKey"`
	ComposeBrowserTabTitle []struct {
		Why          string `json:"why"`
		ArticleTitle string `json:"articleTitle"`
		TabTitle     string `json:"tabTitle"`
		SiteName     string `json:"siteName"`
		Expected     string `json:"expected"`
	} `json:"composeBrowserTabTitle"`
}

func loadSharedTitleExamples(t *testing.T) sharedTitleExamples {
	t.Helper()
	path := filepath.Join("..", "..", "..", "testing", "shared_contracts", "site_name_in_title_examples.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile(%s) error = %v", path, err)
	}
	var examples sharedTitleExamples
	if err := json.Unmarshal(raw, &examples); err != nil {
		t.Fatalf("Unmarshal(%s) error = %v", path, err)
	}
	if len(examples.TitleAlreadyOpensWithSiteName) == 0 ||
		len(examples.ComposeBrowserTabTitle) == 0 ||
		len(examples.MainTabLangKey) == 0 ||
		len(examples.HumanizeDatasetNameForTitle) == 0 {
		t.Fatalf("shared title examples are empty; the browser tab pair would go unchecked")
	}
	return examples
}

func TestTitleAlreadyOpensWithSiteNameMatchesTheSharedExamples(t *testing.T) {
	for _, example := range loadSharedTitleExamples(t).TitleAlreadyOpensWithSiteName {
		got := titleAlreadyOpensWithSiteName(example.Title, example.SiteName)
		if got != example.Expected {
			t.Errorf("titleAlreadyOpensWithSiteName(%q, %q) = %v, want %v",
				example.Title, example.SiteName, got, example.Expected)
		}
	}
}

func TestComposeBrowserTabTitleMatchesTheSharedExamples(t *testing.T) {
	for _, example := range loadSharedTitleExamples(t).ComposeBrowserTabTitle {
		got := composeBrowserTabTitle(example.ArticleTitle, example.TabTitle, example.SiteName)
		if got != example.Expected {
			t.Errorf("%s: composeBrowserTabTitle(%q, %q, %q) = %q, want %q",
				example.Why, example.ArticleTitle, example.TabTitle, example.SiteName, got, example.Expected)
		}
	}
}

// stubDatasetTitleSources answers the dataset title sources without a database.
func stubDatasetTitleSources(t *testing.T, translations map[string]string, displayName string) {
	t.Helper()
	originalTranslationReader := datasetTitleTranslationReader
	originalDisplayNameReader := datasetDisplayNameReader
	datasetTitleTranslationReader = func(langKey string, _ string) string { return translations[langKey] }
	datasetDisplayNameReader = func(string) string { return displayName }
	t.Cleanup(func() {
		datasetTitleTranslationReader = originalTranslationReader
		datasetDisplayNameReader = originalDisplayNameReader
	})
}

func TestResolveDatasetTabTitlePrefersTheApplicationTabsOwnLabel(t *testing.T) {
	stubDatasetTitleSources(t, map[string]string{
		"app_service_catalog":            "Service catalog",
		"app_service_catalog_front_page": "Serlog.com – Service catalog",
	}, "Catalog")

	if got := resolveDatasetTabTitle("app_service_catalog", "en"); got != "Service catalog" {
		t.Fatalf("resolveDatasetTabTitle() = %q, want %q", got, "Service catalog")
	}
}

func TestResolveDatasetTabTitleFallsBackInTheFrontendsOrder(t *testing.T) {
	stubDatasetTitleSources(t, map[string]string{
		"app_service_catalog_front_page": "Serlog.com – Service catalog",
	}, "Catalog")
	if got := resolveDatasetTabTitle("app_service_catalog", "en"); got != "Serlog.com – Service catalog" {
		t.Fatalf("front-page fallback = %q, want %q", got, "Serlog.com – Service catalog")
	}

	stubDatasetTitleSources(t, map[string]string{}, "Catalog")
	if got := resolveDatasetTabTitle("app_service_catalog", "en"); got != "Catalog" {
		t.Fatalf("display-name fallback = %q, want %q", got, "Catalog")
	}

	stubDatasetTitleSources(t, map[string]string{}, "")
	if got := resolveDatasetTabTitle("travel_deals", "en"); got != "Travel Deals" {
		t.Fatalf("readable-name fallback = %q, want %q", got, "Travel Deals")
	}
}

func TestMainTabLangKeyMatchesTheSharedExamples(t *testing.T) {
	for _, example := range loadSharedTitleExamples(t).MainTabLangKey {
		got := mainTabLangKey(example.TabIdentity)
		if got != example.Expected {
			t.Errorf("%s: mainTabLangKey(%q) = %q, want %q",
				example.Why, example.TabIdentity, got, example.Expected)
		}
	}
}

func TestResolveDatasetTabTitleUsesTheKeyThePeopleTabPrints(t *testing.T) {
	stubDatasetTitleSources(t, map[string]string{
		"users":        "Users",
		"system_users": "Never shown on the tab",
	}, "")

	if got := resolveDatasetTabTitle("system_users", "en"); got != "Users" {
		t.Fatalf("resolveDatasetTabTitle() = %q, want %q", got, "Users")
	}
}

func TestHumanizeDatasetNameForTitleMatchesTheSharedExamples(t *testing.T) {
	for _, example := range loadSharedTitleExamples(t).HumanizeDatasetNameForTitle {
		got := humanizeDatasetNameForTitle(example.DatasetName)
		if got != example.Expected {
			t.Errorf("humanizeDatasetNameForTitle(%q) = %q, want %q",
				example.DatasetName, got, example.Expected)
		}
	}
}
