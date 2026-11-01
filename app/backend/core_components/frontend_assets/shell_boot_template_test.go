// shell_boot_template_test.go
// Renders all real standalone shell templates under per-response CSP nonces.
// Bridges embedded assets, escaped language copy, fragment scope and GET safety.
// Prevents recovery from depending on the external assets it is protecting.
package frontendassets_test

import (
	"html"
	"html/template"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	frontendassets "easelect/backend/core_components/frontend_assets"
	"easelect/backend/core_components/instance_info"
	"easelect/backend/core_components/middlewares"
)

func TestShellBootTemplatesNonceEscapingAndAssetModes(t *testing.T) {
	for _, name := range []string{"index.html", "templates/login.html", "templates/register.html", "templates/first_run_admin.html"} {
		page, err := template.ParseFiles(filepath.Join("..", "..", "..", "frontend", name))
		if err != nil {
			t.Fatal(err)
		}
		for _, dist := range []bool{false, true} {
			for _, method := range []string{http.MethodGet, http.MethodPost} {
				for _, dev := range []bool{false, true} {
					t.Run(name+method+map[bool]string{true: "dist", false: "source"}[dist]+map[bool]string{true: "dev", false: "prod"}[dev], func(t *testing.T) {
						response := httptest.NewRecorder()
						middlewares.WithCSP(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							frontendassets.SetShellNoStoreHeaders(w)
							boot := frontendassets.NewShellBootData(r, "fi")
							boot.Texts.FailedTitle = `<script>alert("copy")</script>`
							data := map[string]any{"ShellBoot": boot, "CSPNonce": middlewares.GetCSPNonce(r), "LangCode": "fi", "IsDev": dev, "StandalonePage": true,
								"UseMinifiedAssets": dist, "ImportsCSSPath": "/frontend/dist/imports.test.min.css", "MainBundlePath": "/frontend/dist/main.test.min.js", "LoginBundlePath": "/frontend/dist/login.test.min.js",
								"Environment": "dev", "VerificationMethod": "none", "SiteName": "Test"}
							if err := page.Execute(w, data); err != nil {
								t.Fatal(err)
							}
						})).ServeHTTP(response, httptest.NewRequest(method, "/?lang=fi", nil))
						body := response.Body.String()
						nonce := regexp.MustCompile(`'nonce-([^']+)'`).FindStringSubmatch(response.Header().Get("Content-Security-Policy"))[1]
						for _, id := range []string{"shell-boot-style", "shell-boot-guard"} {
							if !strings.Contains(html.UnescapeString(body), `id="`+id+`" nonce="`+nonce+`"`) {
								t.Fatalf("missing nonce on %s", id)
							}
						}
						if regexp.MustCompile(`\s(?:style|on\w+)\s*=`).MatchString(body) {
							t.Fatal("inline style/event attribute")
						}
						if !strings.Contains(body, `&lt;script&gt;alert(&#34;copy&#34;)&lt;/script&gt;`) {
							t.Fatal("text not escaped")
						}
						if !strings.Contains(body, `data-shell-boot-content`) || !strings.Contains(body, `<noscript>`) || !strings.Contains(body, `data-shell-boot-required`) {
							t.Fatal("missing guard markup")
						}
						if !strings.Contains(body, `data-shell-boot-get="`+map[bool]string{true: "true", false: "false"}[method == http.MethodGet]+`"`) {
							t.Fatal("unsafe document method")
						}
						if !strings.Contains(body, `content="`+map[bool]string{true: "dev", false: "prod"}[dev]+`"`) {
							t.Fatal("wrong app-env")
						}
						if !strings.Contains(response.Header().Get("Cache-Control"), "no-store") {
							t.Fatal("shell cacheable")
						}
						if strings.Contains(name, "index") || strings.Contains(name, "login") {
							expected := "/frontend/styles/imports.css"
							if name == "templates/login.html" {
								expected = "/frontend/core_components/auth/auth.css"
							}
							if dist {
								expected = "/frontend/dist/imports.test.min.css"
							}
							if !strings.Contains(body, expected) {
								t.Fatalf("missing %s asset", expected)
							}
						}
					})
				}
			}
		}
	}
}

