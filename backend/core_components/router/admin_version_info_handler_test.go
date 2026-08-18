// admin_version_info_handler_test.go
// Verifies the administrator version endpoint's compact payload and method contract.
// Bridges the injected readiness snapshot with the role-gated HTTP handler.
// Exists to keep product and database versions aligned with the canonical readiness source.
package router

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	releaseupdates "easelect/backend/core_components/release_updates"
)

func TestAdminVersionInfoHandlerReturnsReadinessVersions(t *testing.T) {
	t.Setenv("EASELECT_RUNTIME_MODE", "docker")
	restoreProbe := replaceSystemReadinessProbe(func() systemReadyResponse {
		return systemReadyResponse{
			ProductName:          "Filterest",
			AppVersion:           "8.27.99",
			ReleaseChannel:       "stable",
			ArtifactPurpose:      "public_release",
			ArtifactType:         "runtime",
			ReleaseMaturity:      "published",
			IdentityVerification: "local_contract_validated",
			BuildID:              "filterest-8.27.99-stable-runtime-0123456789ab",
			PublicDistribution:   true,
			DBVersion:            "8.0.55",
			RequiredDBVersion:    "8.0.55",
			DBCompatible:         true,
		}
	})
	defer restoreProbe()
	originalReleaseCheck := adminLatestStableReleaseCheck
	adminLatestStableReleaseCheck = func(context.Context, string) releaseupdates.Status {
		return releaseupdates.Status{
			LatestStableVersion: "8.28.0",
			UpdateStatus:        releaseupdates.UpdateStatusAvailable,
			UpdateAvailable:     true,
			ReleaseURL:          "https://github.com/kanilmari/filterest/releases/tag/v8.28.0",
			CheckedAt:           "2026-08-14T09:00:00Z",
		}
	}
	defer func() { adminLatestStableReleaseCheck = originalReleaseCheck }()

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
	if response.ReleaseChannel != "stable" || response.ArtifactPurpose != "public_release" || !response.PublicDistribution {
		t.Fatalf("release identity payload = %#v, want stable public release", response)
	}
	if response.ArtifactType != "runtime" || response.ReleaseMaturity != "published" ||
		response.IdentityVerification != "local_contract_validated" || response.BuildID == "" {
		t.Fatalf("build identity payload = %#v, want validated published runtime", response)
	}
	if response.LatestStableVersion != "8.28.0" || response.UpdateStatus != releaseupdates.UpdateStatusAvailable || !response.UpdateAvailable {
		t.Fatalf("release update payload = %#v, want available 8.28.0", response)
	}
	if response.LatestReleaseURL == "" || response.UpdateCheckedAt == "" {
		t.Fatalf("release update metadata = %#v, want URL and checked time", response)
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
