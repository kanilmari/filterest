// shell_boot_renderer_test.go
// Exercises real root, deep-link and admin shell renderers with an isolated fixture.
// Bridges development metadata, no-store headers and the nonce-authorized guard.
// Protects public documents as well as authentication-gated shell entry points.
package router

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"easelect/backend/core_components/middlewares"
)

func TestShellBootIndexRenderersUseDevelopmentAndNoStore(t *testing.T) {
	for _, loginRequired := range []bool{false, true} {
		for _, dev := range []bool{false, true} {
			t.Run(map[bool]string{true: "private", false: "public"}[loginRequired]+map[bool]string{true: "dev", false: "prod"}[dev], func(t *testing.T) {
				environment := "prod"
				if dev {
					environment = "dev"
				}
				t.Setenv("ENVIRONMENT_TYPE", environment)
				t.Setenv("FILTEREST_FRONTEND_ASSET_MODE", "source")
				setupRootHandlerMockDB(t, loginRequired)
				setupRootHandlerSessionStore(t)
				previous := localFrontendDir
				localFrontendDir = filepath.Join("..", "..", "..", "frontend")
				t.Cleanup(func() { localFrontendDir = previous })
				handlers := []http.HandlerFunc{rootHandler, func(w http.ResponseWriter, r *http.Request) { tablesHandler(w, r, loginRequired) }, adminHandler}
				for _, handler := range handlers {
					request := httptest.NewRequest(http.MethodGet, "https://localhost/?login-entry=1&lang=fi", nil)
					response := httptest.NewRecorder()
					middlewares.WithCSP(handler).ServeHTTP(response, request)
					body := response.Body.String()
					if response.Code != http.StatusOK || !strings.Contains(body, `id="shell-boot-guard"`) {
						t.Fatalf("renderer = %d guard=%t", response.Code, strings.Contains(body, `id="shell-boot-guard"`))
					}
					if !strings.Contains(response.Header().Get("Cache-Control"), "no-store") {
						t.Fatal("cacheable shell")
					}
					if !strings.Contains(body, `name="app-env" content="`+environment+`"`) {
						t.Fatal("incorrect environment")
					}
					if !strings.Contains(body, `Sivua ladataan…`) {
						t.Fatal("incorrect document language")
					}
				}
			})
		}
	}
}

func TestShellBootIndexLanguageDoesNotChangeOrdinaryMetadata(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	t.Setenv("FILTEREST_FRONTEND_ASSET_MODE", "source")
	setupRootHandlerMockDB(t, false)
	setupRootHandlerSessionStore(t)
	previous := localFrontendDir
	localFrontendDir = filepath.Join("..", "..", "..", "frontend")
	t.Cleanup(func() { localFrontendDir = previous })
	for _, tc := range []struct{ query, header, metaLanguage, recovery string }{
		{"", "fi;q=0.1,en;q=1", "fi", "Loading the page…"},
		{"&lang=yue", "fi", "yue", "Sivua ladataan…"},
	} {
		for _, handler := range []http.HandlerFunc{rootHandler, func(w http.ResponseWriter, r *http.Request) { tablesHandler(w, r, false) }, adminHandler} {
			request := httptest.NewRequest(http.MethodGet, "https://localhost/?login-entry=1"+tc.query, nil)
			request.Header.Set("Accept-Language", tc.header)
			response := httptest.NewRecorder()
			middlewares.WithCSP(handler).ServeHTTP(response, request)
			body := response.Body.String()
			if response.Code != http.StatusOK || !strings.Contains(body, `<html lang="`+tc.metaLanguage+`"`) || !strings.Contains(body, `property="og:locale" content="`+langToLocale(tc.metaLanguage)+`"`) {
				t.Fatalf("ordinary metadata changed for %s / %s", tc.query, tc.header)
			}
			if !strings.Contains(body, `<p id="shell-boot-loading" hidden>`+tc.recovery+`</p>`) {
				t.Fatal("recovery language followed metadata instead of its own preferences")
			}
		}
	}
}
