// check_transaction_console_logs.go
// Middleware that captures per-request transaction log entries for debugging.
// Bridges the request context and the development console log output.
// Exists to surface transaction-level diagnostics during development.
package middlewares

import (
	backend "easelect/backend/core_components"
)

// CheckTransactionConsoleLogs reads the 'transaction_console_logs' flag from system_config.
func CheckTransactionConsoleLogs() (bool, error) {
	var enabled bool
	err := backend.Db.QueryRow(`
        SELECT boolean_value
        FROM system_config
        WHERE key = 'transaction_console_logs'
    `).Scan(&enabled)
	if err != nil {
		return false, err
	}
	return enabled, nil
}
