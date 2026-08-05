// with_audit.go
// Pipeline stage that records semantic audit events: who did what to which table and when.
// Bridges the handler response (status, duration) and the audit log table via async batch inserts.
// Exists to complement request_logging and transaction_log with business-level audit trails.
// The stage enqueues events after next returns so audit rows reflect the final outcome.
// Inserts are buffered and flushed in batches (up to 64 events or every 500 ms).
// This keeps audit I/O off the request path while preserving request-final status and duration.
package audit

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/logging"
	e_sessions "easelect/backend/core_components/sessions"
)

// ──────────────────────────────────────────────────────────
// Audit event
// ──────────────────────────────────────────────────────────

// AuditEvent represents a single audit entry to be persisted.
type AuditEvent struct {
	CreatedAt     time.Time
	UserID        *int
	Username      string
	HandlerName   string
	HTTPMethod    string
	URLPath       string
	TableName     string // empty = NULL
	OperationType string // read, create, update, delete, admin, auth, other
	Success       bool
	IPAddress     string
	DurationMS    int
}

// ──────────────────────────────────────────────────────────
// Async batch inserter (singleton)
// ──────────────────────────────────────────────────────────

const (
	channelBufferSize = 4096
	batchSize         = 64
	flushInterval     = 500 * time.Millisecond
)

var (
	eventChan chan AuditEvent
	startOnce sync.Once
)

// ensureInserterRunning starts the background goroutine (once).
func ensureInserterRunning() {
	startOnce.Do(func() {
		eventChan = make(chan AuditEvent, channelBufferSize)
		go batchInserter()
	})
}

// enqueue sends an event to the background inserter.
// If the channel is full (back-pressure), the event is dropped with a warning.
func enqueue(ev AuditEvent) {
	ensureInserterRunning()
	select {
	case eventChan <- ev:
	default:
		logging.WarnAttrs(
			"audit channel full; dropping event",
			slog.String("handler", ev.HandlerName),
			slog.String("method", ev.HTTPMethod),
			slog.String("path", ev.URLPath),
		)
	}
}

// batchInserter runs forever, draining the channel and inserting in batches.
func batchInserter() {
	batch := make([]AuditEvent, 0, batchSize)
	ticker := time.NewTicker(flushInterval)
	defer ticker.Stop()

	for {
		select {
		case ev := <-eventChan:
			batch = append(batch, ev)
			if len(batch) >= batchSize {
				flushBatch(batch)
				batch = batch[:0]
			}
		case <-ticker.C:
			if len(batch) > 0 {
				flushBatch(batch)
				batch = batch[:0]
			}
		}
	}
}

// flushBatch performs a single multi-row INSERT for all events in the batch.
func flushBatch(batch []AuditEvent) {
	db := backend.Db
	if db == nil {
		return
	}

	// Build multi-value INSERT
	// Each row has 11 columns ($1..$11 per row)
	const colsPerRow = 11
	valueStrings := make([]string, 0, len(batch))
	args := make([]interface{}, 0, len(batch)*colsPerRow)

	for i, ev := range batch {
		base := i * colsPerRow
		valueStrings = append(valueStrings, fmt.Sprintf(
			"($%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d)",
			base+1, base+2, base+3, base+4, base+5,
			base+6, base+7, base+8, base+9, base+10, base+11,
		))

		var userID interface{} = nil
		if ev.UserID != nil {
			userID = *ev.UserID
		}
		var tableName interface{} = nil
		if ev.TableName != "" {
			tableName = ev.TableName
		}
		var opType interface{} = nil
		if ev.OperationType != "" {
			opType = ev.OperationType
		}
		var ipAddr interface{} = nil
		if ev.IPAddress != "" {
			ipAddr = ev.IPAddress
		}
		var username interface{} = nil
		if ev.Username != "" {
			username = ev.Username
		}

		args = append(args,
			ev.CreatedAt,   // 1
			userID,         // 2
			username,       // 3
			ev.HandlerName, // 4
			ev.HTTPMethod,  // 5
			ev.URLPath,     // 6
			tableName,      // 7
			opType,         // 8
			ev.Success,     // 9
			ipAddr,         // 10
			ev.DurationMS,  // 11
		)
	}

	query := `INSERT INTO system_audit_log
		(created_at, user_id, username, handler_name, http_method, url_path,
		 table_name, operation_type, success, ip_address, duration_ms)
		VALUES ` + strings.Join(valueStrings, ",")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if _, err := db.ExecContext(ctx, query, args...); err != nil {
		logging.ErrorAttrs(
			"audit batch insert failed",
			slog.Int("batch_size", len(batch)),
			slog.String("error", err.Error()),
		)
	}
}