func TestAuthFragmentsDoNotArmShellBoot(t *testing.T) {
	for _, name := range []string{"login", "register"} {
		page, err := template.ParseFiles(filepath.Join("..", "..", "..", "frontend", "templates", name+".html"))
		if err != nil {
			t.Fatal(err)
		}
		response := httptest.NewRecorder()
		if err := page.Execute(response, map[string]any{"StandalonePage": false, "SiteName": "Test", "VerificationMethod": "none"}); err != nil {
			t.Fatal(err)
		}
		for _, forbidden := range []string{"data-shell-boot-pending", "shell-boot-guard", "shell-boot-notice", "data-shell-boot-required"} {
			if strings.Contains(response.Body.String(), forbidden) {
				t.Fatalf("fragment %s contains %s", name, forbidden)
			}
		}
	}
}

// The instance badge (K523) is linked only on a mirror/preview instance: the runtime flag on and a standalone document.
// It is a nonce'd loader that imports the badge through a caught dynamic import, and the page links no badge stylesheet:
// a stalled badge asset never holds the page's own modules back (gate 531a), and a failing or throwing badge module
// rejects that import instead of raising a global error the shell would treat as a start-up failure (gate 531b).
func TestInstanceBadgeOnlyWithTheRuntimeFlag(t *testing.T) {
	const badge = `<script type="module" async nonce="n0nce" data-instance-badge>import('/frontend/reusable_components/instance_badge/instance_badge.js').catch(function () {});</script>`
	for _, flag := range []string{"", "relative/record.json", "/srv/mirror/instance_info.json"} {
		t.Setenv(instance_info.RecordEnv, flag)
		boot := frontendassets.NewShellBootData(httptest.NewRequest(http.MethodGet, "/", nil), "fi")
		if boot.InstanceBadge != strings.HasPrefix(flag, "/") {
			t.Fatalf("flag %q: InstanceBadge = %v", flag, boot.InstanceBadge)
		}
		for _, name := range []string{"index.html", "templates/login.html", "templates/register.html", "templates/first_run_admin.html"} {
			page, err := template.ParseFiles(filepath.Join("..", "..", "..", "frontend", name))
			if err != nil {
				t.Fatal(err)
			}
			for _, standalone := range []bool{true, false} {
				if name == "index.html" && !standalone {
					continue
				}
				response := httptest.NewRecorder()
				data := map[string]any{"ShellBoot": boot, "CSPNonce": "n0nce", "LangCode": "fi", "StandalonePage": standalone, "SiteName": "Test", "VerificationMethod": "none"}
				if err := page.Execute(response, data); err != nil {
					t.Fatal(err)
				}
				body := response.Body.String()
				if got, want := strings.Count(body, badge), map[bool]int{true: 1, false: 0}[boot.InstanceBadge && standalone]; got != want {
					t.Fatalf("%s flag %q standalone %v: %d async badge modules, want %d", name, flag, standalone, got, want)
				}
				if strings.Count(body, "/instance_badge/") != strings.Count(body, badge) {
					t.Fatalf("%s flag %q: a badge asset outside the one async module (a blocking <link> or script)", name, flag)
				}
			}
		}
	}
}

func TestShellPageDataEnvironmentAndMethod(t *testing.T) {
	for _, env := range []string{"", "prod", "dev"} {
		t.Setenv("ENVIRONMENT_TYPE", env)
		for _, target := range []string{"/?lang=fi", "/?fragment=1&lang=en"} {
			data := frontendassets.NewShellPageData(httptest.NewRequest(http.MethodPost, target, nil))
			if data.IsDev != (env == "dev") || data.ShellBoot.IsGET || data.StandalonePage != !strings.Contains(target, "fragment") {
				t.Fatalf("data = %+v", data)
			}
		}
	}
}

func TestBrokenShellTemplateUsesTheSameTranslatedRecovery(t *testing.T) {
	response := httptest.NewRecorder()
	middlewares.WithCSP(http.HandlerFunc(frontendassets.RenderShellTemplateFailure)).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/?lang=fi", nil))
	if response.Code != http.StatusInternalServerError || !strings.Contains(response.Header().Get("Cache-Control"), "no-store") {
		t.Fatal("incorrect failure status/cache")
	}
	body := response.Body.String()
	if !strings.Contains(body, "Sivu ei latautunut.") || !strings.Contains(body, "data-shell-boot-document-failed") || strings.Contains(body, "{{") {
		t.Fatal("failure is not a rendered recovery document")
	}
	nonce := regexp.MustCompile(`'nonce-([^']+)'`).FindStringSubmatch(response.Header().Get("Content-Security-Policy"))[1]
	for _, id := range []string{"shell-boot-style", "shell-boot-guard"} {
		if !strings.Contains(html.UnescapeString(body), `id="`+id+`" nonce="`+nonce+`"`) {
			t.Fatalf("missing failure nonce on %s", id)
		}
	}
}
