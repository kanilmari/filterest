// system_drain_handler_test.go
// Verifies the privileged drain endpoint's authorization boundary.
// Bridges maintenance orchestration credentials with the HTTP manager route.
// Exists separately to keep the general health-handler contract focused.

package router

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSystemDrainHandlerRequiresDirectLoopbackAndManagerToken(t *testing.T) {
	resetSystemDesiredStateForTest(t)
	t.Setenv("EASELECT_SYSTEM_ENDPOINTS_ALLOW_PUBLIC", "true")

	tests := []struct {
		name       string
		remoteAddr string
		token      string
		forwarded  string
	}{
		{name: "missing token", remoteAddr: "127.0.0.1:41234"},
		{name: "wrong token", remoteAddr: "127.0.0.1:41234", token: "wrong-manager-token-that-is-long-enough"},
		{name: "token with trailing whitespace", remoteAddr: "127.0.0.1:41234", token: testSystemManagerToken + " "},
		{name: "public peer despite public override", remoteAddr: "198.51.100.20:41234", token: testSystemManagerToken},
		{name: "forwarded private peer", remoteAddr: "127.0.0.1:41234", token: testSystemManagerToken, forwarded: "10.10.0.5"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/system/drain", nil)
			request.RemoteAddr = test.remoteAddr
			if test.token != "" {
				request.Header.Set("Authorization", "Bearer "+test.token)
			}
			if test.forwarded != "" {
				request.Header.Set("X-Forwarded-For", test.forwarded)
			}
			recorder := httptest.NewRecorder()

			systemDrainHandler(recorder, request)

			if recorder.Code != http.StatusForbidden {
				t.Fatalf("systemDrainHandler status = %d, want %d", recorder.Code, http.StatusForbidden)
			}
			if got := currentSystemDesiredState(); got != systemDesiredStateActive {
				t.Fatalf("desired state = %q, want active", got)
			}
		})
	}
}

func TestSystemDrainHandlerRejectsTrailingJSONBeforeChangingState(t *testing.T) {
	resetSystemDesiredStateForTest(t)
	request := newSystemRequest(
		http.MethodPost,
		"/system/drain",
		`{"desired_state":"draining"}{"desired_state":"active"}`,
	)
	recorder := httptest.NewRecorder()

	systemDrainHandler(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("systemDrainHandler trailing JSON status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}
	if got := currentSystemDesiredState(); got != systemDesiredStateActive {
		t.Fatalf("desired state after trailing JSON = %q, want active", got)
	}
}

func TestSystemDrainStateReflectsEveryNonAcceptingDesiredState(t *testing.T) {
	resetSystemDesiredStateForTest(t)
	for _, desiredState := range []string{
		systemDesiredStateDraining,
		systemDesiredStateInactive,
		systemDesiredStateMaintenance,
	} {
		t.Run(desiredState, func(t *testing.T) {
			setSystemDesiredState(desiredState)
			if got := currentSystemDrainState(); got != "drained" {
				t.Fatalf("currentSystemDrainState() = %q, want drained", got)
			}
		})
	}
}
