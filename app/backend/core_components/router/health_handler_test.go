// health_handler_test.go
// Verifies the public router health endpoint contract for infrastructure probes.
// Bridges the health handler implementation and HTTP callers with regression
// checks for both the success payload and method restriction.
// Exists to keep the load-balancer-facing readiness endpoint stable.

package router

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/runtimepaths"
)

func TestCurrentSystemStorageRootUsesConfiguredRuntimePath(t *testing.T) {
	originalPaths := runtimepaths.Current()
	workingDirectory, err := os.Getwd()
	if err != nil {
		t.Fatalf("os.Getwd() error = %v", err)
	}
	t.Cleanup(func() {
		if err := runtimepaths.Configure(originalPaths); err == nil {
			return
		}
		legacyPaths, resolveErr := runtimepaths.Resolve(workingDirectory, workingDirectory, false)
		if resolveErr == nil {
			_ = runtimepaths.Configure(legacyPaths)
		}
	})

	installationRoot := t.TempDir()
	paths, err := runtimepaths.Resolve(filepath.Join(installationRoot, "app"), installationRoot, true)
	if err != nil {
		t.Fatalf("runtimepaths.Resolve() error = %v", err)
	}
	if err := runtimepaths.Configure(paths); err != nil {
		t.Fatalf("runtimepaths.Configure() error = %v", err)
	}

	if got := currentSystemStorageRoot(); got != paths.StorageRoot {
		t.Fatalf("currentSystemStorageRoot() = %q, want %q", got, paths.StorageRoot)
	}
}

func TestReadRequiredDBVersionUsesNestedApplicationRoot(t *testing.T) {
	originalPaths := runtimepaths.Current()
	t.Cleanup(func() { _ = runtimepaths.Configure(originalPaths) })

	installationRoot := t.TempDir()
	applicationRoot := filepath.Join(installationRoot, "app")
	if err := os.MkdirAll(applicationRoot, 0o755); err != nil {
		t.Fatalf("os.MkdirAll(app) error = %v", err)
	}
	if err := os.WriteFile(
		filepath.Join(applicationRoot, "VERSION_DB"),
		[]byte("9.6.7\n"),
		0o644,
	); err != nil {
		t.Fatalf("os.WriteFile(app/VERSION_DB) error = %v", err)
	}
	paths, err := runtimepaths.Resolve(applicationRoot, installationRoot, true)
	if err != nil {
		t.Fatalf("runtimepaths.Resolve() error = %v", err)
	}
	if err := runtimepaths.Configure(paths); err != nil {
		t.Fatalf("runtimepaths.Configure() error = %v", err)
	}

	got, err := readRequiredDBVersion()
	if err != nil {
		t.Fatalf("readRequiredDBVersion() error = %v", err)
	}
	if got != "9.6.7" {
		t.Fatalf("readRequiredDBVersion() = %q, want 9.6.7", got)
	}
	if _, err := os.Stat(filepath.Join(installationRoot, "VERSION_DB")); !os.IsNotExist(err) {
		t.Fatalf("standalone installation root unexpectedly contains VERSION_DB: %v", err)
	}
}

func TestReadRequiredDBVersionKeepsLegacyOuterRoot(t *testing.T) {
	originalPaths := runtimepaths.Current()
	t.Cleanup(func() { _ = runtimepaths.Configure(originalPaths) })

	privateRoot := t.TempDir()
	if err := os.WriteFile(
		filepath.Join(privateRoot, "VERSION_DB"),
		[]byte("9.6.7\n"),
		0o644,
	); err != nil {
		t.Fatalf("os.WriteFile(VERSION_DB) error = %v", err)
	}
	paths, err := runtimepaths.Resolve(privateRoot, privateRoot, false)
	if err != nil {
		t.Fatalf("runtimepaths.Resolve() error = %v", err)
	}
	if err := runtimepaths.Configure(paths); err != nil {
		t.Fatalf("runtimepaths.Configure() error = %v", err)
	}

	got, err := readRequiredDBVersion()
	if err != nil {
		t.Fatalf("readRequiredDBVersion() error = %v", err)
	}
	if got != "9.6.7" {
		t.Fatalf("readRequiredDBVersion() = %q, want 9.6.7", got)
	}
}

