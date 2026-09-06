// system_automation_account_handler_test.go
// Verifies the trusted manager boundary and stable route contract for automation credentials.
// Bridges HTTP peer/token validation, strict payload parsing, routing, and pipeline metadata.
// Exists so the bootstrap API cannot become an unauthenticated administrator-creation surface.
package router

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/pipeline"
)

const automationAccountTestManagerToken = "automation-account-manager-token-32-bytes-minimum"

func newAutomationAccountManagerRequest(method, body string) *http.Request {
	request := httptest.NewRequest(method, "/system/automation-account", strings.NewReader(body))
	request.RemoteAddr = "127.0.0.1:48123"
	request.Header.Set("Authorization", "Bearer "+automationAccountTestManagerToken)
	request.Header.Set("Content-Type", "application/json")
	return request
}

func TestSystemAutomationAccountHandlerRejectsWrongPeerOrToken(t *testing.T) {
	t.Setenv("EASELECT_SYSTEM_MANAGER_TOKEN", automationAccountTestManagerToken)
	t.Setenv("EASELECT_SYSTEM_MANAGER_TRUSTED_PEER_IP", "172.23.0.1")

	tests := []struct {
		name    string
		request *http.Request
	}{
		{
			name: "wrong peer",
			request: func() *http.Request {
				request := newAutomationAccountManagerRequest(http.MethodGet, "")
				request.RemoteAddr = "172.23.0.2:48123"
				return request
			}(),
		},
		{
			name: "wrong token",
			request: func() *http.Request {
				request := newAutomationAccountManagerRequest(http.MethodGet, "")
				request.Header.Set("Authorization", "Bearer wrong-token-with-enough-characters-123")
				return request
			}(),
		},
		{
			name: "forwarded loopback",
			request: func() *http.Request {
				request := newAutomationAccountManagerRequest(http.MethodGet, "")
				request.Header.Set("X-Forwarded-For", "127.0.0.1")
				return request
			}(),
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			systemAutomationAccountHandler(recorder, test.request)
			if recorder.Code != http.StatusForbidden {
				t.Fatalf("status = %d, want %d", recorder.Code, http.StatusForbidden)
			}
			if !strings.Contains(recorder.Header().Get("Cache-Control"), "no-store") {
				t.Fatal("credential endpoint response is cacheable")
			}
		})
	}
}

func TestSystemAutomationAccountHandlerRejectsWrongMethodBeforeCredentialWork(t *testing.T) {
	request := newAutomationAccountManagerRequest(http.MethodDelete, "")
	recorder := httptest.NewRecorder()
	systemAutomationAccountHandler(recorder, request)
	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusMethodNotAllowed)
	}
	if recorder.Header().Get("Allow") != "GET, POST" {
		t.Fatalf("Allow = %q", recorder.Header().Get("Allow"))
	}
}

func TestSystemAutomationAccountHandlerRejectsMalformedOrUnknownPayload(t *testing.T) {
	t.Setenv("EASELECT_SYSTEM_MANAGER_TOKEN", automationAccountTestManagerToken)
	secret := "do-not-echo-this-password-41"
	for name, body := range map[string]string{
		"malformed": `{"password":`,
		"unknown":   `{"password":"` + secret + `","username":"someone"}`,
		"trailing":  `{"password":"` + secret + `"} {}`,
		"empty":     `{}`,
	} {
		t.Run(name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			systemAutomationAccountHandler(recorder, newAutomationAccountManagerRequest(http.MethodPost, body))
			if recorder.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d; body=%s", recorder.Code, http.StatusBadRequest, recorder.Body.String())
			}
			if strings.Contains(recorder.Body.String(), secret) {
				t.Fatal("response echoed submitted credential")
			}
		})
	}
}

func TestSystemAutomationAccountHandlerRequiresPrivilegedDatabase(t *testing.T) {
	t.Setenv("EASELECT_SYSTEM_MANAGER_TOKEN", automationAccountTestManagerToken)
	previousAdminDB := backend.DbAdmin
	backend.DbAdmin = nil
	t.Cleanup(func() { backend.DbAdmin = previousAdminDB })

	recorder := httptest.NewRecorder()
	systemAutomationAccountHandler(
		recorder,
		newAutomationAccountManagerRequest(http.MethodPost, `{"password":"generated-test-password-45"}`),
	)
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusServiceUnavailable)
	}
}

func TestSystemAutomationAccountRouteAndProfileContract(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "production")
	ResetRouteDefinitions()
	RegisterRoutes("frontend", "storage")

	found := false
	for _, route := range GetRouteDefinitions() {
		if route.HandlerName != "router.systemAutomationAccountHandler" {
			continue
		}
		found = true
		if route.UrlPattern != "/system/automation-account" || route.MatchType != RouteMatchExact {
			t.Fatalf("route = %#v", route)
		}
	}
	if !found {
		t.Fatal("system automation account route is not registered")
	}

	contract, ok := GetRouteMethodContract("router.systemAutomationAccountHandler")
	if !ok || contract.Source != RouteMethodSourceExplicitStableContract ||
		len(contract.Methods) != 2 || contract.Methods[0] != http.MethodGet || contract.Methods[1] != http.MethodPost {
		t.Fatalf("method contract = %#v, found=%v", contract, ok)
	}
	profile := pipeline.GetProfile("router.systemAutomationAccountHandler")
	if profile.AdminOnly || !profile.Skips("auth") || !profile.Skips("csrf") || !profile.Skips("access_control") {
		t.Fatalf("system-manager route must use PublicProfile before its own stricter boundary: %#v", profile)
	}
}
