// with_transaction.go
// Middleware that provides lazy request transactions to HTTP handlers.
// Bridges role-specific database pools, request actor context, and commit/rollback logging.
// Exists to give write paths transactional safety without reserving a connection until needed.
package middlewares

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/logging"
	"easelect/backend/core_components/runtime_grants"
	"easelect/backend/pipeline/txlog"
)

// errResponseAlreadyForwarded refuses a request transaction after a stream or an
// explicit flush has already sent output that a failed commit could not replace.
var errResponseAlreadyForwarded = errors.New("request transaction unavailable: the response was already forwarded; write through the pool and check that commit instead")

// WithLazyTransaction wraps an http.Handler with a lazy transaction provider.
// No database connection is reserved until the handler calls dbutils.RequireTx(ctx)
// or dbutils.GetTx(ctx). If a transaction was opened, only a final 2xx or 3xx
// response commits it; 4xx, 5xx, other non-success statuses, panics and a
// cancelled request (the client left) roll it back. If no transaction was
// needed, no connection is used. Finite write responses remain private until
// commit; a release failure after the commit keeps the committed outcome.
// Safe methods, and streams or explicit flushes while no transaction is open,
// retain forwarding. See docs/instructions_and_documentation/Commit_Confirmed_Responses.md.
func WithLazyTransaction(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		actor := dbutils.RequestActorContextFromRequest(r)
		requestDB := backend.GetRequestDBForRequest(actor.UserRole, r)
		if requestDB == nil {
			next.ServeHTTP(w, r)
			return
		}

		// RequireTx passes the request context to BeginTx, so a cancelled
		// administrator request cannot wait indefinitely for a work-pool slot.
		lt := dbutils.NewLazyTxWithBeginHook(requestDB, func(tx *sql.Tx) error {
			if err := runtime_grants.LockRuntimeRequestBarrier(r.Context(), tx); err != nil {
				return err
			}
			return dbutils.ApplyRequestActorToTx(tx, actor)
		})

		lt.SetAdmissionHook(func(ctx context.Context) (func() error, error) {
			// Admission waits on its own pool and startup lock before BeginTx.
			// Use Home's remaining deadline here; LazyTx keeps the original
			// request for transaction lifetime and the lease's eventual release.
			if err := runtime_grants.EnsureRequestBarrier(dbutils.ReadBudgetContext(ctx)); err != nil {
				return nil, err
			}
			return func() error { return runtime_grants.ReleaseRequestBarrier(ctx) }, nil
		})

		ctx := dbutils.SetRequestActorContext(r.Context(), actor)
		ctx = dbutils.SetLazyTx(ctx, lt)
		r = r.WithContext(ctx)

		defer func() {
			if rec := recover(); rec != nil {
				_ = lt.Rollback()
				logging.ErrorAttrs(
					"transaction panic rollback",
					slog.String("path", r.URL.Path),
					slog.Any("panic_value", rec),
				)
				if lt.WasStarted() {
					txlog.LogTransactionResult(r, false, fmt.Errorf("panic: %v", rec))
				}
				panic(rec)
			}
		}()

		statusCapture := newCommitResponse(w)
		statusCapture.claimForwarding = func() bool { return lt.RefuseNewTransactions(errResponseAlreadyForwarded) }
		if buffersFiniteWrite(r) {
			statusCapture.enableAutomaticBuffer()
		}
		next.ServeHTTP(statusCapture, r)

		// Only commit/log if a transaction was actually opened
		if !lt.WasStarted() {
			statusCapture.release()
			return
		}

		statusCode := statusCapture.StatusCode()
		if statusCode < http.StatusOK || statusCode >= http.StatusBadRequest {
			rollbackCause := fmt.Errorf("http response status %d requires transaction rollback", statusCode)
			if err := lt.Rollback(); err != nil {
				if errors.Is(err, sql.ErrTxDone) && r.Context().Err() != nil {
					// The client left: database/sql already rolled back the
					// transaction bound to the cancelled request context.
					rollbackCause = fmt.Errorf("%w: request cancelled: %v", rollbackCause, r.Context().Err())
				} else {
					logging.ErrorAttrs(
						"transaction rollback failed",
						slog.String("path", r.URL.Path),
						slog.Int("status_code", statusCode),
						slog.String("error", err.Error()),
					)
					rollbackCause = fmt.Errorf("%w: rollback failed: %v", rollbackCause, err)
				}
			}
			txlog.LogTransactionResult(r, false, rollbackCause)
			statusCapture.release()
			return
		}

		err := lt.Commit()
		if dbutils.IsCommittedCleanupError(err) {
			// The change is saved. Reporting it as failed would invite a retry
			// that saves it twice, so only the late release failure is logged.
			logging.ErrorAttrs(
				"transaction committed; cleanup after commit failed",
				slog.String("path", r.URL.Path),
				slog.String("error", err.Error()),
			)
			err = nil
		}
		if err != nil {
			// A cancelled request cannot commit; its transaction is rolled back.
			if err == sql.ErrTxDone || r.Context().Err() != nil {
				_ = lt.Rollback()
				statusCapture.commitFailed()
				txlog.LogTransactionResult(r, false, err)
				return
			}
			logging.ErrorAttrs(
				"transaction commit failed",
				slog.String("path", r.URL.Path),
				slog.String("error", err.Error()),
			)
			_ = lt.Rollback()
			txlog.LogTransactionResult(r, false, err)
			statusCapture.commitFailed()
		} else {
			if enabled, _ := CheckTransactionConsoleLogs(); enabled {
				logging.InfoAttrs("transaction committed", slog.String("path", r.URL.Path))
			}
			txlog.LogTransactionResult(r, true, nil)
			statusCapture.release()
		}
	})
}

// POST reads use a request body for query inputs. Preserve their forwarding and
// size behaviour just like GET; all other unsafe methods default to buffering.
// Keep these read exceptions aligned with
// docs/instructions_and_documentation/Commit_Confirmed_Responses.md.
func buffersFiniteWrite(r *http.Request) bool {
	switch r.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions, http.MethodTrace:
		return false
	case http.MethodPost:
		switch r.URL.Path {
		case "/api/check-table-rights", "/api/check-table-rights-multi",
			"/api/fetch-dynamic-children", "/api/comment-counts", "/api/query-table",
			"/api/count-lang-embeddings", "/api/geocode-address",
			"/api/image-source-picker/resolve", "/api/image-source-picker/file",
			"/api/app/ai-chat/query", "/api/dev-ai-translate-single":
			return false
		}
	}
	return true
}

// WithTransaction is kept as an alias for backward compatibility.
// It now delegates to WithLazyTransaction — no transaction is opened eagerly.
// Deprecated: Use WithLazyTransaction directly in new code.
func WithTransaction(next http.Handler) http.Handler {
	return WithLazyTransaction(next)
}
