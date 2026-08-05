// tx_context.go
// Provides lazy, on-demand database transactions for HTTP request handling.
// Transactions are opened only when a handler explicitly calls RequireTx(),
// preventing connection-pool exhaustion from idle transactions on read-only requests.
package dbutils

import (
	"context"
	"database/sql"
	"fmt"
	"sync"
)

// Querier is an interface that both *sql.DB and *sql.Tx implement.
// This allows functions to accept either a database pool or a transaction.
type Querier interface {
	Exec(query string, args ...interface{}) (sql.Result, error)
	Query(query string, args ...interface{}) (*sql.Rows, error)
	QueryRow(query string, args ...interface{}) *sql.Row
}

// LazyTxBeginHook runs immediately after a lazy transaction opens a real *sql.Tx.
// It is used for request-scoped per-transaction setup such as DB-local actor context.
type LazyTxBeginHook func(*sql.Tx) error

// LazyTx holds a database reference and opens a transaction only when first requested.
// This avoids reserving a connection from the pool for requests that never use a transaction.
type LazyTx struct {
	db                 *sql.DB
	tx                 *sql.Tx
	started            bool
	onBegin            LazyTxBeginHook
	afterCommitHooks   []func()
	afterRollbackHooks []func()
	mu                 sync.Mutex
}

// NewLazyTx creates a new LazyTx bound to the given database pool.
// No transaction is opened until RequireTx is called.
func NewLazyTx(db *sql.DB) *LazyTx {
	return &LazyTx{db: db}
}

// NewLazyTxWithBeginHook creates a lazy transaction with an initialization hook.
func NewLazyTxWithBeginHook(db *sql.DB, onBegin LazyTxBeginHook) *LazyTx {
	return &LazyTx{db: db, onBegin: onBegin}
}

// Begin opens the actual database transaction (called internally by RequireTx).
// Returns the existing transaction if already started.
func (lt *LazyTx) Begin() (*sql.Tx, error) {
	lt.mu.Lock()
	defer lt.mu.Unlock()
	if lt.started {
		return lt.tx, nil
	}
	tx, err := lt.db.Begin()
	if err != nil {
		return nil, fmt.Errorf("lazy transaction begin failed: %w", err)
	}
	if lt.onBegin != nil {
		if err := lt.onBegin(tx); err != nil {
			_ = tx.Rollback()
			return nil, fmt.Errorf("lazy transaction begin hook failed: %w", err)
		}
	}
	lt.tx = tx
	lt.started = true
	return lt.tx, nil
}

// WasStarted returns true if a transaction was actually opened during this request.
func (lt *LazyTx) WasStarted() bool {
	lt.mu.Lock()
	defer lt.mu.Unlock()
	return lt.started
}

// Commit commits the transaction if it was started. No-op otherwise.
func (lt *LazyTx) Commit() error {
	lt.mu.Lock()
	if !lt.started {
		lt.afterCommitHooks = nil
		lt.afterRollbackHooks = nil
		lt.mu.Unlock()
		return nil
	}
	tx := lt.tx
	hooks := append([]func(){}, lt.afterCommitHooks...)
	lt.afterCommitHooks = nil
	lt.mu.Unlock()

	if err := tx.Commit(); err != nil {
		return err
	}
	lt.mu.Lock()
	lt.afterRollbackHooks = nil
	lt.mu.Unlock()
	for _, hook := range hooks {
		if hook != nil {
			hook()
		}
	}
	return nil
}

// Rollback rolls back the transaction if it was started. No-op otherwise.
func (lt *LazyTx) Rollback() error {
	lt.mu.Lock()
	if !lt.started {
		lt.afterCommitHooks = nil
		lt.afterRollbackHooks = nil
		lt.mu.Unlock()
		return nil
	}
	tx := lt.tx
	hooks := append([]func(){}, lt.afterRollbackHooks...)
	lt.afterCommitHooks = nil
	lt.afterRollbackHooks = nil
	lt.mu.Unlock()

	err := tx.Rollback()
	for _, hook := range hooks {
		if hook != nil {
			hook()
		}
	}
	return err
}

// AddAfterCommitHook registers a callback that runs after a successful commit.
// Hooks are ignored when nil and cleared on rollback.
func (lt *LazyTx) AddAfterCommitHook(hook func()) bool {
	if hook == nil {
		return false
	}
	lt.mu.Lock()
	defer lt.mu.Unlock()
	lt.afterCommitHooks = append(lt.afterCommitHooks, hook)
	return true
}

