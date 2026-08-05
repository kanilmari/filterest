// sse_handler.go
// HTTP SSE endpoint for streaming table mutation metadata to authenticated browser clients.
// Bridges table subscriptions from query params and event-bus channels into text/event-stream frames.
// Exists to provide one reusable realtime endpoint that keeps payloads metadata-only for safety.
package event_bus

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// SSESubscribeHandler streams row_change events for subscribed datasets.
func SSESubscribeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	datasets := parseDatasetList(r.URL.Query().Get("datasets"))
	if len(datasets) == 0 {
		http.Error(w, "missing datasets query parameter", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	eventStream := make(chan Event, 64)
	done := r.Context().Done()
	unsubscribers := make([]func(), 0, len(datasets))

	for _, dataset := range datasets {
		subCh, unsubscribe := Bus.Subscribe(dataset)
		unsubscribers = append(unsubscribers, unsubscribe)
		go func(source <-chan Event) {
			for {
				select {
				case <-done:
					return
				case event, open := <-source:
					if !open {
						return
					}
					select {
					case eventStream <- event:
					default:
					}
				}
			}
		}(subCh)
	}

	defer func() {
		for _, unsubscribe := range unsubscribers {
			unsubscribe()
		}
	}()

	fmt.Fprint(w, ": connected\n\n")
	flusher.Flush()

	keepaliveTicker := time.NewTicker(15 * time.Second)
	defer keepaliveTicker.Stop()

	for {
		select {
		case <-done:
			return
		case <-keepaliveTicker.C:
			fmt.Fprint(w, ": keepalive\n\n")
			flusher.Flush()
		case event := <-eventStream:
			payload, err := json.Marshal(event)
			if err != nil {
				continue
			}
			fmt.Fprintf(w, "event: row_change\ndata: %s\n\n", payload)
			flusher.Flush()
		}
	}
}

func parseDatasetList(raw string) []string {
	parts := strings.Split(raw, ",")
	seen := make(map[string]struct{}, len(parts))
	tables := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed == "" {
			continue
		}
		if _, exists := seen[trimmed]; exists {
			continue
		}
		seen[trimmed] = struct{}{}
		tables = append(tables, trimmed)
	}
	return tables
}
