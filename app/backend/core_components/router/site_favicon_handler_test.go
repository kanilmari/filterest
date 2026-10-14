// site_favicon_handler_test.go
// Proves document fallback icons match site head links and current asset bytes.
// Exercises registered routes, public pipeline policy and maintenance bypass.
// Guards signed-out access, HEAD and revalidation after selection or file changes.
package router

import (
	"bytes"
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	frontendassets "easelect/backend/core_components/frontend_assets"
	"easelect/backend/core_components/middlewares"
	"easelect/backend/pipeline"
)

const testDefaultSiteIcon = "site-initial-f-v1-16.png"

func setupSiteFaviconRoute(t *testing.T, siteName, selected string) (*string, http.Handler) {
	t.Helper()
	previousDir, previousName, previousIcon := localFrontendDir, configuredSiteNameReader, configuredFaviconReader
	frontendDir := t.TempDir()
	assetDir := filepath.Join(frontendDir, "icons", "site_favicons")
	if err := os.MkdirAll(assetDir, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{testDefaultSiteIcon, "site-initial-e-v1-16.png", "site-initial-es-v1-16.png", "site-initial-s-v1-16.png", "site-fintravel-ft-v1-16.png"} {
		content, err := os.ReadFile(filepath.Join("..", "..", "..", "frontend", "icons", "site_favicons", name))
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(assetDir, name), content, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	configuredSiteNameReader = func(context.Context, *sql.DB) string { return siteName }
	configuredFaviconReader = func(context.Context, *sql.DB) string { return selected }
	RegisterRoutes(frontendDir, t.TempDir())
	t.Cleanup(func() {
		ResetRouteDefinitions()
		localFrontendDir, configuredSiteNameReader, configuredFaviconReader = previousDir, previousName, previousIcon
	})
	mux := http.NewServeMux()
	for _, route := range GetRouteDefinitions() {
		if route.HandlerName != "router.faviconHandler" {
			continue
		}
		if !slices.Equal(route.Methods, []string{http.MethodGet, http.MethodHead}) || pipeline.DescribeRouteProfile(route.HandlerName).ProfileName != "public" {
			t.Fatalf("favicon route must declare public GET/HEAD: %+v", route)
		}
		mux.HandleFunc(route.UrlPattern, route.HandlerFunc)
	}
	return &selected, mux
}

func siteFaviconRequest(handler http.Handler, method, address, etag string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, address, nil)
	if etag != "" {
		request.Header.Set("If-None-Match", etag)
	}
	response := httptest.NewRecorder()
	serveSiteFaviconTestRequest(handler, response, request)
	return response
}

// The router intentionally normalizes HEAD to GET. net/http's server suppresses
// its body; ResponseRecorder does not, so reproduce that transport behavior here.
type siteIconHeadWriter struct{ http.ResponseWriter }

func (siteIconHeadWriter) Write(content []byte) (int, error) { return len(content), nil }

func serveSiteFaviconTestRequest(handler http.Handler, response *httptest.ResponseRecorder, request *http.Request) {
	var writer http.ResponseWriter = response
	if request.Method == http.MethodHead {
		writer = siteIconHeadWriter{response}
	}
	handler.ServeHTTP(writer, request)
}

func assertSiteIconResponse(t *testing.T, response *httptest.ResponseRecorder, expectedFile string, head bool) {
	t.Helper()
	expected, err := os.ReadFile(filepath.Join(localFrontendDir, "icons", "site_favicons", expectedFile))
	if err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusOK || response.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("icon response = %d %v %q", response.Code, response.Header(), response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "public, no-cache" || response.Header().Get("ETag") == "" || response.Header().Get("Expires") != "" {
		t.Fatalf("icon must revalidate: %v", response.Header())
	}
	if response.Header().Get("Content-Length") != strconv.Itoa(len(expected)) {
		t.Fatalf("Content-Length = %q, want %d", response.Header().Get("Content-Length"), len(expected))
	}
	if response.Header().Get("Location") != "" || response.Header().Get("Set-Cookie") != "" {
		t.Fatalf("public icon created a login redirect or session: %v", response.Header())
	}
	if head {
		if response.Body.Len() != 0 {
			t.Fatal("HEAD returned a body")
		}
	} else if !bytes.Equal(response.Body.Bytes(), expected) {
		t.Fatal("icon bytes differ from the resolved HTML favicon")
	}
}

func TestSiteFaviconRouteUsesConfiguredBytesAndSharedFallbacks(t *testing.T) {
	for _, fixture := range []struct{ name, site, selected, expected string }{
		{"configured Fintravel", "Fintravel", "site-fintravel-ft-v1-16.png", "site-fintravel-ft-v1-16.png"},
		{"default Filterest", "Filterest", "", testDefaultSiteIcon},
		{"multi-word default", "Easelect Something", "", "site-initial-es-v1-16.png"},
		{"Serlog default", "Serlog.com", "", "site-initial-s-v1-16.png"},
		{"K378 default", "K378", "", testDefaultSiteIcon},
		{"unsaved identity uses the request host", "", "", "site-initial-e-v1-16.png"},
		{"unknown selection", "Filterest", "unknown.png", testDefaultSiteIcon},
		{"unsafe selection", "Filterest", "../favicon4E.png", testDefaultSiteIcon},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			_, handler := setupSiteFaviconRoute(t, fixture.site, fixture.selected)
			links := frontendassets.NewSiteFaviconData(localFrontendDir, resolvePageSiteName(httptest.NewRequest(http.MethodGet, "/", nil)), fixture.selected)
			if filepath.Base(links.FaviconPath) != fixture.expected {
				t.Fatalf("HTML selection = %q", links.FaviconPath)
			}
			for _, address := range []string{"/favicon.ico", "/favicon4S.png"} {
				for _, method := range []string{http.MethodGet, http.MethodHead} {
					assertSiteIconResponse(t, siteFaviconRequest(handler, method, address, ""), fixture.expected, method == http.MethodHead)
				}
			}
		})
	}
}

