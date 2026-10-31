// read_budget.go
// Bounds optional reads without giving their deadline ownership of a request transaction.
// Connects pooled context queries and PostgreSQL savepoints with one remaining budget.
// Rolls read-only scopes back on exit, restoring settings and recovering statement failures.
package dbutils

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"
	"time"
)

type readBudgetKey struct{}

// WithReadBudget carries an operation deadline as a value. Done and Deadline
// remain those of the original request, including when RequireTx opens lazily.
func WithReadBudget(request, budget context.Context) context.Context {
	return context.WithValue(request, readBudgetKey{}, budget)
}

// ReadBudgetContext bounds pool acquisition without transferring transaction
// lifetime to the optional operation. BeginTx must still use the request context.
func ReadBudgetContext(ctx context.Context) context.Context {
	if budget, ok := ctx.Value(readBudgetKey{}).(context.Context); ok {
		return budget
	}
	return ctx
}

// ReadBudgetFallback preserves the same budget when a reader needs an owning
// metadata pool rather than the actor's row connection. Ordinary reads retain
// their existing fallback connection and cancellation behavior.
func ReadBudgetFallback(q Querier, fallback *sql.DB) Querier {
	if bounded, ok := q.(interface{ readBudget() context.Context }); ok {
		return &budgetedReadPool{BindQueryContext(bounded.readBudget(), fallback), bounded.readBudget()}
	}
	return fallback
}

type budgetedReadPool struct {
	Querier
	budget context.Context
}

func (q *budgetedReadPool) readBudget() context.Context { return q.budget }

// ReadBudgetExpired includes the sub-millisecond remainder PostgreSQL cannot
// express safely: a zero statement_timeout would disable the limit entirely.
func ReadBudgetExpired(ctx context.Context) bool {
	budget, ok := ctx.Value(readBudgetKey{}).(context.Context)
	if !ok {
		return false
	}
	deadline, bounded := budget.Deadline()
	return budget.Err() != nil || (bounded && time.Until(deadline) < time.Millisecond)
}

// BeginReadBudget wraps read-only work. Close all returned rows before finish.
// The transaction must already be opened with the original request context.
// Rolling back even successful reads restores the previous statement_timeout
// without inspecting Scan errors or relying on every caller to report them.
func BeginReadBudget(ctx context.Context, q Querier) (Querier, func() error, error) {
	finish := func() error { return nil }
	budget, ok := ctx.Value(readBudgetKey{}).(context.Context)
	if !ok {
		return q, finish, nil
	}
	if ReadBudgetExpired(ctx) {
		return nil, finish, context.DeadlineExceeded
	}
	if tx, ok := q.(*sql.Tx); ok {
		if _, err := tx.ExecContext(ctx, "SAVEPOINT filterest_optional_read"); err != nil {
			return nil, finish, err
		}
		finished := false
		finish = func() error {
			if finished {
				return nil
			}
			finished = true
			if _, err := tx.ExecContext(ctx, "ROLLBACK TO SAVEPOINT filterest_optional_read"); err != nil {
				return fmt.Errorf("recover optional read: %w", err)
			}
			_, err := tx.ExecContext(ctx, "RELEASE SAVEPOINT filterest_optional_read")
			return err
		}
		return &budgetedReadTx{ctx: ctx, budget: budget, tx: tx}, finish, nil
	}
	connection, ok := q.(ContextSQL)
	if !ok {
		return nil, finish, fmt.Errorf("optional read requires context-aware database queries")
	}
	return &budgetedReadPool{BindQueryContext(budget, connection), budget}, finish, nil
}

type budgetedReadTx struct {
	ctx, budget context.Context
	tx          *sql.Tx
}

func (q *budgetedReadTx) readBudget() context.Context { return q.budget }

func (q *budgetedReadTx) setRemainingTimeout() error {
	if err := q.budget.Err(); err != nil {
		return err
	}
	deadline, ok := q.budget.Deadline()
	if !ok {
		return fmt.Errorf("optional transaction read requires a deadline")
	}
	remaining := time.Until(deadline).Milliseconds()
	if remaining < 1 {
		return context.DeadlineExceeded
	}
	// Use the request context, never the budget context, for shared-transaction
	// statements. PostgreSQL enforces this bound and the savepoint recovers it.
	_, err := q.tx.ExecContext(q.ctx, "SELECT set_config('statement_timeout', $1, true)", strconv.FormatInt(remaining, 10))
	return err
}

func (q *budgetedReadTx) Exec(query string, args ...any) (sql.Result, error) {
	if err := q.setRemainingTimeout(); err != nil {
		return nil, err
	}
	return q.tx.ExecContext(q.ctx, query, args...)
}

func (q *budgetedReadTx) Query(query string, args ...any) (*sql.Rows, error) {
	if err := q.setRemainingTimeout(); err != nil {
		return nil, err
	}
	return q.tx.QueryContext(q.ctx, query, args...)
}

func (q *budgetedReadTx) QueryRow(query string, args ...any) *sql.Row {
	if err := q.setRemainingTimeout(); err != nil {
		// Querier cannot return a QueryRow error directly. A cancelled context
		// makes Scan fail without sending another statement to the transaction.
		ctx, cancel := context.WithCancelCause(q.ctx)
		cancel(err)
		return q.tx.QueryRowContext(ctx, query, args...)
	}
	return q.tx.QueryRowContext(q.ctx, query, args...)
}
