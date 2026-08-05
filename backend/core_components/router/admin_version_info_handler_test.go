// admin_version_info_handler_test.go
// Verifies the administrator version endpoint's compact payload and method contract.
// Bridges the injected readiness snapshot with the role-gated HTTP handler.
// Exists to keep product and database versions aligned with the canonical readiness source.
package router

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAdminVersionInfoHandlerReturnsReadinessVersions(t *testing.T) {
	t.Setenv("EASELECT_RUNTIME_MODE", "docker")
	restoreProbe := replaceSystemReadinessProbe(func() systemReadyResponse {
		return systemReadyResponse{
			ProductName:       "Filterest",
			AppVersion:        "8.27.99",
			DBVersion:         "8.0.55",
			RequiredDBVersion: "8.0.55",
			DBCompatible:      true,
		}
	})
	defer restoreProbe()

	request := httptest.NewRequest(http.MethodGet, "/api/admin/version-info", nil)
	recorder := httptest.NewRecorder()

	adminVersionInfoHandler(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("adminVersionInfoHandler status = %d, want %d", recorder.Code, http.StatusOK)
	}

	var response adminVersionInfoResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if response.ProductName != "Filterest" || response.AppVersion != "8.27.99" {
		t.Fatalf("product/version = %q/%q, want Filterest/8.27.99", response.ProductName, response.AppVersion)
	}
	if response.DBVersion != "8.0.55" || response.RequiredDBVersion != "8.0.55" || !response.DBCompatible {
		t.Fatalf("database version payload = %#v, want compatible 8.0.55", response)
	}
	if response.RuntimeMode != "docker" {
		t.Fatalf("runtime mode = %q, want docker", response.RuntimeMode)
	}
}

func TestCurrentAdminRuntimeModeDefaultsToNative(t *testing.T) {
	t.Setenv("EASELECT_RUNTIME_MODE", "unexpected-value")

	if runtimeMode := currentAdminRuntimeMode(); runtimeMode != "native" {
		t.Fatalf("runtime mode = %q, want native", runtimeMode)
	}
}

func TestAdminVersionInfoHandlerRejectsNonGet(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/api/admin/version-info", nil)
	recorder := httptest.NewRecorder()

	adminVersionInfoHandler(recorder, request)

	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("adminVersionInfoHandler status = %d, want %d", recorder.Code, http.StatusMethodNotAllowed)
	}
}