func TestSiteFaviconRouteRemainsPublicWithLoginRequiredAndMaintenance(t *testing.T) {
	setupSiteFaviconRoute(t, "Fintravel", "site-fintravel-ft-v1-16.png")
	setupRootHandlerMockDB(t, true)
	setupRootHandlerSessionStore(t)
	t.Setenv("REQUEST_LOGGING_DEBUG", "false")
	if required, err := middlewares.CheckLoginToBrowse(); err != nil || !required {
		t.Fatalf("fixture must require sign-in: %v, %v", required, err)
	}
	mux := http.NewServeMux()
	for _, route := range GetRouteDefinitions() {
		if route.HandlerName == "router.faviconHandler" {
			ctx := pipeline.RouteContext{URLPattern: route.UrlPattern, HandlerName: route.HandlerName, DB: backend.Db}
			mux.HandleFunc(route.UrlPattern, pipeline.BuildHandler(route.HandlerFunc, ctx, pipeline.GetProfile(route.HandlerName)))
		}
	}
	previousMaintenance := middlewares.IsMaintenanceMode()
	t.Cleanup(func() { middlewares.SetMaintenanceMode(previousMaintenance) })
	browser := buildRootHandlerBrowserSession(t, 42, "signed-in-device", "signed-in-fingerprint")
	for _, active := range []bool{false, true} {
		middlewares.SetMaintenanceMode(active)
		for _, address := range []string{"/favicon.ico", "/favicon4S.png"} {
			for _, method := range []string{http.MethodGet, http.MethodHead} {
				for _, signedIn := range []bool{false, true} {
					request := httptest.NewRequest(method, address, nil)
					if signedIn {
						request.AddCookie(browser.sessionCookie)
					}
					response := httptest.NewRecorder()
					serveSiteFaviconTestRequest(middlewares.WithMaintenanceMode(mux), response, request)
					assertSiteIconResponse(t, response, "site-fintravel-ft-v1-16.png", method == http.MethodHead)
				}
			}
		}
	}
}