func TestHealthHandlerReturnsOKJSON(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/health", nil)
	recorder := httptest.NewRecorder()

	healthHandler(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("healthHandler status = %d, want %d", recorder.Code, http.StatusOK)
	}
	if got := recorder.Header().Get("Content-Type"); got != "application/json; charset=utf-8" {
		t.Fatalf("healthHandler content type = %q, want application/json; charset=utf-8", got)
	}

	var response map[string]string
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if response["status"] != "ok" {
		t.Fatalf("healthHandler status payload = %q, want ok", response["status"])
	}
}

func TestSystemHealthHandlerReturnsManagerPayload(t *testing.T) {
	t.Setenv("INSTANCE_NAME", "easelect-a")

	request := newSystemRequest(http.MethodGet, "/system/health", "")
	recorder := httptest.NewRecorder()

	systemHealthHandler(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("systemHealthHandler status = %d, want %d", recorder.Code, http.StatusOK)
	}

	var response systemHealthResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if response.Status != "ok" {
		t.Fatalf("systemHealthHandler status payload = %q, want ok", response.Status)
	}
	if response.InstanceID != "easelect-a" {
		t.Fatalf("systemHealthHandler instance_id = %q, want easelect-a", response.InstanceID)
	}
	if response.Time == "" {
		t.Fatal("systemHealthHandler should include time")
	}
	if response.ProcessUptimeSeconds < 0 {
		t.Fatalf("systemHealthHandler uptime = %d, want >= 0", response.ProcessUptimeSeconds)
	}
}

func TestSystemReadyHandlerReturnsOKWhenProbeReady(t *testing.T) {
	restoreProbe := replaceSystemReadinessProbe(func() systemReadyResponse {
		return systemReadyResponse{
			Ready:                   true,
			Status:                  "ready",
			Reasons:                 []string{},
			InstanceID:              "easelect-a",
			InstallationEnvironment: "prod",
			ProductName:             "Filterest",
			AppVersion:              "8.0.126",
			ReleaseChannel:          "development",
			ArtifactPurpose:         "unknown",
			ArtifactType:            "runtime",
			ReleaseMaturity:         "snapshot",
			RequiredDBVersion:       "8.0.38",
			DBVersion:               "8.0.38",
			DBCompatible:            true,
			AcceptingNewWork:        true,
			ActiveRequests:          3,
			ActiveLongJobs:          0,
		}
	})
	defer restoreProbe()

	request := newSystemRequest(http.MethodGet, "/system/ready", "")
	recorder := httptest.NewRecorder()

	systemReadyHandler(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("systemReadyHandler status = %d, want %d", recorder.Code, http.StatusOK)
	}

	var response systemReadyResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if !response.Ready || response.Status != "ready" {
		t.Fatalf("systemReadyHandler payload ready/status = %v/%q, want true/ready", response.Ready, response.Status)
	}
	if response.InstallationEnvironment != "prod" {
		t.Fatalf("systemReadyHandler installation_environment = %q, want prod", response.InstallationEnvironment)
	}
	if response.Reasons == nil || len(response.Reasons) != 0 {
		t.Fatalf("systemReadyHandler reasons = %#v, want empty slice", response.Reasons)
	}
	if !response.DBCompatible {
		t.Fatal("systemReadyHandler db_compatible should be true")
	}
	if response.ActiveRequests != 3 {
		t.Fatalf("systemReadyHandler active_requests = %d, want 3", response.ActiveRequests)
	}
	if response.ReleaseChannel != "development" || response.ArtifactType != "runtime" ||
		response.ReleaseMaturity != "snapshot" || response.PublicDistribution {
		t.Fatalf("systemReadyHandler release identity = %#v, want Filterest development runtime snapshot", response)
	}
}

func TestSystemReadyHandlerReturnsServiceUnavailableWhenProbeNotReady(t *testing.T) {
	restoreProbe := replaceSystemReadinessProbe(func() systemReadyResponse {
		return systemReadyResponse{
			Ready:   false,
			Status:  "not_ready",
			Reasons: []string{"database_unavailable"},
		}
	})
	defer restoreProbe()

	request := newSystemRequest(http.MethodGet, "/system/ready", "")
	recorder := httptest.NewRecorder()

	systemReadyHandler(recorder, request)

	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("systemReadyHandler status = %d, want %d", recorder.Code, http.StatusServiceUnavailable)
	}
	if !strings.Contains(recorder.Body.String(), "database_unavailable") {
		t.Fatalf("systemReadyHandler body = %q, want database_unavailable", recorder.Body.String())
	}
}

