// shell_boot_renderer_test.go
// Exercises real authentication shell renderers with existing isolated session fixtures.
// Bridges standalone/fragment scope, POST retry safety, CSP and development metadata.
// Prevents forms from becoming another application watchdog when mounted in the SPA.
package auth

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"easelect/backend/core_components/middlewares"
)

func TestShellBootAuthRenderersKeepScopeMethodAndNoStore(t *testing.T) {
	prepareLoginHandlerSessionStore(t)
	setupLoginHandlerMockDB(t, false)
	previous := frontend_dir
	frontend_dir = filepath.Join("..", "..", "..", "frontend")
	t.Cleanup(func() { frontend_dir = previous })
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	t.Setenv("FILTEREST_FRONTEND_ASSET_MODE", "source")
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		for _, fragment := range []bool{false, true} {
			for _, name := range []string{"login", "register", "first-run"} {
				target := "/" + name + "?lang=fi"
				if fragment {
					target += "&fragment=1"
				}
				request := httptest.NewRequest(method, target, nil)
				response := httptest.NewRecorder()
				handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					switch name {
					case "login":
						showLoginForm(w, r, "")
					case "register":
						showRegisterForm(w, r, registerErrors{}, "none", http.StatusOK)
					case "first-run":
						showFirstRunAdminForm(w, r, firstRunAdminInput{}, firstRunAdminErrors{}, http.StatusOK)
					}
				})
				middlewares.WithCSP(handler).ServeHTTP(response, request)
				body := response.Body.String()
				if response.Code != http.StatusOK || !strings.Contains(response.Header().Get("Cache-Control"), "no-store") {
					t.Fatalf("%s %s: status %d cache %s", method, name, response.Code, response.Header().Get("Cache-Control"))
				}
				standalone := !fragment || name == "first-run"
				if strings.Contains(body, `id="shell-boot-guard"`) != standalone {
					t.Fatalf("wrong guard scope on %s", target)
				}
				if standalone {
					methodValue := "false"
					if method == http.MethodGet {
						methodValue = "true"
					}
					if !strings.Contains(body, `data-shell-boot-get="`+methodValue+`"`) || !strings.Contains(body, `name="app-env" content="dev"`) {
						t.Fatalf("incorrect method/environment on %s", target)
					}
					if !strings.Contains(body, `Sivua ladataan…`) {
						t.Fatal("wrong language")
					}
				}
			}
		}
	}
}