// ──────────────────────────────────────────────────────────
// Operation type inference
// ──────────────────────────────────────────────────────────

// InferOperationType derives a semantic operation type from the handler name.
func InferOperationType(handlerName string) string {
	h := strings.ToLower(handlerName)

	switch {
	// Row-level CRUD
	case strings.Contains(h, "row_create") || strings.Contains(h, "addrow"):
		return "create"
	case strings.Contains(h, "row_read") || strings.Contains(h, "getresults") ||
		strings.Contains(h, "getrowcount") || strings.Contains(h, "getdynamicchild") ||
		strings.Contains(h, "gettableview") || strings.Contains(h, "gettablecolumns") ||
		strings.Contains(h, "getintelligentresults"):
		return "read"
	case strings.Contains(h, "row_update") || strings.Contains(h, "updaterow"):
		return "update"
	case strings.Contains(h, "row_delete") || strings.Contains(h, "deleterows"):
		return "delete"

	// Auth operations
	case strings.Contains(h, "auth.") ||
		strings.Contains(h, "login") || strings.Contains(h, "logout") ||
		strings.Contains(h, "register") || strings.Contains(h, "session") ||
		strings.Contains(h, "fingerprint") || strings.Contains(h, "userpermissions"):
		return "auth"

	// Admin / schema operations
	case strings.Contains(h, "admin") ||
		strings.Contains(h, "createtable") || strings.Contains(h, "droptable") ||
		strings.Contains(h, "modifycolumns") || strings.Contains(h, "createindex") ||
		strings.Contains(h, "setcomments") || strings.Contains(h, "trigger") ||
		strings.Contains(h, "saveusergroup") ||
		strings.Contains(h, "foreignkey") ||
		strings.Contains(h, "consistency") || strings.Contains(h, "mediasubfolder") ||
		strings.Contains(h, "empty_rows") || strings.Contains(h, "emptyrows"):
		return "admin"

	// Translations / language
	case strings.Contains(h, "lang.") || strings.Contains(h, "translation"):
		return "read" // translations are reads unless explicitly modifying

	// Search / embeddings
	case strings.Contains(h, "embedding") || strings.Contains(h, "searchvector") ||
		strings.Contains(h, "openai") || strings.Contains(h, "textindex"):
		return "read"

	default:
		return "other"
	}
}

var lowSignalSuccessfulAuditHandlers = map[string]struct{}{
	"auth.CheckFingerprintHandler":        {},
	"auth.CheckTableRightHandler":         {},
	"auth.GetAuthModesHandler":            {},
	"devtools.SessionHandler":             {},
	"lang.GetTranslationsHandler":         {},
	"router.datasetsRedirectHandler":      {},
	"router.faviconHandler":               {},
	"router.handleApps":                   {},
	"router.handleFrontend":               {},
	"router.robotsHandler":                {},
	"router.rootHandler":                  {},
	"router.ServeStorage":                 {},
	"router.sitemapHandler":               {},
	"system_table_tools.GetGroupedTables": {},
}

// RegisterLowSignalSuccessfulAuditHandler adds an optional success-read audit skip.
// Between: private app activation packages -> audit filtering stage.
// Why: Public Filterest builds can omit private app handler names from core code.
func RegisterLowSignalSuccessfulAuditHandler(handlerName string) {
	if handlerName == "" {
		panic("low-signal audit handler name cannot be empty")
	}

	lowSignalSuccessfulAuditHandlers[handlerName] = struct{}{}
}

