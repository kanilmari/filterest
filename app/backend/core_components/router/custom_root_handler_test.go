// custom_root_handler_test.go
// Proves the root/asset authentication matrix, fallback and static response policy.
// Uses neighbouring session/database fixtures with real operator files and CSP middleware.
// Guards login-entry handoffs, stale guest cookies and every filesystem escape attempt.
package router

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"easelect/backend/core_components/auth_generation"
	"easelect/backend/core_components/middlewares"
	"easelect/backend/pipeline"
	"github.com/gorilla/sessions"
)

func setupCustomRootFixture(t *testing.T, on, present, loginRequired bool) {
	t.Helper()
	setupRootHandlerMockDBWithConfig(t, rootHandlerMockConfig{loginToBrowse: loginRequired, displayIndexHTML: on})
	setupRootHandlerSessionStore(t)
	setupRootHandlerFrontend(t)
	previous := localStorageDir
	localStorageDir = t.TempDir()
	t.Cleanup(func() { localStorageDir = previous })
	withRootAuthenticationGenerationMatch(t, func(context.Context, auth_generation.Querier, *sessions.Session, int) (bool, error) { return true, nil })
	writeCustomRootFixture(t, "styles/site.css", "body{color:purple}")
	if present {
		writeCustomRootFixture(t, "index.html", "<!doctype html><title>Operator Home</title>custom-root-document")
	}
}

func writeCustomRootFixture(t *testing.T, name, content string) {
	t.Helper()
	file := filepath.Join(localStorageDir, "site_root", name)
	if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
}

func customRootResponse(t *testing.T, method, target string, userID int) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, target, nil)
	if userID > 0 {
		attachRootHandlerSessionUser(t, request, userID)
	}
	response := httptest.NewRecorder()
	middlewares.WithCSP(http.HandlerFunc(rootHandler)).ServeHTTP(response, request)
	return response
}

func TestCustomRootHandlerMatrixGETAndHEAD(t *testing.T) {
	for _, on := range []bool{false, true} {
		for _, present := range []bool{false, true} {
			for _, loginRequired := range []bool{false, true} {
				for _, userID := range []int{0, 1, 42} {
					for _, method := range []string{http.MethodGet, http.MethodHead} {
						t.Run(fmt.Sprintf("on=%t/present=%t/login=%t/user=%d/%s", on, present, loginRequired, userID, method), func(t *testing.T) {
							setupCustomRootFixture(t, on, present, loginRequired)
							response := customRootResponse(t, method, "/", userID)
							// Retained guest cookies keep today's fallback shell; they must
							// never authorize the new custom document on a login-required site.
							protected := loginRequired && (userID == 0 || (userID == 1 && on && present))
							if protected {
								if response.Code != 303 || response.Header().Get("Location") != "/login" || strings.Contains(response.Body.String(), "custom-root-document") {
									t.Fatal(response.Code, response.Body.String())
								}
								return
							}
							if response.Code != 200 {
								t.Fatal(response.Code, response.Body.String())
							}
							if on && present {
								assertCustomRootHeaders(t, response, "text/html; charset=utf-8")
								if method == http.MethodHead {
									if response.Body.Len() != 0 {
										t.Fatal("HEAD returned a body")
									}
								} else if !strings.Contains(response.Body.String(), "custom-root-document") || strings.Contains(response.Body.String(), "root-shell") {
									t.Fatal(response.Body.String())
								}
							} else if !strings.Contains(response.Body.String(), "root-shell") || response.Header().Get("Content-Security-Policy") == siteRootCSP {
								t.Fatal("fallback changed", response.Body.String())
							}
						})
					}
				}
			}
		}
	}
}

func TestCustomRootKeepsSiteRootDatasetAliasAvailable(t *testing.T) {
	setupCustomRootFixture(t, true, true, false)
	setupRootHandlerMockDBWithConfig(t, rootHandlerMockConfig{displayIndexHTML: true, secondaryAlias: "site_root"})
	response := customRootResponse(t, "GET", "/site_root/123", 42)
	if response.Code != 200 || !strings.Contains(response.Body.String(), "root-shell") || response.Header().Get("Content-Security-Policy") == siteRootCSP {
		t.Fatal("custom asset prefix shadowed an ordinary dataset alias", response.Code, response.Body.String())
	}
}

