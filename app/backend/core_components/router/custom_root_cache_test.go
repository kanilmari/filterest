// custom_root_cache_test.go
// Proves custom-root cache policy survives every early authentication and route exit.
// Connects actual route method wrappers, ServeMux redirects and root session fixtures.
// Keeps operator bytes private without changing the shell's CSP or fallback behavior.
package router

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"easelect/backend/core_components/auth_generation"
	"easelect/backend/core_components/middlewares"
	"github.com/gorilla/sessions"
)

func assertSiteRootCacheHeaders(t *testing.T, response *httptest.ResponseRecorder) {
	t.Helper()
	if got := response.Header().Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("Cache-Control=%q; status=%d", got, response.Code)
	}
	if !strings.Contains(strings.Join(response.Header().Values("Vary"), ","), "Cookie") {
		t.Fatal("missing Vary: Cookie", response.Header())
	}
}

func customRootCacheMux(t *testing.T) http.Handler {
	t.Helper()
	ResetRouteDefinitions()
	t.Cleanup(ResetRouteDefinitions)
	RegisterRoutes(localFrontendDir, localStorageDir)
	mux := http.NewServeMux()
	for _, route := range GetRouteDefinitions() {
		if route.UrlPattern == "/" || route.UrlPattern == siteRootPrefix {
			mux.HandleFunc(route.UrlPattern, route.HandlerFunc)
		}
	}
	return WithCustomRootCachePolicy(middlewares.WithCSP(mux))
}

func TestCustomRootCacheAuthenticationError(t *testing.T) {
	setupCustomRootFixture(t, true, true, true)
	withRootAuthenticationGenerationMatch(t, func(context.Context, auth_generation.Querier, *sessions.Session, int) (bool, error) {
		return false, errors.New("authentication generation database unavailable")
	})
	for _, target := range []string{"/", "/.site_root/styles/site.css"} {
		for _, method := range []string{"GET", "HEAD"} {
			response := customRootResponse(t, method, target, 42)
			if response.Code != http.StatusServiceUnavailable {
				t.Fatal(method, target, response.Code, response.Body.String())
			}
			assertSiteRootCacheHeaders(t, response)
		}
	}
}

func TestCustomRootCacheRegisteredRouteEarlyExits(t *testing.T) {
	for _, tc := range []struct {
		name, method, target string
		loginRequired        bool
		status               int
	}{
		{"root login", "GET", "/", true, 303},
		{"asset login", "GET", "/.site_root/styles/site.css", true, 303},
		{"asset HEAD login", "HEAD", "/.site_root/styles/site.css", true, 303},
		{"missing asset", "GET", "/.site_root/missing.css", false, 404},
		{"missing HEAD asset", "HEAD", "/.site_root/missing.css", false, 404},
		{"unknown type", "GET", "/.site_root/secret.json", false, 404},
		{"encoded slash", "GET", "/.site_root%2fstyles/site.css", false, 404},
		{"encoded backslash", "GET", "/.site_root%5cstyles/site.css", false, 404},
		{"double encoded slash", "GET", "/.site_root%252fstyles/site.css", false, 404},
		{"root method", "POST", "/", false, 405},
		{"root private method", "POST", "/", true, 405},
		{"asset method", "POST", "/.site_root/styles/site.css", false, 405},
		{"asset private method", "DELETE", "/.site_root/styles/site.css", true, 405},
		{"asset slash redirect", "GET", "/.site_root", false, 307},
		{"mux path cleaning", "GET", "/.site_root/../missing.css", false, 307},
	} {
		t.Run(tc.name, func(t *testing.T) {
			setupCustomRootFixture(t, true, true, tc.loginRequired)
			response := httptest.NewRecorder()
			customRootCacheMux(t).ServeHTTP(response, httptest.NewRequest(tc.method, tc.target, nil))
			if response.Code != tc.status {
				t.Fatal(response.Code, tc.status, response.Body.String())
			}
			assertSiteRootCacheHeaders(t, response)
			if strings.Contains(response.Body.String(), "custom-root-document") || strings.Contains(response.Body.String(), "purple") {
				t.Fatal("early exit exposed operator bytes")
			}
			if tc.status == 405 && response.Header().Get("Allow") != "GET, HEAD" {
				t.Fatal("method contract changed", response.Header())
			}
		})
	}
}

func TestCustomRootCachePolicyOutsideSecurityPreservesVaryAndImplicitWrites(t *testing.T) {
	setupCustomRootFixture(t, true, true, false)
	for _, explicit := range []bool{false, true} {
		response := httptest.NewRecorder()
		WithCustomRootCachePolicy(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Vary", "Accept-Encoding")
			w.Header().Del("Cache-Control")
			if explicit {
				w.WriteHeader(http.StatusServiceUnavailable)
			}
			_, _ = w.Write([]byte("early security response"))
		})).ServeHTTP(response, httptest.NewRequest("GET", "/.site_root/site.css", nil))
		assertSiteRootCacheHeaders(t, response)
		if !strings.Contains(strings.Join(response.Header().Values("Vary"), ","), "Accept-Encoding") {
			t.Fatal("existing Vary lost", response.Header())
		}
	}
}