func TestSystemInstanceStatusHandlerReturnsManagerSnapshot(t *testing.T) {
	resetSystemDesiredStateForTest(t)
	t.Setenv("EASELECT_BACKGROUND_WORKER_ROLE", "none")
	atomic.StoreInt64(&systemActiveRequests, 7)
	defer atomic.StoreInt64(&systemActiveRequests, 0)

	restoreProbe := replaceSystemReadinessProbe(func() systemReadyResponse {
		return systemReadyResponse{
			Ready:                   true,
			Status:                  "ready",
			Reasons:                 []string{},
			InstanceID:              "easelect-a",
			InstallationEnvironment: "prod",
			ProductName:             "Filterest",
			AppVersion:              "8.0.128",
			AppVersionFile:          "VERSION_EASELECT",
			ReleaseChannel:          "development",
			ArtifactPurpose:         "unknown",
			ArtifactType:            "runtime",
			ReleaseMaturity:         "snapshot",
			RequiredDBVersion:       "8.0.38",
			DBVersion:               "8.0.38",
			DBCompatible:            true,
			AcceptingNewWork:        true,
			ActiveLongJobs:          2,
			DrainSupported:          false,
		}
	})
	defer restoreProbe()

	request := newSystemRequest(http.MethodGet, "/system/instance-status", "")
	recorder := httptest.NewRecorder()

	systemInstanceStatusHandler(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("systemInstanceStatusHandler status = %d, want %d", recorder.Code, http.StatusOK)
	}

	var response systemInstanceStatusResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if !response.Ready || response.Status != "ready" {
		t.Fatalf("systemInstanceStatusHandler ready/status = %v/%q, want true/ready", response.Ready, response.Status)
	}
	if response.InstanceID != "easelect-a" {
		t.Fatalf("systemInstanceStatusHandler instance_id = %q, want easelect-a", response.InstanceID)
	}
	if response.InstallationEnvironment != "prod" {
		t.Fatalf("systemInstanceStatusHandler installation_environment = %q, want prod", response.InstallationEnvironment)
	}
	if response.ReleaseChannel != "development" || response.ArtifactType != "runtime" ||
		response.ReleaseMaturity != "snapshot" || response.PublicDistribution {
		t.Fatalf("systemInstanceStatusHandler release identity = %#v, want Filterest development runtime snapshot", response)
	}
	if response.ActiveRequests != 7 {
		t.Fatalf("systemInstanceStatusHandler active_requests = %d, want 7", response.ActiveRequests)
	}
	if response.ActiveLongJobs != 2 {
		t.Fatalf("systemInstanceStatusHandler active_long_jobs = %d, want 2", response.ActiveLongJobs)
	}
	if response.DesiredStateSeenByApp != "active" {
		t.Fatalf("systemInstanceStatusHandler desired state = %q, want active", response.DesiredStateSeenByApp)
	}
	if response.BackgroundWorkerRole != "none" {
		t.Fatalf("systemInstanceStatusHandler background_worker_role = %q, want none", response.BackgroundWorkerRole)
	}
	if response.DrainState != "unsupported" {
		t.Fatalf("systemInstanceStatusHandler drain_state = %q, want unsupported", response.DrainState)
	}
	if response.StorageRoot == "" {
		t.Fatal("systemInstanceStatusHandler should include storage_root")
	}
	if response.DatabasePools == nil {
		t.Fatal("systemInstanceStatusHandler should include database_pools")
	}
	if !response.DatabasePoolHeadroom.Available && response.DatabasePoolHeadroom.Error == "" {
		t.Fatal("systemInstanceStatusHandler should include database_pool_headroom status")
	}
	if response.Time == "" {
		t.Fatal("systemInstanceStatusHandler should include time")
	}
	if response.ProcessUptimeSeconds < 0 {
		t.Fatalf("systemInstanceStatusHandler uptime = %d, want >= 0", response.ProcessUptimeSeconds)
	}
}