func assertCustomRootHeaders(t *testing.T, response *httptest.ResponseRecorder, contentType string) {
	t.Helper()
	for header, value := range map[string]string{"Content-Type": contentType, "Content-Security-Policy": siteRootCSP, "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY"} {
		if got := response.Header().Get(header); got != value {
			t.Fatalf("%s=%q want %q", header, got, value)
		}
	}
	if response.Header().Get("Content-Length") == "" {
		t.Fatal("missing Content-Length")
	}
}

func TestCustomRootAssetMatrixGETAndHEAD(t *testing.T) {
	for _, on := range []bool{false, true} {
		for _, present := range []bool{false, true} {
			for _, loginRequired := range []bool{false, true} {
				for _, userID := range []int{0, 1, 42} {
					for _, method := range []string{http.MethodGet, http.MethodHead} {
						t.Run(fmt.Sprintf("on=%t/present=%t/login=%t/user=%d/%s", on, present, loginRequired, userID, method), func(t *testing.T) {
							setupCustomRootFixture(t, on, present, loginRequired)
							response := customRootResponse(t, method, "/.site_root/styles/site.css", userID)
							want := 404
							if on && present {
								want = 200
							}
							if loginRequired && userID <= 1 {
								want = 303
							}
							if response.Code != want {
								t.Fatal(response.Code, want, response.Body.String())
							}
							if want == 200 {
								assertCustomRootHeaders(t, response, "text/css; charset=utf-8")
								if method == http.MethodHead && response.Body.Len() != 0 {
									t.Fatal("HEAD body")
								}
								if method == http.MethodGet && response.Body.String() != "body{color:purple}" {
									t.Fatal(response.Body.String())
								}
							} else if strings.Contains(response.Body.String(), "purple") {
								t.Fatal("protected asset leaked")
							}
						})
					}
				}
			}
		}
	}
}

func TestCustomRootAuthEntryNeverServesCustomPageOrBypassesAssetLogin(t *testing.T) {
	setupCustomRootFixture(t, true, true, true)
	for _, query := range []string{"?login-entry=1", "?register-entry=1"} {
		for _, userID := range []int{0, 1, 42} {
			response := customRootResponse(t, "GET", "/"+query, userID)
			if response.Code != 200 || !strings.Contains(response.Body.String(), "root-shell") {
				t.Fatal(response.Code, response.Body.String())
			}
			asset := customRootResponse(t, "GET", "/.site_root/styles/site.css"+query, userID)
			if userID <= 1 && (asset.Code != 303 || strings.Contains(asset.Body.String(), "purple")) {
				t.Fatal(asset.Code, asset.Body.String())
			}
		}
	}
}

func TestCustomRootAssetsRefuseTraversalEscapingSymlinksAndTypes(t *testing.T) {
	setupCustomRootFixture(t, true, true, false)
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret.css"), []byte("secret"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(outside, "secret.css"), filepath.Join(localStorageDir, "site_root", "escape.css")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(localStorageDir, "site_root", "linked")); err != nil {
		t.Fatal(err)
	}
	writeCustomRootFixture(t, "secret.json", "secret")
	for _, target := range []string{"/.site_root", "/.site_root/", "/.site_root/styles/", "/.site_root/../secret.css", "/.site_root/styles/../index.html", "/.site_root/styles//site.css", "/.site_root/styles%2fsite.css", "/.site_root/styles%2Fsite.css", "/.site_root/styles%5csite.css", "/.site_root/styles%252fsite.css", "/.site_root/%2e%2e/secret.css", "/.site_root/escape.css", "/.site_root/linked/secret.css", "/.site_root/secret.json", "/.site_root/.env"} {
		t.Run(target, func(t *testing.T) {
			for _, method := range []string{"GET", "HEAD"} {
				response := customRootResponse(t, method, target, 0)
				if response.Code != 404 || strings.Contains(response.Body.String(), "secret") {
					t.Fatal(response.Code, response.Body.String())
				}
			}
		})
	}
}

