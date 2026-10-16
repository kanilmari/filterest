// sec4_read_boundary_test.go
// Exercises the accepted security lows through real handlers with in-memory SQL.
// Connects permission principals and controlled rows without network or installation data.
// Refusals must precede disclosure; administrator behavior remains covered.
package router_test

import (
	"easelect/backend/core_components/dbutils/queryfixture"
	"easelect/backend/core_components/router"
	"net/http/httptest"
	"testing"
)

func TestSEC4CodingRoutesRequireDevOrConfiguredSocket(t *testing.T) {
	for _, test := range []struct {
		env, socket string
		want        bool
	}{{"prod", "", false}, {"prod", "  ", false}, {"prod", "/test/runner.sock", true}, {"dev", "", true}} {
		t.Setenv("ENVIRONMENT_TYPE", test.env)
		t.Setenv("FILTEREST_CODING_AGENT_SOCKET", test.socket)
		router.RegisterRoutes("frontend", "storage")
		count := 0
		for _, route := range router.GetRouteDefinitions() {
			if route.UrlPattern == "/api/app/ai-chat/codex-query" || route.UrlPattern == "/api/app/ai-chat/site-assistant-approval" {
				count++
			}
		}
		want := 0
		if test.want {
			want = 2
		}
		if count != want {
			t.Fatalf("%s configured=%v: routes=%d want %d", test.env, test.socket != "", count, want)
		}
	}
}
func TestSEC4PaidHelpersRefuseGuestBeforeProviderWork(t *testing.T) {
	router.RegisterRoutes("frontend", "storage")
	count := 0
	for _, route := range router.GetRouteDefinitions() {
		if route.HandlerName != "image_source_picker.ProvidersHandler" && route.HandlerName != "image_source_picker.ResolveHandler" && route.HandlerName != "image_source_picker.FileHandler" && route.HandlerName != "lang.GenerateTranslationsHandler" {
			continue
		}
		count++
		for _, id := range []int{0, 1} {
			method := "POST"
			if route.HandlerName == "image_source_picker.ProvidersHandler" {
				method = "GET"
			}
			req := queryfixture.Request(t, method, route.UrlPattern, `{"missingKeys":[]}`, id, "guest")
			req.Header.Set("X-Bypass-Ratelimit", "test-mode")
			rec := httptest.NewRecorder()
			route.HandlerFunc(rec, req)
			if rec.Code != 403 {
				t.Errorf("%s user %d: status=%d want 403", route.HandlerName, id, rec.Code)
			}
		}
	}
	if count != 4 {
		t.Fatalf("checked %d helper routes", count)
	}
}
