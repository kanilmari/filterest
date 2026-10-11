// lifecycle_barrier.go
// Drains active database transactions before migrations and start-up policy writers.
// Uses a separate lifecycle lock before the existing grant-policy advisory lock.
// The dedicated session is discarded if releasing its exclusive lock fails.
package runtime_grants

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/lib/pq"
)

const lifecycleLock = "filterest.runtime_startup_barrier"

// Ten seconds still admits the six-second overlap proof, while leaving twenty
// seconds of a thirty-second client budget for work, rollback and delivery.
const policyLockWaitTimeout = 10 * time.Second

// Package tests may shorten this wait; no runtime configuration changes it.
var policyLockWaitLimit = policyLockWaitTimeout

// ErrPolicyLockWaitTimeout identifies only an expired policy-lock acquisition.
// HTTP mutation callers translate it; other lock failures keep their own errors.
var ErrPolicyLockWaitTimeout = errors.New("runtime grant policy lock wait timed out")

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
	// This lock queues complete policy mutations, including catalogue-wide
	// inspection and the caller's eventual commit. Allow overlapping mutations
	// time to finish, but bound queued transactions and pooled connections.
	// Keep the request context: a client leaving still cancels and rolls back.
	if _, err := tx.ExecContext(ctx, fmt.Sprintf(`SET LOCAL lock_timeout = '%dms'`, policyLockWaitLimit.Milliseconds())); err != nil {
		return err
	}
	started := time.Now()
	_, acquireErr := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext('filterest.runtime_role_write_revocations'))`)
	if elapsed := time.Since(started); elapsed >= time.Second {
		log.Printf("[RUNTIME GRANTS] policy_lock_wait=%s acquired=%t", elapsed.Round(time.Millisecond), acquireErr == nil)
	}
	if err := acquireErr; err != nil {
		var postgresError *pq.Error
		if errors.As(err, &postgresError) && postgresError.Code == "55P03" {
			return fmt.Errorf("%w: %w", ErrPolicyLockWaitTimeout, err)
		}
		return err
	}
	// Restore the existing limit before metadata reads or row/reference/DDL
	// locks. Neither their timeout nor the lifecycle-before-policy order changes.
	_, err := tx.ExecContext(ctx, `SET LOCAL lock_timeout = '5s'`)
	return err
}
