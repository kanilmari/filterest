// event_bus.go
// In-memory table-scoped event pub/sub used for lightweight realtime notifications.
// Bridges backend CRUD mutation handlers and SSE subscribers through one process-local bus.
// Exists to decouple mutation code from transport details and keep publish semantics consistent.
package event_bus

import (
	"strings"
	"sync"
	"time"
)

// Event carries metadata about one row-level table mutation.
type Event struct {
	Table         string    `json:"table"`
	RowID         int64     `json:"row_id"`
	Action        string    `json:"action"`
	ChangedFields []string  `json:"changed_fields,omitempty"`
	Timestamp     time.Time `json:"timestamp"`
}

// EventBus is a simple in-process pub/sub store keyed by table name.
type EventBus struct {
	mu          sync.RWMutex
	subscribers map[string]map[int]chan Event
	nextID      int
}

// Bus is the process-wide default event bus instance.
var Bus = NewEventBus()

// NewEventBus creates an empty bus.
func NewEventBus() *EventBus {
	return &EventBus{
		subscribers: make(map[string]map[int]chan Event),
	}
}

// Subscribe registers one table subscriber and returns a read-only channel + unsubscribe function.
func (eb *EventBus) Subscribe(table string) (<-chan Event, func()) {
	trimmed := strings.TrimSpace(table)
	ch := make(chan Event, 32)
	if trimmed == "" {
		return ch, func() { close(ch) }
	}

	eb.mu.Lock()
	if eb.subscribers[trimmed] == nil {
		eb.subscribers[trimmed] = make(map[int]chan Event)
	}
	subID := eb.nextID
	eb.nextID++
	eb.subscribers[trimmed][subID] = ch
	eb.mu.Unlock()

	unsubOnce := sync.Once{}
	unsubscribe := func() {
		unsubOnce.Do(func() {
			eb.mu.Lock()
			tableSubs, ok := eb.subscribers[trimmed]
			if ok {
				delete(tableSubs, subID)
				if len(tableSubs) == 0 {
					delete(eb.subscribers, trimmed)
				}
			}
			eb.mu.Unlock()
			// Intentionally do not close subscriber channels here:
			// Publish may be concurrently iterating a snapshot, and closing would allow
			// send-on-closed-channel panics. Unsubscribing from the map is enough.
		})
	}
	return ch, unsubscribe
}

// Publish pushes an event to all subscribers of the given table.
// Slow subscribers are dropped non-blockingly to prevent head-of-line blocking.
func (eb *EventBus) Publish(table string, event Event) {
	trimmed := strings.TrimSpace(table)
	if trimmed == "" {
		return
	}

	eb.mu.RLock()
	tableSubs := eb.subscribers[trimmed]
	if len(tableSubs) == 0 {
		eb.mu.RUnlock()
		return
	}
	targets := make([]chan Event, 0, len(tableSubs))
	for _, ch := range tableSubs {
		targets = append(targets, ch)
	}
	eb.mu.RUnlock()

	event.Table = trimmed
	if event.Timestamp.IsZero() {
		event.Timestamp = time.Now().UTC()
	}
	for _, ch := range targets {
		select {
		case ch <- event:
		default:
			// Drop instead of blocking writer paths.
		}
	}
}
