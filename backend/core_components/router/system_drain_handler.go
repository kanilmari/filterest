// system_drain_handler.go
// Gates API admission and exposes the manager-controlled application drain state.
// Bridges loopback lifecycle commands with in-flight browser and API requests.
// Exists to prevent late saves from racing a coherent maintenance cutover.

package router

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"easelect/backend/core_components/httpresponse"
)

var (
	systemActiveAPIRequests        int64
	systemDrainTransitionMutex     sync.RWMutex
	systemDesiredStateRuntimeValue atomic.Value
	systemSSERequestSequence       uint64
	systemSSERequestCancels        = make(map[uint64]context.CancelFunc)
)

const (
	systemDesiredStateActive      = "active"
	systemDesiredStateStandby     = "standby"
	systemDesiredStateDraining    = "draining"
	systemDesiredStateInactive    = "inactive"
	systemDesiredStateMaintenance = "maintenance"
)

type systemDrainRequest struct {
	DesiredState string `json:"desired_state"`
	Draining     *bool  `json:"draining,omitempty"`
}

type systemDrainResponse struct {
	DesiredStateSeenByApp string `json:"desired_state_seen_by_app"`
	AcceptingNewWork      bool   `json:"accepting_new_work"`
	ActiveRequests        int    `json:"active_requests"`
	DrainSupported        bool   `json:"drain_supported"`
	DrainState            string `json:"drain_state"`
	APIDrainSupported     bool   `json:"api_drain_supported"`
	AcceptingAPIRequests  bool   `json:"accepting_api_requests"`
	ActiveAPIRequests     int    `json:"active_api_requests"`
	Time                  string `json:"time"`
}

// WithSystemAPIDrainGate atomically admits API work against drain transitions.
// It bridges the operator-only drain state and browser/API callers so requests
// admitted before a drain finish normally while later API calls fail closed.
func WithSystemAPIDrainGate(next http.Handler) http.Handler {
	if next == nil {
		next = http.NotFoundHandler()
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !isSystemDrainProtectedAPIRequest(r) {
			next.ServeHTTP(w, r)
			return
		}

		acceptingAPIRequests, requestWithDrainContext, cleanup := admitSystemAPIRequest(r)

		if !acceptingAPIRequests {
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("Retry-After", "5")
			w.Header().Set("X-Filterest-Drain-State", currentSystemDrainState())
			httpresponse.RespondWithError(w, http.StatusServiceUnavailable, "Application update is in progress; save again after the service returns")
			return
		}

		defer cleanup()
		next.ServeHTTP(w, requestWithDrainContext)
	})
}

// admitSystemAPIRequest registers finite API work and cancellable passive SSE
// under the same lock used by the drain transition. That makes admission and
// cancellation one atomic lifecycle boundary instead of a timing convention.
func admitSystemAPIRequest(r *http.Request) (bool, *http.Request, func()) {
	if isSystemDrainCancelableSSERequest(r) {
		systemDrainTransitionMutex.Lock()
		defer systemDrainTransitionMutex.Unlock()

		if !systemDesiredStateAcceptsNewWork(currentSystemDesiredState()) {
			return false, r, func() {}
		}

		requestContext, cancelRequest := context.WithCancel(r.Context())
		requestID := atomic.AddUint64(&systemSSERequestSequence, 1)
		systemSSERequestCancels[requestID] = cancelRequest
		atomic.AddInt64(&systemActiveAPIRequests, 1)
		return true, r.WithContext(requestContext), func() {
			cancelRequest()
			systemDrainTransitionMutex.Lock()
			delete(systemSSERequestCancels, requestID)
			systemDrainTransitionMutex.Unlock()
			atomic.AddInt64(&systemActiveAPIRequests, -1)
		}
	}

	systemDrainTransitionMutex.RLock()
	acceptingAPIRequests := systemDesiredStateAcceptsNewWork(currentSystemDesiredState())
	if acceptingAPIRequests {
		atomic.AddInt64(&systemActiveAPIRequests, 1)
	}
	systemDrainTransitionMutex.RUnlock()
	if !acceptingAPIRequests {
		return false, r, func() {}
	}
	return true, r, func() {
		atomic.AddInt64(&systemActiveAPIRequests, -1)
	}
}

