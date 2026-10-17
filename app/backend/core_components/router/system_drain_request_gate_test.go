// system_drain_request_gate_test.go
// Verifies draining, admitted requests and passive event-stream cancellation.
// Connects the router's drain handlers and request gates to in-process callers.
// Keeps drain transitions and request accounting covered without external services.

package router

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

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