// AddAfterRollbackHook registers a callback that runs after rollback is attempted.
// Hooks are cleared by a successful commit and also run after a failed commit when
// the request middleware subsequently rolls the transaction back.
func (lt *LazyTx) AddAfterRollbackHook(hook func()) bool {
	if hook == nil {
		return false
	}
	lt.mu.Lock()
	defer lt.mu.Unlock()
	lt.afterRollbackHooks = append(lt.afterRollbackHooks, hook)
	return true
}

// contextKeyTx is a custom context key type.
type contextKeyTx string

const txKey contextKeyTx = "db_tx"

// SetLazyTx stores a LazyTx in the context and returns the new context.
func SetLazyTx(ctx context.Context, lt *LazyTx) context.Context {
	return context.WithValue(ctx, txKey, lt)
}

// RegisterAfterCommitHook registers a post-commit callback for request-scoped LazyTx contexts.
// Returns false when the context does not carry a LazyTx.
func RegisterAfterCommitHook(ctx context.Context, hook func()) bool {
	lt, ok := ctx.Value(txKey).(*LazyTx)
	if !ok || lt == nil {
		return false
	}
	return lt.AddAfterCommitHook(hook)
}

// RegisterAfterRollbackHook registers a rollback callback for request-scoped LazyTx contexts.
// Returns false when the context does not carry a LazyTx.
func RegisterAfterRollbackHook(ctx context.Context, hook func()) bool {
	lt, ok := ctx.Value(txKey).(*LazyTx)
	if !ok || lt == nil {
		return false
	}
	return lt.AddAfterRollbackHook(hook)
}

// RequireTx retrieves or opens a database transaction from the context.
// The transaction is created on first call and reused for subsequent calls
// within the same request. This is the only way handlers should obtain a transaction.
func RequireTx(ctx context.Context) (*sql.Tx, bool) {
	lt, ok := ctx.Value(txKey).(*LazyTx)
	if !ok || lt == nil {
		return nil, false
	}
	tx, err := lt.Begin()
	if err != nil {
		return nil, false
	}
	return tx, true
}

// RequireTxWithError retrieves or opens a database transaction from context and preserves errors.
// Pilot read paths use this helper so tx-init failures do not silently fall back to pooled reads.
func RequireTxWithError(ctx context.Context) (*sql.Tx, error) {
	val := ctx.Value(txKey)
	if lt, ok := val.(*LazyTx); ok && lt != nil {
		return lt.Begin()
	}
	if tx, ok := val.(*sql.Tx); ok && tx != nil {
		return tx, nil
	}
	return nil, fmt.Errorf("transaction missing from context")
}

// SetTx stores a *sql.Tx directly in the context (legacy helper for non-HTTP contexts).
func SetTx(ctx context.Context, tx *sql.Tx) context.Context {
	return context.WithValue(ctx, txKey, tx)
}

// PeekTx returns an already-open request transaction without starting one.
// It exists for helpers that may safely reuse a transaction after another
// request stage opened it, but must not reserve a connection themselves.
func PeekTx(ctx context.Context) (*sql.Tx, bool) {
	val := ctx.Value(txKey)
	if lt, ok := val.(*LazyTx); ok && lt != nil {
		lt.mu.Lock()
		defer lt.mu.Unlock()
		if !lt.started || lt.tx == nil {
			return nil, false
		}
		return lt.tx, true
	}
	if tx, ok := val.(*sql.Tx); ok && tx != nil {
		return tx, true
	}
	return nil, false
}

// GetTx retrieves a transaction from the context.
// Supports both LazyTx (HTTP requests) and direct *sql.Tx (non-HTTP / legacy callers).
// Deprecated: Prefer RequireTx for new code — the name makes intent clearer.
func GetTx(ctx context.Context) (*sql.Tx, bool) {
	val := ctx.Value(txKey)
	// LazyTx path (HTTP requests via middleware)
	if lt, ok := val.(*LazyTx); ok && lt != nil {
		tx, err := lt.Begin()
		if err != nil {
			return nil, false
		}
		return tx, true
	}
	// Direct *sql.Tx path (non-HTTP callers, e.g. startup scripts)
	if tx, ok := val.(*sql.Tx); ok {
		return tx, ok
	}
	return nil, false
}

// GetQuerier returns the request transaction if one exists, otherwise the fallback DB pool.
func GetQuerier(ctx context.Context, fallback *sql.DB) Querier {
	if tx, ok := GetTx(ctx); ok && tx != nil {
		return tx
	}
	return fallback
}
