// sse_handler.go
// HTTP SSE endpoint for streaming table mutation metadata to authenticated browser clients.
// Bridges table subscriptions from query params and event-bus channels into text/event-stream frames.
// Exists to provide one reusable realtime endpoint that keeps payloads metadata-only for safety.
package event_bus

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/permissions"
	e_sessions "easelect/backend/core_components/sessions"
)

const sseDatasetReadPermissionRoute = "/api/get-results"

type sseDatasetAuthorizer func(*http.Request, string) (int, error)
type sseDatasetSubscriber func(string) (<-chan Event, func())
type sseEventAuthorizer func(*http.Request, Event) (bool, error)

// SSESubscribeHandler streams row_change events for subscribed datasets.
func SSESubscribeHandler(w http.ResponseWriter, r *http.Request) {
	serveSSESubscription(
		w,
		r,
		authorizeSSEDatasetSubscription,
		Bus.Subscribe,
		authorizeSSEEventRead,
	)
}

func serveSSESubscription(
	w http.ResponseWriter,
	r *http.Request,
	authorize sseDatasetAuthorizer,
	subscribe sseDatasetSubscriber,
	authorizeEvent sseEventAuthorizer,
) {
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
	for _, dataset := range datasets {
		if IsReservedInternalTopic(dataset) {
			http.Error(w, "reserved dataset subscription", http.StatusBadRequest)
			return
		}
	}
	for _, dataset := range datasets {
		status, err := authorize(r, dataset)
		if err != nil {
			log.Printf("\033[31m[SSESubscribeHandler] dataset authorization failed: %v\033[0m", err)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "dataset authorization failed")
			return
		}
		switch status {
		case 0:
		case http.StatusForbidden:
			httpresponse.RespondWithError(w, http.StatusForbidden, "forbidden")
			return
		case http.StatusNotFound:
			httpresponse.RespondWithError(w, http.StatusNotFound, "dataset not found")
			return
		default:
			log.Printf("\033[31m[SSESubscribeHandler] dataset authorizer returned invalid status %d\033[0m", status)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "dataset authorization failed")
			return
		}
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	eventStream := make(chan Event, 64)
	done := r.Context().Done()
	unsubscribers := make([]func(), 0, len(datasets))

	for _, dataset := range datasets {
		subCh, unsubscribe := subscribe(dataset)
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
					if !shouldForwardSSEEvent(r, event, authorizeEvent) {
						continue
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

// shouldForwardSSEEvent fails closed between a process-internal dataset event
// and the browser stream. Dataset-level subscription approval is necessary,
// but an exact-row deny must still suppress row identity and change metadata.
func shouldForwardSSEEvent(r *http.Request, event Event, authorize sseEventAuthorizer) bool {
	if authorize == nil {
		return false
	}
	allowed, err := authorize(r, event)
	if err != nil {
		log.Printf("\033[31m[SSESubscribeHandler] row event authorization failed: %v\033[0m", err)
		return false
	}
	return allowed
}

func authorizeSSEEventRead(r *http.Request, event Event) (bool, error) {
	actor := dbutils.RequestActorContextFromRequest(r)
	if actor.IsAdmin {
		return true, nil
	}
	if event.RowID <= 0 || strings.TrimSpace(event.Table) == "" {
		return false, nil
	}
	roleDB := backend.GetRequestDBForRole(actor.UserRole)
	if roleDB == nil {
		return false, fmt.Errorf("database is not initialized")
	}

	// The dataset subscription check already proves the broader table-level
	// read grant. This resolver adds the exact-row user/group deny-wins layer.
	var allowed bool
	err := roleDB.QueryRowContext(
		r.Context(),
		`SELECT public.resolve_effective_row_access($1, $2, $3, 'read', TRUE, FALSE)`,
		event.Table,
		event.RowID,
		actor.UserID,
	).Scan(&allowed)
	if err != nil {
		return false, fmt.Errorf("row event read permission check: %w", err)
	}
	return allowed, nil
}

func authorizeSSEDatasetSubscription(r *http.Request, dataset string) (int, error) {
	userID, err := e_sessions.GetUserIDFromSession(r)
	if err != nil {
		return http.StatusForbidden, nil
	}
	if !backend.ShouldExposeCloudManagementDatasetName(dataset) {
		return http.StatusNotFound, nil
	}
	if backend.Db == nil {
		return 0, fmt.Errorf("database is not initialized")
	}

	var exists bool
	if err := backend.Db.QueryRow(
		"SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1)",
		dataset,
	).Scan(&exists); err != nil {
		return 0, fmt.Errorf("dataset existence check: %w", err)
	}
	if !exists {
		return http.StatusNotFound, nil
	}

	allowed, err := permissions.CheckRouteTablePermission(
		backend.Db,
		sseDatasetReadPermissionRoute,
		userID,
		permissions.RouteTableScope{TableName: dataset},
		permissions.AccessControlRouteTableOptions(false),
	)
	if err != nil {
		return 0, fmt.Errorf("dataset read permission check: %w", err)
	}
	if !allowed {
		return http.StatusForbidden, nil
	}
	return 0, nil
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
