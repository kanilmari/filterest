// event_bus_test.go
// Unit tests for process-local table-scoped event bus behavior.
// Bridges event publication and subscription lifecycle expectations with deterministic assertions.
// Exists to keep realtime mutation fan-out predictable as SSE usage expands.
package event_bus

import (
	"sync"
	"testing"
	"time"
)

func TestEventBusPublishDeliversToMatchingTableSubscribers(t *testing.T) {
	bus := NewEventBus()
	devTasksCh, unsubDevTasks := bus.Subscribe("dev_agent_tasks")
	defer unsubDevTasks()
	otherCh, unsubOther := bus.Subscribe("system_users")
	defer unsubOther()

	bus.Publish("dev_agent_tasks", Event{
		RowID:  42,
		Action: "update",
	})

	select {
	case event := <-devTasksCh:
		if event.Table != "dev_agent_tasks" {
			t.Fatalf("event.Table = %q, want dev_agent_tasks", event.Table)
		}
		if event.RowID != 42 {
			t.Fatalf("event.RowID = %d, want 42", event.RowID)
		}
		if event.Action != "update" {
			t.Fatalf("event.Action = %q, want update", event.Action)
		}
		if event.Timestamp.IsZero() {
			t.Fatal("event.Timestamp is zero, want populated timestamp")
		}
	case <-time.After(1 * time.Second):
		t.Fatal("timed out waiting for matching table event")
	}

	select {
	case event := <-otherCh:
		t.Fatalf("unexpected event for non-matching table: %#v", event)
	case <-time.After(100 * time.Millisecond):
	}
}

func TestEventBusUnsubscribeStopsDelivery(t *testing.T) {
	bus := NewEventBus()
	ch, unsubscribe := bus.Subscribe("dev_agent_tasks")
	unsubscribe()

	bus.Publish("dev_agent_tasks", Event{RowID: 1, Action: "delete"})

	select {
	case event := <-ch:
		t.Fatalf("unexpected event after unsubscribe: %#v", event)
	case <-time.After(100 * time.Millisecond):
	}
}

func TestEventBusPublishDuringConcurrentUnsubscribeDoesNotPanic(t *testing.T) {
	bus := NewEventBus()
	const subscriptionCount = 120
	const publishesPerWorker = 200

	unsubscribers := make([]func(), 0, subscriptionCount)
	for i := 0; i < subscriptionCount; i++ {
		_, unsubscribe := bus.Subscribe("dev_agent_tasks")
		unsubscribers = append(unsubscribers, unsubscribe)
	}

	var wg sync.WaitGroup
	for _, unsubscribe := range unsubscribers {
		unsub := unsubscribe
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < publishesPerWorker; i++ {
				bus.Publish("dev_agent_tasks", Event{
					RowID:  int64(i),
					Action: "update",
				})
			}
			unsub()
		}()
	}
	wg.Wait()
}

func TestParseDatasetListTrimsAndDeduplicates(t *testing.T) {
	got := parseDatasetList(" dev_agent_tasks,system_users,dev_agent_tasks ,, ")
	if len(got) != 2 {
		t.Fatalf("len(parseDatasetList) = %d, want 2", len(got))
	}
	if got[0] != "dev_agent_tasks" || got[1] != "system_users" {
		t.Fatalf("parseDatasetList = %#v, want [dev_agent_tasks system_users]", got)
	}
}