func TestBuildSystemReadinessResponseReportsRuntimeInstallationPurposeWithoutDatabase(t *testing.T) {
	previousDB := backend.Db
	backend.Db = nil
	t.Cleanup(func() { backend.Db = previousDB })
	t.Setenv("ENVIRONMENT_TYPE", "prod")

	response := buildSystemReadinessResponse()

	if response.InstallationEnvironment != "prod" {
		t.Fatalf("buildSystemReadinessResponse installation_environment = %q, want prod", response.InstallationEnvironment)
	}
}

func TestSystemManagerEndpointsRejectPublicRemoteAddress(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/system/ready", nil)
	request.RemoteAddr = "203.0.113.10:41234"
	recorder := httptest.NewRecorder()

	systemReadyHandler(recorder, request)

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("systemReadyHandler public remote status = %d, want %d", recorder.Code, http.StatusForbidden)
	}
}

func TestSystemManagerEndpointsRejectPublicForwardedClient(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/system/ready", nil)
	request.RemoteAddr = "127.0.0.1:41234"
	request.Header.Set("X-Forwarded-For", "198.51.100.10")
	recorder := httptest.NewRecorder()

	systemReadyHandler(recorder, request)

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("systemReadyHandler public forwarded status = %d, want %d", recorder.Code, http.StatusForbidden)
	}
}

func TestSystemManagerEndpointsAllowPrivateForwardedClient(t *testing.T) {
	restoreProbe := replaceSystemReadinessProbe(func() systemReadyResponse {
		return systemReadyResponse{
			Ready:             true,
			Status:            "ready",
			Reasons:           []string{},
			InstanceID:        "easelect-a",
			ProductName:       "Filterest",
			AppVersion:        "8.0.208",
			RequiredDBVersion: "8.0.38",
			DBVersion:         "8.0.38",
			DBCompatible:      true,
			AcceptingNewWork:  true,
			DrainSupported:    true,
		}
	})
	defer restoreProbe()

	request := httptest.NewRequest(http.MethodGet, "/system/ready", nil)
	request.RemoteAddr = "127.0.0.1:41234"
	request.Header.Set("X-Forwarded-For", "10.10.0.5")
	recorder := httptest.NewRecorder()

	systemReadyHandler(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("systemReadyHandler private forwarded status = %d, want %d", recorder.Code, http.StatusOK)
	}
}

func TestSystemManagerEndpointsRejectForwardedHeaderPublicClient(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/system/ready", nil)
	request.RemoteAddr = "127.0.0.1:41234"
	request.Header.Set("Forwarded", `for="[2001:db8::1]";proto=https;host=filterest.com`)
	recorder := httptest.NewRecorder()

	systemReadyHandler(recorder, request)

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("systemReadyHandler Forwarded public status = %d, want %d", recorder.Code, http.StatusForbidden)
	}
}

func TestSystemVersionsCompatibleUsesFullDatabaseVersion(t *testing.T) {
	tests := []struct {
		name     string
		required string
		actual   string
		want     bool
	}{
		{name: "same major minor lower patch", required: "8.0.38", actual: "8.0.1", want: false},
		{name: "same version", required: "8.0.38", actual: "8.0.38", want: true},
		{name: "newer patch", required: "8.0.38", actual: "8.0.39", want: true},
		{name: "newer minor", required: "8.0.38", actual: "8.1.0", want: true},
		{name: "older minor", required: "8.1.0", actual: "8.0.99", want: false},
		{name: "older major", required: "8.0.0", actual: "7.9.99", want: false},
		{name: "newer major", required: "8.0.0", actual: "9.0.0", want: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := systemVersionsCompatible(test.required, test.actual); got != test.want {
				t.Fatalf("systemVersionsCompatible(%q, %q) = %v, want %v", test.required, test.actual, got, test.want)
			}
		})
	}
}

func replaceSystemReadinessProbe(replacement func() systemReadyResponse) func() {
	original := systemReadinessProbe
	systemReadinessProbe = replacement
	return func() {
		systemReadinessProbe = original
	}
}

func newSystemRequest(method string, path string, body string) *http.Request {
	var request *http.Request
	if body == "" {
		request = httptest.NewRequest(method, path, nil)
	} else {
		request = httptest.NewRequest(method, path, strings.NewReader(body))
	}
	request.RemoteAddr = "127.0.0.1:41234"
	request.Header.Set("Authorization", "Bearer "+testSystemManagerToken)
	return request
}

const testSystemManagerToken = "test-system-manager-token-32-bytes-minimum"
