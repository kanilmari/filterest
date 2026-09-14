// Verifies the shipped page carries its local first-paint scripts under the actual CSP nonce.
// Delayed optional asset requests must never be required to authorize those scripts.
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

	"easelect/backend/core_components/middlewares"
)

func TestStartupScriptsUsePerResponseCSPNonce(t *testing.T) {
	page, err := template.ParseFiles(filepath.Join("..", "..", "..", "frontend", "index.html"))
	if err != nil {
		t.Fatal(err)
	}
	for _, minified := range []bool{false, true} {
		var previousNonce string
		for request := 0; request < 2; request++ {
			response := httptest.NewRecorder()
			handler := middlewares.WithCSP(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				data := map[string]any{
					"CSPNonce":          middlewares.GetCSPNonce(r),
					"UseMinifiedAssets": minified,
					"ImportsCSSPath":    "/frontend/dist/imports.test.min.css",
					"MainBundlePath":    "/frontend/dist/main.test.min.js",
				}
				if err := page.Execute(w, data); err != nil {
					t.Fatal(err)
				}
			}))
			handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/", nil))
			policy := response.Header().Get("Content-Security-Policy")
			nonceMatch := regexp.MustCompile("'nonce-([^']+)'").FindStringSubmatch(policy)
			if len(nonceMatch) != 2 {
				t.Fatalf("missing nonce policy: %s", policy)
			}
			nonce := nonceMatch[1]
			if nonce == previousNonce {
				t.Fatal("CSP nonce was reused")
			}
			previousNonce = nonce
			if strings.Contains(policy, "unsafe-inline") || strings.Contains(policy, "unsafe-eval") {
				t.Fatal("startup must not weaken script policy")
			}
			body := html.UnescapeString(response.Body.String())
			for _, id := range []string{"site-presentation-bootstrap", "initial-shell-bootstrap"} {
				if !strings.Contains(body, `id="`+id+`" nonce="`+nonce+`"`) {
					t.Fatalf("%s was not authorized by this response's nonce", id)
				}
			}
			if strings.Contains(body, "src=\"/frontend/public/site_presentation_bootstrap.js\"") ||
				strings.Contains(body, "src=\"/frontend/public/initial_browser_check.js\"") {
				t.Fatal("startup depends on an external classic script")
			}
			if !strings.Contains(body, "localStorage.getItem(") ||
				!strings.Contains(body, "data-navbar-initial-open") {
				t.Fatal("template escaped or removed the local bootstrap")
			}
		}
	}
}