func TestCustomRootRevokedSignInAndMissingBrowserBindingCannotReadFiles(t *testing.T) {
	setupCustomRootFixture(t, true, true, true)
	for _, target := range []string{"/", "/.site_root/styles/site.css"} {
		request := httptest.NewRequest("GET", target, nil)
		attachRootHandlerSessionUser(t, request, 42)
		request.Header.Del("Cookie")
		// Preserve only the signed session cookie, removing both browser proofs.
		bound := httptest.NewRequest("GET", target, nil)
		attachRootHandlerSessionUser(t, bound, 42)
		for _, cookie := range bound.Cookies() {
			if cookie.Name == "session" {
				request.AddCookie(cookie)
			}
		}
		response := httptest.NewRecorder()
		rootHandler(response, request)
		if response.Code == 200 || strings.Contains(response.Body.String(), "custom-root-document") || strings.Contains(response.Body.String(), "purple") {
			t.Fatal(response.Code, response.Body.String())
		}
	}
	withRootAuthenticationGenerationMatch(t, func(context.Context, auth_generation.Querier, *sessions.Session, int) (bool, error) {
		return false, nil
	})
	for _, target := range []string{"/", "/.site_root/styles/site.css"} {
		response := customRootResponse(t, "GET", target, 42)
		if response.Code == 200 || strings.Contains(response.Body.String(), "custom-root-document") || strings.Contains(response.Body.String(), "purple") {
			t.Fatal(response.Code, response.Body.String())
		}
	}
}

func TestCustomRootVideoRangeAndMethodRefusal(t *testing.T) {
	setupCustomRootFixture(t, true, true, false)
	writeCustomRootFixture(t, "movie.mp4", "0123456789")
	request := httptest.NewRequest("GET", "/.site_root/movie.mp4", nil)
	request.Header.Set("Range", "bytes=2-5")
	response := httptest.NewRecorder()
	rootHandler(response, request)
	if response.Code != 206 || response.Body.String() != "2345" || response.Header().Get("Content-Type") != "video/mp4" || response.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatal(response.Code, response.Body.String())
	}
	request = httptest.NewRequest("GET", "/.site_root/movie.mp4", nil)
	request.Header.Set("Range", "bytes=100-200")
	response = httptest.NewRecorder()
	rootHandler(response, request)
	if response.Code != 416 || response.Header().Get("Cache-Control") != "private, no-store" || response.Header().Get("Content-Security-Policy") != siteRootCSP {
		t.Fatal("range refusal lost its security/cache policy", response.Code, response.Header())
	}
	for _, target := range []string{"/", "/.site_root/styles/site.css"} {
		response := customRootResponse(t, "POST", target, 0)
		if response.Code != 405 || response.Header().Get("Allow") != "GET, HEAD" {
			t.Fatal(response.Code)
		}
	}
	if pipeline.DescribeRouteProfile("router.serveSiteRoot").ProfileName != "public" {
		t.Fatal("asset route must use the root's own authentication checks")
	}
}

func TestCustomRootAssetContentTypesAndPrivateGate(t *testing.T) {
	setupCustomRootFixture(t, true, true, true)
	for _, tc := range []struct{ name, contentType string }{
		{"site.js", "text/javascript; charset=utf-8"},
		{"picture.png", "image/png"},
		{"vector.svg", "image/svg+xml"},
		{"font.woff2", "font/woff2"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			writeCustomRootFixture(t, tc.name, "fixture bytes must not choose the response type")
			target := "/.site_root/" + tc.name
			for _, method := range []string{"GET", "HEAD"} {
				response := customRootResponse(t, method, target, 42)
				if response.Code != 200 {
					t.Fatal(response.Code)
				}
				assertCustomRootHeaders(t, response, tc.contentType)
				response = customRootResponse(t, method, target, 0)
				if response.Code != 303 || strings.Contains(response.Body.String(), "fixture bytes") {
					t.Fatal("public asset suffix bypassed login", response.Code)
				}
			}
		})
	}
}
