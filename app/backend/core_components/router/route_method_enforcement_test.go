// route_method_enforcement_test.go
// Proves route registrations, rather than individual handlers, own HTTP-method enforcement.
// Covers refusal of read methods and completeness of the public route inventory.
// Exists so new handlers cannot silently bypass the machine-readable method contract.
package router

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"
)

func TestRegisteredPostOnlyRouteRefusesGetAndHeadBeforeHandler(t *testing.T) {
	ResetRouteDefinitions()
	t.Cleanup(ResetRouteDefinitions)

	handlerCalls := 0
	functionRegisterHandler(
		"/test/post-only",
		func(w http.ResponseWriter, _ *http.Request) {
			handlerCalls++
			w.WriteHeader(http.StatusNoContent)
		},
		"router.testPostOnlyHandler",
		http.MethodPost,
	)

	route := GetRouteDefinitions()[0]
	for _, method := range []string{http.MethodGet, http.MethodHead} {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(method, route.UrlPattern, nil)

		route.HandlerFunc(recorder, request)

		if recorder.Code != http.StatusMethodNotAllowed {
			t.Fatalf("%s status = %d, want %d", method, recorder.Code, http.StatusMethodNotAllowed)
		}
		if got := recorder.Header().Get("Allow"); got != http.MethodPost {
			t.Fatalf("%s Allow = %q, want %q", method, got, http.MethodPost)
		}
	}
	if handlerCalls != 0 {
		t.Fatalf("handler calls = %d, want 0", handlerCalls)
	}
}

func TestRegisteredGetRouteAnswersHeadWithGetSemantics(t *testing.T) {
	ResetRouteDefinitions()
	t.Cleanup(ResetRouteDefinitions)

	seenMethod := ""
	functionRegisterHandler(
		"/test/read",
		func(w http.ResponseWriter, request *http.Request) {
			seenMethod = request.Method
			w.WriteHeader(http.StatusNoContent)
		},
		"router.testReadHandler",
		http.MethodGet,
	)

	route := GetRouteDefinitions()[0]
	if !slices.Equal(route.Methods, []string{http.MethodGet, http.MethodHead}) {
		t.Fatalf("methods = %#v, want GET and HEAD", route.Methods)
	}
	recorder := httptest.NewRecorder()
	route.HandlerFunc(recorder, httptest.NewRequest(http.MethodHead, route.UrlPattern, nil))
	if recorder.Code != http.StatusNoContent {
		t.Fatalf("HEAD status = %d, want %d", recorder.Code, http.StatusNoContent)
	}
	if seenMethod != http.MethodGet {
		t.Fatalf("handler method = %q, want GET semantics", seenMethod)
	}
}

func TestSharedEnforcementPreservesLegacyRejectionShapes(t *testing.T) {
	t.Cleanup(ResetRouteDefinitions)
	testCases := []struct {
		name        string
		handlerName string
		contentType string
		body        map[string]any
		plainBody   string
		cache       string
	}{
		{
			name:        "standard JSON",
			handlerName: "auth.LoginAPIHandler",
			contentType: "application/json; charset=utf-8",
			body:        map[string]any{"error": "Method not allowed", "code": float64(http.StatusMethodNotAllowed)},
		},
		{
			name:        "plain text",
			handlerName: "agent_tools.TasksHandler",
			contentType: "text/plain; charset=utf-8",
			plainBody:   "Method not allowed\n",
		},
		{
			name:        "simple JSON",
			handlerName: "db_admin.ListRolesHandler",
			contentType: "application/json",
			body:        map[string]any{"error": "method not allowed"},
		},
		{
			name:        "nested no-store JSON",
			handlerName: "image_source_picker.FileHandler",
			contentType: "application/json; charset=utf-8",
			body: map[string]any{"error": map[string]any{
				"code": "method_not_allowed", "message": "Method not allowed.",
			}},
			cache: "no-store",
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			ResetRouteDefinitions()
			functionRegisterHandler("/test/rejection", func(http.ResponseWriter, *http.Request) {
				t.Fatal("rejected request reached handler")
			}, testCase.handlerName, http.MethodPost)

			recorder := httptest.NewRecorder()
			GetRouteDefinitions()[0].HandlerFunc(
				recorder,
				httptest.NewRequest(http.MethodGet, "/test/rejection", nil),
			)
			if recorder.Code != http.StatusMethodNotAllowed {
				t.Fatalf("status = %d, want %d", recorder.Code, http.StatusMethodNotAllowed)
			}
			if got := recorder.Header().Get("Content-Type"); got != testCase.contentType {
				t.Fatalf("Content-Type = %q, want %q", got, testCase.contentType)
			}
			if got := recorder.Header().Get("Cache-Control"); got != testCase.cache {
				t.Fatalf("Cache-Control = %q, want %q", got, testCase.cache)
			}
			if testCase.plainBody != "" {
				if recorder.Body.String() != testCase.plainBody {
					t.Fatalf("body = %q, want %q", recorder.Body.String(), testCase.plainBody)
				}
				return
			}
			var body map[string]any
			if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode body: %v", err)
			}
			if !mapsEqual(body, testCase.body) {
				t.Fatalf("body = %#v, want %#v", body, testCase.body)
			}
		})
	}
}

func mapsEqual(left, right map[string]any) bool {
	leftJSON, _ := json.Marshal(left)
	rightJSON, _ := json.Marshal(right)
	return string(leftJSON) == string(rightJSON)
}

func TestEveryPublicRouteDeclaresMethodsAndGetIncludesHead(t *testing.T) {
	RegisterRoutes(t.TempDir(), t.TempDir())
	t.Cleanup(ResetRouteDefinitions)

	for _, route := range GetRouteDefinitions() {
		if err := validateRouteMethodContract(route); err != nil {
			t.Error(err)
			continue
		}
		if slices.Contains(route.Methods, http.MethodGet) && !slices.Contains(route.Methods, http.MethodHead) {
			t.Errorf("route %s (%s) declares GET without HEAD", route.UrlPattern, route.HandlerName)
		}
	}
}
