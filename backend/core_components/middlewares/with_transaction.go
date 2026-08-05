// with_transaction.go
// Middleware that provides lazy request transactions to HTTP handlers.
// Bridges role-specific database pools, request actor context, and commit/rollback logging.
// Exists to give write paths transactional safety without reserving a connection until needed.
package middlewares

import (
	"database/sql"
	"fmt"
	"log/slog"
	"net/http"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/logging"
	"easelect/backend/pipeline/txlog"
)

// WithLazyTransaction wraps an http.Handler with a lazy transaction provider.
// No database connection is reserved until the handler calls dbutils.RequireTx(ctx)
// or dbutils.GetTx(ctx). If a transaction was opened, only a final 2xx or 3xx
// response commits it; 4xx, 5xx, other non-success statuses, and panics roll it
// back. If no transaction was needed, no connection is used.
func WithLazyTransaction(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		actor := dbutils.RequestActorContextFromRequest(r)
		requestDB := backend.GetRequestDBForRequest(actor.UserRole, r)
		if requestDB == nil {
			next.ServeHTTP(w, r)
			return
		}

		lt := dbutils.NewLazyTxWithBeginHook(requestDB, func(tx *sql.Tx) error {
			return dbutils.ApplyRequestActorToTx(tx, actor)
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

		statusCapture := httpresponse.NewStatusCapture(w)
		next.ServeHTTP(statusCapture, r)

		// Only commit/log if a transaction was actually opened
		if !lt.WasStarted() {
			return
		}

		statusCode := statusCapture.StatusCode()
		if statusCode < http.StatusOK || statusCode >= http.StatusBadRequest {
			rollbackCause := fmt.Errorf("http response status %d requires transaction rollback", statusCode)
			if err := lt.Rollback(); err != nil {
				logging.ErrorAttrs(
					"transaction rollback failed",
					slog.String("path", r.URL.Path),
					slog.Int("status_code", statusCode),
					slog.String("error", err.Error()),
				)
				rollbackCause = fmt.Errorf("%w: rollback failed: %v", rollbackCause, err)
			}
			txlog.LogTransactionResult(r, false, rollbackCause)
			return
		}

		if err := lt.Commit(); err != nil {
			if err == sql.ErrTxDone {
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
		} else {
			if enabled, _ := CheckTransactionConsoleLogs(); enabled {
				logging.InfoAttrs("transaction committed", slog.String("path", r.URL.Path))
			}
			txlog.LogTransactionResult(r, true, nil)
		}
	})
}

// WithTransaction is kept as an alias for backward compatibility.
// It now delegates to WithLazyTransaction — no transaction is opened eagerly.
// Deprecated: Use WithLazyTransaction directly in new code.
func WithTransaction(next http.Handler) http.Handler {
	return WithLazyTransaction(next)
}
