// sse_handler_test.go
// Verifies the generic SSE subscription input boundary.
// Bridges dataset query parsing and process-internal event topics.
// Exists so browser callers cannot subscribe to lifecycle-manager wakeups.

package event_bus

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSSESubscribeHandlerRejectsReservedInternalTopic(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/sse/subscribe?datasets="+InternalUpdateNoticeTopic, nil)
	recorder := httptest.NewRecorder()

	SSESubscribeHandler(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", recorder.Code)
	}
}

func TestIsReservedInternalTopicMatchesOnlyExactTopic(t *testing.T) {
	if !IsReservedInternalTopic("  " + InternalUpdateNoticeTopic + "  ") {
		t.Fatal("exact internal topic should be reserved")
	}
	if IsReservedInternalTopic("system_users") {
		t.Fatal("ordinary dataset should not be reserved")
	}
}
