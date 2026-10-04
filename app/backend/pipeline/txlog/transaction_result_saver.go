// transaction_result_saver.go
// Persists request transaction outcomes into system_transaction_log with user/session context.
// Bridges the middleware and pipeline lazy-tx wrappers with the transaction log table.
// Exists to share transaction result logging across both legacy middleware and pipeline wrappers.
package txlog

import (
	"context"
	"database/sql"
	"log/slog"
	"net/http"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/logging"
	e_sessions "easelect/backend/core_components/sessions"
)

func shouldLogTransactionResult(method string, success bool) bool {
	if !success {
		return true
	}

	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	default:
		return false
	}
}

// LogTransactionResult inserts the outcome of a request transaction into
// system_transaction_log. Non-fatal lookup/insert errors are logged.
func LogTransactionResult(r *http.Request, success bool, txErr error) {
	if !shouldLogTransactionResult(r.Method, success) {
		return
	}

	userID, _ := e_sessions.GetUserIDFromSession(r)
	// The session carries no name; the signed-in user's current one is read by id,
	// within backend.DisplayNameLookupTimeout. The outcome is written even when the
	// client has gone, so the read does not follow the request's context.
	username := backend.UserDisplayNameOr(context.Background(), backend.Db, userID, "")

	var errMsg sql.NullString
	if txErr != nil {
		errMsg = sql.NullString{String: txErr.Error(), Valid: true}
	}

	var functionID sql.NullInt64
	if err := backend.Db.QueryRow(`SELECT id FROM system_functions WHERE url_route_endpoint = $1`, r.URL.Path).Scan(&functionID); err != nil {
		if err != sql.ErrNoRows {
			logging.ErrorAttrs(
				"transaction log function lookup failed",
				slog.String("path", r.URL.Path),
				slog.String("method", r.Method),
				slog.String("error", err.Error()),
			)
		}
		functionID = sql.NullInt64{Valid: false}
	}

	_, err := backend.Db.Exec(`INSERT INTO system_transaction_log
                (function_id, method, user_id, username, success, error_message)
                VALUES ($1, $2, $3, $4, $5, $6)`,
		functionID, r.Method, userID, username, success, errMsg)
	if err != nil {
		attrs := []slog.Attr{
			slog.String("path", r.URL.Path),
			slog.String("method", r.Method),
			slog.Int("user_id", userID),
			slog.String("username", username),
			slog.Bool("success", success),
			slog.String("error", err.Error()),
		}
		if functionID.Valid {
			attrs = append(attrs, slog.Int64("function_id", functionID.Int64))
		}
		logging.ErrorAttrs("transaction log insert failed", attrs...)
	}
}
