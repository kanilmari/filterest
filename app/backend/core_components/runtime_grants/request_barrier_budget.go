// request_barrier_budget.go
// Bounds optional admission polls without cancelling another consumer's lifecycle session.
// Connects Home's remaining deadline to PostgreSQL timeouts and prepared-statement cancellation.
// Ordinary admission retains its background poll and one-second server timeout.
package runtime_grants

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

type requestBarrierBudgetKey struct{}

// WithRequestBarrierBudget marks an optional operation's deadline for cohort
// polling. It preserves the context's values, deadline and cancellation; normal
// requests, even those with deadlines, keep their existing poll behavior.
func WithRequestBarrierBudget(ctx context.Context) context.Context {
	return context.WithValue(ctx, requestBarrierBudgetKey{}, true)
}

func pendingStartupDrainWithinBudget(ctx context.Context, conn *sql.Conn) (bool, error) {
	// The transaction must outlive statement cancellation so rollback can recover
	// the session and retain the shared lock protecting the other active leases.
	tx, err := conn.BeginTx(context.Background(), nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	if err := setStartupPollTimeout(ctx, tx); err != nil {
		return false, err
	}
	// Parse/prepare can also wait for a catalog lock. Its server timeout is
	// already bounded above. Do not attach cancellation to the connection:
	// lib/pq discards it, whereas its prepared-statement cancellation keeps it.
	statement, err := tx.Prepare(pendingStartupDrainSQL)
	if err != nil {
		return false, err
	}
	defer statement.Close()
	// Preparation consumed part of the same budget, never a fresh allowance.
	if err := setStartupPollTimeout(ctx, tx); err != nil {
		return false, err
	}
	var pending bool
	if err := statement.QueryRowContext(ctx, lifecycleLock).Scan(&pending); err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return pending, nil
}

func setStartupPollTimeout(ctx context.Context, tx *sql.Tx) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	deadline, ok := ctx.Deadline()
	if !ok {
		return fmt.Errorf("optional admission poll requires a deadline")
	}
	remaining := min(time.Second, time.Until(deadline)).Milliseconds()
	if remaining < 1 {
		// Zero disables PostgreSQL's timeout rather than expressing no budget.
		return context.DeadlineExceeded
	}
	_, err := tx.Exec(fmt.Sprintf("SET LOCAL statement_timeout = '%dms'", remaining))
	return err
}
