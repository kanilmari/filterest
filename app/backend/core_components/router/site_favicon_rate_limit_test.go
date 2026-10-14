// site_favicon_rate_limit_test.go
// Proves browser icon requests stay public after the ordinary request quota.
// Connects registered icon and health routes to the complete production pipeline.
// Guards GET, HEAD and revalidation during maintenance with normal non-zero limits.
package router

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/middlewares"
	"easelect/backend/pipeline"
)

func TestSiteFaviconPipelineIgnoresRateLimitWithoutExemptingOtherRoutes(t *testing.T) {
	selected, _ := setupSiteFaviconRoute(t, "Filterest", "site-fintravel-ft-v1-16.png")
	setupRootHandlerMockDB(t, true)
	setupRootHandlerSessionStore(t)
	t.Setenv("ENVIRONMENT_TYPE", "prod")
	t.Setenv("REQUEST_LOGGING_DEBUG", "false")
	if required, err := middlewares.CheckLoginToBrowse(); err != nil || !required {
		t.Fatalf("fixture must require sign-in: %v, %v", required, err)
	}
	for _, name := range []string{"router.faviconHandler", "router.healthHandler"} {
		var amount, minutes int
		err := backend.Db.QueryRow("SELECT rate_limit_amount, rate_limit_minutes FROM system_functions WHERE name = $1", name).Scan(&amount, &minutes)
		if err != nil || amount != defaultRateLimitAmount || minutes != defaultRateLimitMinutes {
			t.Fatalf("%s must use normal non-zero limits: %d/%d, %v", name, amount, minutes, err)
		}
	}

	mux := http.NewServeMux()
	for _, route := range GetRouteDefinitions() {
		if route.HandlerName == "router.faviconHandler" || route.HandlerName == "router.healthHandler" {
			ctx := pipeline.RouteContext{URLPattern: route.UrlPattern, HandlerName: route.HandlerName, DB: backend.Db}
			mux.HandleFunc(route.UrlPattern, pipeline.BuildHandler(route.HandlerFunc, ctx, pipeline.GetProfile(route.HandlerName)))
		}
	}
	previousMaintenance := middlewares.IsMaintenanceMode()
	t.Cleanup(func() { middlewares.SetMaintenanceMode(previousMaintenance) })
	// A unique address keeps repeated runs independent of the process-wide limiter.
	peer := fmt.Sprintf("[2001:db8::%x]:54321", atomic.AddInt64(&rootHandlerDriverCounter, 1))
	send := func(handler http.Handler, method, address, etag string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(method, address, nil)
		request.RemoteAddr = peer
		if etag != "" {
			request.Header.Set("If-None-Match", etag)
		}
		response := httptest.NewRecorder()
		serveSiteFaviconTestRequest(handler, response, request)
		return response
	}
	for i := 1; i <= defaultRateLimitAmount+1; i++ {
		want := http.StatusOK
		if i > defaultRateLimitAmount {
			want = http.StatusTooManyRequests
		}
		if response := send(mux, http.MethodGet, "/health", ""); response.Code != want {
			t.Fatalf("ordinary route request %d = %d, want %d", i, response.Code, want)
		}
	}

	for _, selection := range []struct{ name, file, expected string }{
		{"configured", "site-fintravel-ft-v1-16.png", "site-fintravel-ft-v1-16.png"},
		{"default", "", testDefaultSiteIcon},
	} {
		t.Run(selection.name, func(t *testing.T) {
			*selected = selection.file
			initial := send(mux, http.MethodGet, "/favicon.ico", "")
			assertSiteIconResponse(t, initial, selection.expected, false)
			etag := initial.Header().Get("ETag")
			for _, maintenance := range []bool{false, true} {
				t.Run(fmt.Sprintf("maintenance=%t", maintenance), func(t *testing.T) {
					middlewares.SetMaintenanceMode(maintenance)
					handler := middlewares.WithMaintenanceMode(mux)
					for _, address := range []string{"/favicon.ico", "/favicon4S.png"} {
						for _, method := range []string{http.MethodGet, http.MethodHead} {
							for _, conditional := range []bool{false, true} {
								t.Run(fmt.Sprintf("%s/%s/conditional=%t", address, method, conditional), func(t *testing.T) {
									validator := ""
									if conditional {
										validator = etag
									}
									// Every method/address combination alone exceeds the shared ceiling.
									for i := 1; i <= defaultRateLimitAmount+1; i++ {
										response := send(handler, method, address, validator)
										if conditional {
											if response.Code != http.StatusNotModified || response.Body.Len() != 0 || response.Header().Get("ETag") != etag || response.Header().Get("Cache-Control") != "public, no-cache" {
												t.Fatalf("revalidation %d = %d %v", i, response.Code, response.Header())
											}
										} else {
											assertSiteIconResponse(t, response, selection.expected, method == http.MethodHead)
										}
									}
								})
							}
						}
					}
				})
			}
		})
	}
	if response := send(mux, http.MethodGet, "/health", ""); response.Code != http.StatusTooManyRequests {
		t.Fatalf("ordinary route after icon bursts = %d, want 429", response.Code)
	}
}