func TestShellBootAuthTemplateFailuresThroughRealRenderers(t *testing.T) {
	prepareLoginHandlerSessionStore(t)
	setupLoginHandlerMockDB(t, false)
	previous := frontend_dir
	t.Cleanup(func() { frontend_dir = previous })
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	t.Setenv("FILTEREST_FRONTEND_ASSET_MODE", "source")
	for _, name := range []string{"login", "register", "first-run"} {
		for _, failure := range []string{"missing", "parse", "execute"} {
			for _, fragment := range []bool{false, true} {
				t.Run(name+"/"+failure+"/fragment="+fmt.Sprint(fragment), func(t *testing.T) {
					frontend_dir = t.TempDir()
					if err := os.MkdirAll(filepath.Join(frontend_dir, "templates"), 0o755); err != nil {
						t.Fatal(err)
					}
					filename := name + ".html"
					if name == "first-run" {
						filename = "first_run_admin.html"
					}
					if failure != "missing" {
						content := "partial-private-markup{{.MissingField}}"
						if failure == "parse" {
							content = "{{"
						}
						if err := os.WriteFile(filepath.Join(frontend_dir, "templates", filename), []byte(content), 0o600); err != nil {
							t.Fatal(err)
						}
					}
					target := "/" + name + "?lang=fi"
					if fragment {
						target += "&fragment=1"
					}
					response := httptest.NewRecorder()
					handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						switch name {
						case "login":
							showLoginForm(w, r, "")
						case "register":
							showRegisterForm(w, r, registerErrors{}, "none", http.StatusOK)
						case "first-run":
							showFirstRunAdminForm(w, r, firstRunAdminInput{}, firstRunAdminErrors{}, http.StatusBadRequest)
						}
					})
					middlewares.WithCSP(handler).ServeHTTP(response, httptest.NewRequest(http.MethodPost, target, nil))
					body := response.Body.String()
					if response.Code != http.StatusInternalServerError || !strings.Contains(response.Header().Get("Cache-Control"), "no-store") {
						t.Fatalf("status %d, cache %q", response.Code, response.Header().Get("Cache-Control"))
					}
					if strings.Contains(body, "partial-private-markup") {
						t.Fatal("partial template escaped before failure")
					}
					if !fragment || name == "first-run" {
						for _, expected := range []string{`data-shell-boot-document-failed`, `data-shell-boot-get="false"`, `nonce="`, `Sivu ei latautunut.`, `Lataa sivu uudelleen`} {
							if !strings.Contains(body, expected) {
								t.Fatalf("missing %s", expected)
							}
						}
						if !strings.HasPrefix(response.Header().Get("Content-Type"), "text/html") {
							t.Fatal("not a recovery document")
						}
					} else if strings.Contains(body, "shell-boot-guard") || !strings.HasPrefix(response.Header().Get("Content-Type"), "application/json") {
						t.Fatalf("fragment error contract changed: %s", body)
					}
				})
			}
		}
	}
}

func TestRegisterInvalidCSRFCommitsStatusOnlyAfterSafeRendering(t *testing.T) {
	setupRegisterAdmin(t)
	previous := frontend_dir
	t.Cleanup(func() { frontend_dir = previous })
	for _, failure := range []string{"none", "missing", "parse", "execute"} {
		for _, fragment := range []bool{false, true} {
			t.Run(failure+"/fragment="+fmt.Sprint(fragment), func(t *testing.T) {
				frontend_dir = t.TempDir()
				if err := os.MkdirAll(filepath.Join(frontend_dir, "templates"), 0o755); err != nil {
					t.Fatal(err)
				}
				if failure != "missing" {
					content := "<!DOCTYPE html><p>{{.GeneralErr}}</p>"
					if failure == "parse" {
						content = "{{"
					}
					if failure == "execute" {
						content = "partial-private-markup{{.MissingField}}"
					}
					if err := os.WriteFile(filepath.Join(frontend_dir, "templates", "register.html"), []byte(content), 0o600); err != nil {
						t.Fatal(err)
					}
				}
				request := registerAdminRequest(t, map[interface{}]interface{}{"csrf_token": "test-csrf"}, "invalid-token")
				request.URL.RawQuery = "lang=fi"
				if fragment {
					request.URL.RawQuery += "&fragment=1"
				}
				response := httptest.NewRecorder()
				middlewares.WithCSP(http.HandlerFunc(handleRegisterPost)).ServeHTTP(response, request)
				result := response.Result()
				expectedStatus, expectedType := http.StatusForbidden, "text/html"
				if failure != "none" {
					expectedStatus = http.StatusInternalServerError
					if fragment {
						expectedType = "application/json"
					}
				}
				if result.StatusCode != expectedStatus || !strings.HasPrefix(result.Header.Get("Content-Type"), expectedType) || !strings.Contains(result.Header.Get("Cache-Control"), "no-store") {
					t.Fatalf("committed response = %d, type %q, cache %q", result.StatusCode, result.Header.Get("Content-Type"), result.Header.Get("Cache-Control"))
				}
				if strings.Contains(response.Body.String(), "partial-private-markup") {
					t.Fatal("partial rendering was committed")
				}
				if failure != "none" && !fragment && !strings.Contains(response.Body.String(), "Sivu ei latautunut.") {
					t.Fatal("missing translated recovery document")
				}
			})
		}
	}
}