// systemDrainHandler lets an authenticated exact host peer change drain state.
func systemDrainHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	if rejectDisallowedSystemDrainManagerRequest(w, r) {
		return
	}

	desiredState := systemDesiredStateDraining
	if r.Body != nil && r.Body != http.NoBody {
		decodedRequest := systemDrainRequest{}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&decodedRequest); err != nil && !errors.Is(err, io.EOF) {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "Invalid drain request")
			return
		}
		if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "Invalid drain request")
			return
		}

		if strings.TrimSpace(decodedRequest.DesiredState) != "" {
			desiredState = decodedRequest.DesiredState
		} else if decodedRequest.Draining != nil && !*decodedRequest.Draining {
			desiredState = systemDesiredStateActive
		}
	}

	normalizedState, ok := normalizeSystemDesiredState(desiredState)
	if !ok {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "Invalid desired_state")
		return
	}
	setSystemDesiredState(normalizedState)
	httpresponse.RespondWithJSON(w, http.StatusOK, buildSystemDrainResponse(time.Now().UTC()))
}

func isSystemDrainProtectedAPIRequest(r *http.Request) bool {
	return r != nil && r.URL != nil && strings.HasPrefix(r.URL.Path, "/api/")
}

func isSystemDrainCancelableSSERequest(r *http.Request) bool {
	if r == nil || r.URL == nil || r.Method != http.MethodGet {
		return false
	}
	return r.URL.Path == "/api/sse/subscribe" || r.URL.Path == "/api/admin/update-notice/stream"
}

func currentSystemActiveAPIRequests() int {
	active := atomic.LoadInt64(&systemActiveAPIRequests)
	if active < 0 {
		return 0
	}
	return int(active)
}

func currentSystemDesiredState() string {
	if runtimeState, ok := systemDesiredStateRuntimeValue.Load().(string); ok {
		if normalizedState, valid := normalizeSystemDesiredState(runtimeState); valid {
			return normalizedState
		}
	}
	if desiredState := strings.TrimSpace(os.Getenv("EASELECT_DESIRED_STATE")); desiredState != "" {
		if normalizedState, valid := normalizeSystemDesiredState(desiredState); valid {
			return normalizedState
		}
	}
	return systemDesiredStateActive
}

// currentSystemDrainState maps the app desired state into the manager contract.
func currentSystemDrainState() string {
	desiredState := currentSystemDesiredState()
	if systemDesiredStateAcceptsNewWork(desiredState) {
		return systemDesiredStateActive
	}
	if currentSystemActiveAPIRequests() == 0 {
		return "drained"
	}
	return systemDesiredStateDraining
}

// setSystemDesiredState stores the runtime app-side desired state for probes.
func setSystemDesiredState(desiredState string) {
	systemDrainTransitionMutex.Lock()
	defer systemDrainTransitionMutex.Unlock()
	setSystemDesiredStateWithoutLock(desiredState)
	if !systemDesiredStateAcceptsNewWork(currentSystemDesiredState()) {
		for _, cancelRequest := range systemSSERequestCancels {
			cancelRequest()
		}
	}
}

func setSystemDesiredStateWithoutLock(desiredState string) {
	systemDesiredStateRuntimeValue.Store(desiredState)
}

// normalizeSystemDesiredState keeps manager state strings stable and bounded.
func normalizeSystemDesiredState(desiredState string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(desiredState)) {
	case systemDesiredStateActive:
		return systemDesiredStateActive, true
	case systemDesiredStateStandby:
		return systemDesiredStateStandby, true
	case systemDesiredStateDraining:
		return systemDesiredStateDraining, true
	case systemDesiredStateInactive:
		return systemDesiredStateInactive, true
	case systemDesiredStateMaintenance:
		return systemDesiredStateMaintenance, true
	default:
		return "", false
	}
}

