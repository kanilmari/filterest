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
	"time"

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

func TestHealthHandlerRejectsNonGet(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/health", nil)
	recorder := httptest.NewRecorder()

	healthHandler(recorder, request)

	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("healthHandler status = %d, want %d", recorder.Code, http.StatusMethodNotAllowed)
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

func TestSystemHandlersRejectNonGet(t *testing.T) {
	for name, handler := range map[string]http.HandlerFunc{
		"systemHealthHandler":         systemHealthHandler,
		"systemReadyHandler":          systemReadyHandler,
		"systemInstanceStatusHandler": systemInstanceStatusHandler,
		"systemDrainHandler":          systemDrainHandler,
	} {
		t.Run(name, func(t *testing.T) {
			request := newSystemRequest(http.MethodGet, "/", "")
			if name != "systemDrainHandler" {
				request = newSystemRequest(http.MethodPost, "/", "")
			}
			recorder := httptest.NewRecorder()

			handler(recorder, request)

			if recorder.Code != http.StatusMethodNotAllowed {
				t.Fatalf("%s status = %d, want %d", name, recorder.Code, http.StatusMethodNotAllowed)
			}
		})
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

func TestSystemDrainHandlerSetsAndClearsDrainState(t *testing.T) {
	resetSystemDesiredStateForTest(t)

	drainRequest := newSystemRequest(http.MethodPost, "/system/drain", "")
	drainRecorder := httptest.NewRecorder()

	systemDrainHandler(drainRecorder, drainRequest)

	if drainRecorder.Code != http.StatusOK {
		t.Fatalf("systemDrainHandler drain status = %d, want %d", drainRecorder.Code, http.StatusOK)
	}

	var drainResponse systemDrainResponse
	if err := json.Unmarshal(drainRecorder.Body.Bytes(), &drainResponse); err != nil {
		t.Fatalf("json.Unmarshal() drain response error = %v", err)
	}
	if drainResponse.DesiredStateSeenByApp != "draining" {
		t.Fatalf("systemDrainHandler desired state = %q, want draining", drainResponse.DesiredStateSeenByApp)
	}
	if drainResponse.AcceptingNewWork {
		t.Fatal("systemDrainHandler should mark accepting_new_work false while draining")
	}
	if drainResponse.DrainState != "drained" {
		t.Fatalf("systemDrainHandler drain_state = %q, want drained", drainResponse.DrainState)
	}

	readiness := buildSystemReadinessResponse()
	if readiness.AcceptingNewWork {
		t.Fatal("buildSystemReadinessResponse should reject new work while draining")
	}
	if readiness.Ready {
		t.Fatal("buildSystemReadinessResponse should not be ready while draining")
	}
	if !containsString(readiness.Reasons, "draining") {
		t.Fatalf("buildSystemReadinessResponse reasons = %#v, want draining", readiness.Reasons)
	}
	if !readiness.DrainSupported {
		t.Fatal("buildSystemReadinessResponse should report drain_supported true")
	}

	activeRequest := newSystemRequest(http.MethodPost, "/system/drain", `{"desired_state":"active"}`)
	activeRecorder := httptest.NewRecorder()

	systemDrainHandler(activeRecorder, activeRequest)

	if activeRecorder.Code != http.StatusOK {
		t.Fatalf("systemDrainHandler active status = %d, want %d", activeRecorder.Code, http.StatusOK)
	}
	if got := currentSystemDesiredState(); got != "active" {
		t.Fatalf("currentSystemDesiredState() = %q, want active", got)
	}
}

func TestSystemDrainHandlerAcceptsOnlyExactConfiguredDockerHostPeer(t *testing.T) {
	resetSystemDesiredStateForTest(t)
	t.Setenv("EASELECT_SYSTEM_MANAGER_TRUSTED_PEER_IP", "172.23.0.1")

	accepted := newSystemRequest(http.MethodPost, "/system/drain", "")
	accepted.RemoteAddr = "172.23.0.1:41234"
	acceptedRecorder := httptest.NewRecorder()
	systemDrainHandler(acceptedRecorder, accepted)
	if acceptedRecorder.Code != http.StatusOK {
		t.Fatalf("exact Docker host peer status = %d, want %d", acceptedRecorder.Code, http.StatusOK)
	}

	setSystemDesiredState(systemDesiredStateActive)
	for _, remoteAddress := range []string{"172.23.0.2:41234", "10.0.0.1:41234"} {
		request := newSystemRequest(http.MethodPost, "/system/drain", "")
		request.RemoteAddr = remoteAddress
		recorder := httptest.NewRecorder()
		systemDrainHandler(recorder, request)
		if recorder.Code != http.StatusForbidden {
			t.Fatalf("unconfigured private peer %s status = %d, want %d", remoteAddress, recorder.Code, http.StatusForbidden)
		}
	}

	t.Setenv("EASELECT_SYSTEM_MANAGER_TRUSTED_PEER_IP", "172.23.0.0/16")
	cidrRequest := newSystemRequest(http.MethodPost, "/system/drain", "")
	cidrRequest.RemoteAddr = "172.23.0.1:41234"
	cidrRecorder := httptest.NewRecorder()
	systemDrainHandler(cidrRecorder, cidrRequest)
	if cidrRecorder.Code != http.StatusForbidden {
		t.Fatalf("CIDR trust setting status = %d, want %d", cidrRecorder.Code, http.StatusForbidden)
	}
}

func TestSystemDrainHandlerRejectsInvalidDesiredState(t *testing.T) {
	resetSystemDesiredStateForTest(t)

	request := newSystemRequest(http.MethodPost, "/system/drain", `{"desired_state":"sideways"}`)
	recorder := httptest.NewRecorder()

	systemDrainHandler(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("systemDrainHandler invalid desired state status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}
}

func TestSystemActiveRequestTrackingCountsOnlyApplicationRequests(t *testing.T) {
	atomic.StoreInt64(&systemActiveRequests, 0)
	defer atomic.StoreInt64(&systemActiveRequests, 0)

	requestStarted := make(chan struct{})
	releaseRequest := make(chan struct{})
	requestDone := make(chan struct{})

	tracked := WithSystemActiveRequestTracking(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(requestStarted)
		<-releaseRequest
		w.WriteHeader(http.StatusNoContent)
		close(requestDone)
	}))

	go tracked.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/app/work", nil))
	<-requestStarted

	if got := currentSystemActiveRequests(); got != 1 {
		close(releaseRequest)
		<-requestDone
		t.Fatalf("active requests during application request = %d, want 1", got)
	}

	close(releaseRequest)
	<-requestDone

	if got := currentSystemActiveRequests(); got != 0 {
		t.Fatalf("active requests after application request = %d, want 0", got)
	}

	probeCalled := false
	probeTracked := WithSystemActiveRequestTracking(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		probeCalled = true
		if got := currentSystemActiveRequests(); got != 0 {
			t.Fatalf("active requests during probe request = %d, want 0", got)
		}
		w.WriteHeader(http.StatusNoContent)
	}))

	probeTracked.ServeHTTP(httptest.NewRecorder(), newSystemRequest(http.MethodGet, "/system/drain", ""))
	if !probeCalled {
		t.Fatal("probe handler was not called")
	}
}

func TestSystemAPIDrainGateLetsAdmittedRequestFinishAndRejectsLateAPIWork(t *testing.T) {
	resetSystemDesiredStateForTest(t)
	atomic.StoreInt64(&systemActiveAPIRequests, 0)
	t.Cleanup(func() { atomic.StoreInt64(&systemActiveAPIRequests, 0) })

	requestStarted := make(chan struct{})
	releaseRequest := make(chan struct{})
	requestDone := make(chan struct{})
	gated := WithSystemAPIDrainGate(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(requestStarted)
		<-releaseRequest
		w.WriteHeader(http.StatusNoContent)
		close(requestDone)
	}))

	go gated.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/api/save", nil))
	<-requestStarted
	if got := currentSystemActiveAPIRequests(); got != 1 {
		close(releaseRequest)
		<-requestDone
		t.Fatalf("active API requests before drain = %d, want 1", got)
	}

	drainRequest := newSystemRequest(http.MethodPost, "/system/drain", "")
	drainRecorder := httptest.NewRecorder()
	systemDrainHandler(drainRecorder, drainRequest)
	if drainRecorder.Code != http.StatusOK {
		close(releaseRequest)
		<-requestDone
		t.Fatalf("systemDrainHandler status = %d, want %d", drainRecorder.Code, http.StatusOK)
	}

	lateRecorder := httptest.NewRecorder()
	gated.ServeHTTP(lateRecorder, httptest.NewRequest(http.MethodGet, "/api/read-that-may-be-legacy-write", nil))
	if lateRecorder.Code != http.StatusServiceUnavailable {
		close(releaseRequest)
		<-requestDone
		t.Fatalf("late API status = %d, want %d", lateRecorder.Code, http.StatusServiceUnavailable)
	}
	if got := lateRecorder.Header().Get("Retry-After"); got != "5" {
		close(releaseRequest)
		<-requestDone
		t.Fatalf("late API Retry-After = %q, want 5", got)
	}
	if got := currentSystemDrainState(); got != "draining" {
		close(releaseRequest)
		<-requestDone
		t.Fatalf("drain state with admitted request = %q, want draining", got)
	}

	close(releaseRequest)
	<-requestDone
	if got := currentSystemActiveAPIRequests(); got != 0 {
		t.Fatalf("active API requests after completion = %d, want 0", got)
	}
	if got := currentSystemDrainState(); got != "drained" {
		t.Fatalf("drain state after API completion = %q, want drained", got)
	}
}