func TestSiteFaviconHandlerHeadHasGetHeadersWithoutBody(t *testing.T) {
	_, handler := setupSiteFaviconRoute(t, "Fintravel", "site-fintravel-ft-v1-16.png")
	get := siteFaviconRequest(handler, http.MethodGet, "/favicon.ico", "")
	head := httptest.NewRecorder()
	faviconHandler(head, httptest.NewRequest(http.MethodHead, "/favicon.ico", nil))
	assertSiteIconResponse(t, head, "site-fintravel-ft-v1-16.png", true)
	for _, name := range []string{"Content-Type", "Content-Length", "ETag", "Cache-Control"} {
		if head.Header().Get(name) != get.Header().Get(name) {
			t.Fatalf("HEAD %s = %q, GET = %q", name, head.Header().Get(name), get.Header().Get(name))
		}
	}
}

func TestSiteFaviconRouteRevalidatesSelectionReplacementAndRemoval(t *testing.T) {
	selected, handler := setupSiteFaviconRoute(t, "Filterest", "site-fintravel-ft-v1-16.png")
	initial := siteFaviconRequest(handler, http.MethodGet, "/favicon.ico", "")
	assertSiteIconResponse(t, initial, *selected, false)
	etag := initial.Header().Get("ETag")
	for _, method := range []string{http.MethodGet, http.MethodHead} {
		response := siteFaviconRequest(handler, method, "/favicon.ico", etag)
		if response.Code != http.StatusNotModified || response.Body.Len() != 0 || response.Header().Get("ETag") != etag || response.Header().Get("Cache-Control") != "public, no-cache" {
			t.Fatalf("unchanged icon = %d %v", response.Code, response.Header())
		}
	}
	*selected = "site-initial-s-v1-16.png"
	changed := siteFaviconRequest(handler, http.MethodGet, "/favicon.ico", etag)
	assertSiteIconResponse(t, changed, *selected, false)
	if changed.Header().Get("ETag") == etag {
		t.Fatal("selection retained the previous icon's validator")
	}
	etag = changed.Header().Get("ETag")
	iconFile := filepath.Join(localFrontendDir, "icons", "site_favicons", *selected)
	info, err := os.Stat(iconFile)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(iconFile, initial.Body.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(iconFile, info.ModTime(), info.ModTime()); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/favicon.ico", nil)
	request.Header.Set("If-None-Match", etag)
	request.Header.Set("If-Modified-Since", info.ModTime().UTC().Format(http.TimeFormat))
	replaced := httptest.NewRecorder()
	handler.ServeHTTP(replaced, request)
	assertSiteIconResponse(t, replaced, *selected, false)
	if !bytes.Equal(replaced.Body.Bytes(), initial.Body.Bytes()) || replaced.Header().Get("ETag") == etag {
		t.Fatal("same-date replacement retained stale bytes")
	}
	if err := os.Remove(iconFile); err != nil {
		t.Fatal(err)
	}
	removed := siteFaviconRequest(handler, http.MethodGet, "/favicon.ico", replaced.Header().Get("ETag"))
	assertSiteIconResponse(t, removed, testDefaultSiteIcon, false)
	if removed.Header().Get("ETag") == replaced.Header().Get("ETag") {
		t.Fatal("removed configured icon retained its validator")
	}
	// A date-only browser cache must also receive the newly resolved selection.
	request = httptest.NewRequest(http.MethodGet, "/favicon.ico", nil)
	request.Header.Set("If-Modified-Since", time.Now().UTC().Format(http.TimeFormat))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	assertSiteIconResponse(t, response, testDefaultSiteIcon, false)
}