// systemDesiredStateAcceptsNewWork decides whether readiness may stay true.
func systemDesiredStateAcceptsNewWork(desiredState string) bool {
	switch desiredState {
	case systemDesiredStateDraining, systemDesiredStateInactive, systemDesiredStateMaintenance:
		return false
	default:
		return true
	}
}

// systemNotReadyReasonForDesiredState converts manager state into probe reasons.
func systemNotReadyReasonForDesiredState(desiredState string) string {
	switch desiredState {
	case systemDesiredStateDraining:
		return "draining"
	case systemDesiredStateInactive:
		return "instance_inactive"
	case systemDesiredStateMaintenance:
		return "maintenance"
	default:
		return "not_accepting_new_work"
	}
}

// buildSystemDrainResponse returns the drain command result snapshot.
func buildSystemDrainResponse(now time.Time) systemDrainResponse {
	desiredState := currentSystemDesiredState()
	return systemDrainResponse{
		DesiredStateSeenByApp: desiredState,
		AcceptingNewWork:      systemDesiredStateAcceptsNewWork(desiredState),
		ActiveRequests:        currentSystemActiveRequests(),
		DrainSupported:        true,
		DrainState:            currentSystemDrainState(),
		APIDrainSupported:     true,
		AcceptingAPIRequests:  systemDesiredStateAcceptsNewWork(desiredState),
		ActiveAPIRequests:     currentSystemActiveAPIRequests(),
		Time:                  now.Format(time.RFC3339),
	}
}

// rejectDisallowedSystemDrainManagerRequest gives the state-changing drain
// endpoint a narrower boundary than read-only system probes. Public overrides,
// private forwarded clients, and unauthenticated host-local callers all fail.
func rejectDisallowedSystemDrainManagerRequest(w http.ResponseWriter, r *http.Request) bool {
	if systemDrainManagerRequestAllowed(r) {
		return false
	}
	httpresponse.RespondWithError(w, http.StatusForbidden, "System drain control is not authorized")
	return true
}

func systemDrainManagerRequestAllowed(r *http.Request) bool {
	if r == nil || systemRequestHasForwardingHeaders(r) {
		return false
	}

	remoteHost := strings.TrimSpace(r.RemoteAddr)
	if host, _, err := net.SplitHostPort(remoteHost); err == nil {
		remoteHost = host
	}
	remoteIP := net.ParseIP(remoteHost)
	if !systemDrainManagerPeerAllowed(remoteIP) {
		return false
	}

	expectedToken := os.Getenv("EASELECT_SYSTEM_MANAGER_TOKEN")
	if len(expectedToken) < 32 || expectedToken != strings.TrimSpace(expectedToken) {
		return false
	}
	authorizationValues := r.Header.Values("Authorization")
	if len(authorizationValues) != 1 {
		return false
	}
	authorization := authorizationValues[0]
	const bearerPrefix = "Bearer "
	if !strings.HasPrefix(authorization, bearerPrefix) {
		return false
	}
	providedToken := strings.TrimPrefix(authorization, bearerPrefix)
	if providedToken != strings.TrimSpace(providedToken) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(providedToken), []byte(expectedToken)) == 1
}

// systemDrainManagerPeerAllowed accepts loopback or one explicit Docker-host
// gateway. A literal private IP keeps host-published ports usable without
// broadening state-changing control to an entire private network.
func systemDrainManagerPeerAllowed(remoteIP net.IP) bool {
	if remoteIP == nil {
		return false
	}
	if remoteIP.IsLoopback() {
		return true
	}
	configuredPeer := os.Getenv("EASELECT_SYSTEM_MANAGER_TRUSTED_PEER_IP")
	if configuredPeer == "" || configuredPeer != strings.TrimSpace(configuredPeer) {
		return false
	}
	trustedPeer := net.ParseIP(configuredPeer)
	return trustedPeer != nil && trustedPeer.IsPrivate() && remoteIP.Equal(trustedPeer)
}

func systemRequestHasForwardingHeaders(r *http.Request) bool {
	for _, headerName := range []string{"Forwarded", "X-Forwarded-For", "X-Real-IP", "X-Client-IP"} {
		if len(r.Header.Values(headerName)) > 0 {
			return true
		}
	}
	return false
}