// shouldEnqueueAuditEvent keeps failed, mutating, and admin-visible events while
// dropping known high-volume, low-signal success paths such as public shell and
// startup/read introspection routes.
func shouldEnqueueAuditEvent(handlerName, operationType, method string, statusCode int) bool {
	success := statusCode >= 200 && statusCode < 400
	if !success {
		return true
	}

	switch method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
	default:
		return true
	}

	switch operationType {
	case "create", "update", "delete", "admin":
		return true
	}

	_, skip := lowSignalSuccessfulAuditHandlers[handlerName]
	return !skip
}

// ──────────────────────────────────────────────────────────
// Table name extraction
// ──────────────────────────────────────────────────────────

// extractTableName tries to determine the target table from URL query params.
func extractTableName(r *http.Request) string {
	// Most common patterns
	if t := r.URL.Query().Get("dataset"); t != "" {
		return t
	}
	if t := r.URL.Query().Get("table"); t != "" {
		return t
	}
	if t := r.URL.Query().Get("dataset_name"); t != "" {
		return t
	}
	return ""
}

// ──────────────────────────────────────────────────────────
// IP address extraction
// ──────────────────────────────────────────────────────────

// extractIP returns the client IP address from the request.
func extractIP(r *http.Request) string {
	// Check common proxy headers first
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		// Take the first (client) IP
		if idx := strings.Index(xff, ","); idx > 0 {
			return strings.TrimSpace(xff[:idx])
		}
		return strings.TrimSpace(xff)
	}
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return strings.TrimSpace(xri)
	}

	// Fall back to RemoteAddr (host:port)
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// ──────────────────────────────────────────────────────────
// statusCapture — wraps ResponseWriter to capture status code
// ──────────────────────────────────────────────────────────

type statusCapture struct {
	http.ResponseWriter
	code    int
	written bool
}

func (sc *statusCapture) WriteHeader(code int) {
	if !sc.written {
		sc.code = code
		sc.written = true
	}
	sc.ResponseWriter.WriteHeader(code)
}

func (sc *statusCapture) Write(b []byte) (int, error) {
	if !sc.written {
		sc.code = http.StatusOK
		sc.written = true
	}
	return sc.ResponseWriter.Write(b)
}

// Flush implements http.Flusher by delegating to the underlying ResponseWriter.
// This is required for streaming endpoints (e.g. NDJSON) that call w.(http.Flusher).
func (sc *statusCapture) Flush() {
	if f, ok := sc.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Unwrap supports http.Flusher and other interfaces via ResponseController.
func (sc *statusCapture) Unwrap() http.ResponseWriter {
	return sc.ResponseWriter
}

// ──────────────────────────────────────────────────────────
// Pipeline middleware
// ──────────────────────────────────────────────────────────

// WithAudit is the pipeline stage function.
// It wraps the handler, calls it, then enqueues an audit event asynchronously.
// handlerName is injected from RouteContext at pipeline build time.
func WithAudit(handlerName string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		// Wrap writer to capture status code
		capture := &statusCapture{ResponseWriter: w, code: http.StatusOK}

		// Call the actual handler
		next(capture, r)

		// Build audit event (non-blocking — runs after handler returns)
		duration := time.Since(start)
		operationType := InferOperationType(handlerName)
		if !shouldEnqueueAuditEvent(handlerName, operationType, r.Method, capture.code) {
			return
		}

		// Extract user info from session (best-effort, no error = anonymous)
		var userID *int
		var username string
		session, err := e_sessions.GetOrCreateSession(w, r)
		if err == nil && session != nil {
			if uid, ok := session.Values["user_id"].(int); ok {
				userID = &uid
				// Best-effort username lookup (single cached row)
				if uname, ok2 := session.Values["username"].(string); ok2 {
					username = uname
				}
			}
		}

		ev := AuditEvent{
			CreatedAt:     start,
			UserID:        userID,
			Username:      username,
			HandlerName:   handlerName,
			HTTPMethod:    r.Method,
			URLPath:       r.URL.Path,
			TableName:     extractTableName(r),
			OperationType: operationType,
			Success:       capture.code >= 200 && capture.code < 400,
			IPAddress:     extractIP(r),
			DurationMS:    int(duration.Milliseconds()),
		}

		enqueue(ev)
	}
}
