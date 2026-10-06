// lifecycle_barrier.go
// Drains active database transactions before migrations and start-up policy writers.
// Uses a separate lifecycle lock before the existing grant-policy advisory lock.
// The dedicated session is discarded if releasing its exclusive lock fails.
package runtime_grants

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"time"
)

const lifecycleLock = "filterest.runtime_startup_barrier"

// WithStartupBarrier serializes entire boots, not just their last ACL step.
// Pass the dedicated lifecycle pool; work uses separate role pools.
// No workers or listener may start until work returns successfully. Restores
// additionally stop all applications before importing their cold database.
func WithStartupBarrier(ctx context.Context, db *sql.DB, work func() error) (err error) {
	if db == nil {
		return fmt.Errorf("start-up lifecycle database is missing")
	}
	lockCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	conn, err := db.Conn(lockCtx)
	if err != nil {
		return fmt.Errorf("reserve start-up barrier connection: %w", err)
	}
	defer conn.Close()
	if _, err = conn.ExecContext(lockCtx, `SELECT pg_advisory_lock(hashtext($1))`, lifecycleLock); err != nil {
		// Cancellation can race successful acquisition. Closing a sql.Conn alone
		// returns it to the pool; discard the physical session to release any lock.
		_ = conn.Raw(func(any) error { return driver.ErrBadConn })
		return fmt.Errorf("exclusive start-up drain barrier: %w", err)
	}
	defer func() {
		releaseCtx, releaseCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer releaseCancel()
		var unlocked bool
		releaseErr := conn.QueryRowContext(releaseCtx, `SELECT pg_advisory_unlock(hashtext($1))`, lifecycleLock).Scan(&unlocked)
		if releaseErr != nil || !unlocked {
			_ = conn.Raw(func(any) error { return driver.ErrBadConn })
			if err == nil {
				err = fmt.Errorf("release start-up barrier: %v (released=%v)", releaseErr, unlocked)
			}
		}
	}()
	return work()
}

// LockRuntimeRequestBarrier runs before actor setup or row/reference/DDL locks.
// Both ordinary writes and policy mutations participate, so startup drains them.
func LockRuntimeRequestBarrier(ctx context.Context, tx *sql.Tx) error {
	if requestBarrierHeld(ctx) {
		return nil
	}
	if tx == nil {
		return fmt.Errorf("runtime request transaction is required")
	}
	if _, err := tx.ExecContext(ctx, `SET LOCAL lock_timeout = '5s'`); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock_shared(hashtext($1))`, lifecycleLock)
	return err
}

func lockRuntimeGrantPolicyOnly(ctx context.Context, tx *sql.Tx) error {
	if tx == nil {
		return fmt.Errorf("runtime grant transaction is required")
	}
	if _, err := tx.ExecContext(ctx, `SET LOCAL lock_timeout = '5s'`); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext('filterest.runtime_role_write_revocations'))`)
	return err
}
