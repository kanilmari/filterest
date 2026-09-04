// sse_handler_test.go
// Verifies the generic SSE subscription input boundary.
// Bridges dataset query parsing and process-internal event topics.
// Exists so browser callers cannot subscribe to lifecycle-manager wakeups.

package event_bus

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestShouldForwardSSEEventFailsClosedPerRow(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/sse/subscribe?datasets=orders", nil)
	allowedEvent := Event{Table: "orders", RowID: 7, Action: "update"}
	deniedEvent := Event{Table: "orders", RowID: 8, Action: "update"}

	if shouldForwardSSEEvent(request, allowedEvent, nil) {
		t.Fatal("missing row event authorizer must fail closed")
	}
	authorize := func(_ *http.Request, event Event) (bool, error) {
		return event.RowID == 7, nil
	}
	if !shouldForwardSSEEvent(request, allowedEvent, authorize) {
		t.Fatal("authorized row event should be forwarded")
	}
	if shouldForwardSSEEvent(request, deniedEvent, authorize) {
		t.Fatal("denied row event must not be forwarded")
	}
	if shouldForwardSSEEvent(
		request,
		allowedEvent,
		func(*http.Request, Event) (bool, error) {
			return false, errors.New("permission backend unavailable")
		},
	) {
		t.Fatal("row event authorization errors must fail closed")
	}
}

func TestSSESubscribeHandlerRejectsReservedInternalTopic(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/sse/subscribe?datasets="+InternalUpdateNoticeTopic, nil)
	recorder := httptest.NewRecorder()

	SSESubscribeHandler(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", recorder.Code)
	}
}

func TestSSESubscribeHandlerRejectsMixedAllowedAndForbiddenBeforeSubscribing(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/sse/subscribe?datasets=allowed,forbidden", nil)
	recorder := httptest.NewRecorder()
	subscribeCalls := 0

	serveSSESubscription(
		recorder,
		request,
		func(_ *http.Request, dataset string) (int, error) {
			if dataset == "forbidden" {
				return http.StatusForbidden, nil
			}
			return 0, nil
		},
		func(string) (<-chan Event, func()) {
			subscribeCalls++
			return make(chan Event), func() {}
		},
		nil,
	)

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", recorder.Code)
	}
	if subscribeCalls != 0 {
		t.Fatalf("subscribe calls = %d, want 0", subscribeCalls)
	}
}

func TestSSESubscribeHandlerRejectsMissingDatasetBeforeSubscribing(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/sse/subscribe?datasets=allowed,missing", nil)
	recorder := httptest.NewRecorder()
	subscribeCalls := 0

	serveSSESubscription(
		recorder,
		request,
		func(_ *http.Request, dataset string) (int, error) {
			if dataset == "missing" {
				return http.StatusNotFound, nil
			}
			return 0, nil
		},
		func(string) (<-chan Event, func()) {
			subscribeCalls++
			return make(chan Event), func() {}
		},
		nil,
	)

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", recorder.Code)
	}
	if subscribeCalls != 0 {
		t.Fatalf("subscribe calls = %d, want 0", subscribeCalls)
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