func TestSystemAPIDrainGateKeepsNonAPIPageAvailableForSaveWarningUI(t *testing.T) {
	resetSystemDesiredStateForTest(t)
	setSystemDesiredState(systemDesiredStateDraining)

	recorder := httptest.NewRecorder()
	WithSystemAPIDrainGate(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})).ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/frontend/main.js", nil))

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("non-API drain response = %d, want %d", recorder.Code, http.StatusNoContent)
	}
}

func TestSystemAPIDrainGateCancelsAdmittedPassiveSSEWhenDrainStarts(t *testing.T) {
	resetSystemDesiredStateForTest(t)
	atomic.StoreInt64(&systemActiveAPIRequests, 0)
	t.Cleanup(func() { atomic.StoreInt64(&systemActiveAPIRequests, 0) })

	requestStarted := make(chan struct{})
	requestDone := make(chan struct{})
	gated := WithSystemAPIDrainGate(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(requestStarted)
		<-r.Context().Done()
		close(requestDone)
	}))

	request := httptest.NewRequest(http.MethodGet, "/api/sse/subscribe?datasets=app_demo", nil)
	request.Header.Set("Accept", "text/event-stream")
	go gated.ServeHTTP(httptest.NewRecorder(), request)
	<-requestStarted
	if got := currentSystemActiveAPIRequests(); got != 1 {
		t.Fatalf("active API requests before drain = %d, want 1", got)
	}

	drainRecorder := httptest.NewRecorder()
	systemDrainHandler(drainRecorder, newSystemRequest(http.MethodPost, "/system/drain", ""))
	if drainRecorder.Code != http.StatusOK {
		t.Fatalf("systemDrainHandler status = %d, want %d", drainRecorder.Code, http.StatusOK)
	}

	select {
	case <-requestDone:
	case <-time.After(time.Second):
		t.Fatal("passive SSE request was not canceled by drain transition")
	}
	if got := currentSystemActiveAPIRequests(); got != 0 {
		t.Fatalf("active API requests after SSE cancellation = %d, want 0", got)
	}
	if got := currentSystemDrainState(); got != "drained" {
		t.Fatalf("drain state after SSE cancellation = %q, want drained", got)
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

func resetSystemDesiredStateForTest(t *testing.T) {
	t.Helper()
	t.Setenv("EASELECT_SYSTEM_MANAGER_TOKEN", testSystemManagerToken)
	setSystemDesiredState("")
	t.Cleanup(func() {
		setSystemDesiredState("")
	})
}

func containsString(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}
