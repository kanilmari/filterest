// request_barrier.go
// Shares one lifecycle session across a process's active database consumers.
// The lifecycle pool is separate from every work pool, including administrators.
// Admission seals only for a real exclusive waiter in this database.
package runtime_grants

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"sync"
	"time"
)

type lifecycleContextKey struct{}

type requestGate struct {
	serial  chan struct{}
	active  int
	pollAt  time.Time
	sealed  bool
	drained chan struct{}
	conn    *sql.Conn
}

var requestGates sync.Map // keyed by the dedicated lifecycle *sql.DB

type requestLease struct {
	mu   sync.Mutex
	held bool
	gate *requestGate
	db   *sql.DB
}

func requestBarrierHeld(ctx context.Context) bool {
	lease, _ := ctx.Value(lifecycleContextKey{}).(*requestLease)
	if lease == nil {
		return false
	}
	lease.mu.Lock()
	defer lease.mu.Unlock()
	return lease.held
}

// ReleaseRequestBarrier ends the initial stream admission before it starts
// waiting for events. Subsequent DB phases use WithRequestBarrier themselves.
func ReleaseRequestBarrier(ctx context.Context) error {
	lease, _ := ctx.Value(lifecycleContextKey{}).(*requestLease)
	if lease == nil {
		return nil
	}
	lease.mu.Lock()
	defer lease.mu.Unlock()
	if !lease.held {
		return nil
	}
	lease.held = false
	gate := lease.gate
	<-gate.serial
	defer func() { gate.serial <- struct{}{} }()
	gate.active--
	if gate.active != 0 {
		return nil
	}
	defer close(gate.drained)
	defer gate.conn.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var unlocked bool
	err := gate.conn.QueryRowContext(ctx, `SELECT pg_advisory_unlock_shared(hashtext($1))`, lifecycleLock).Scan(&unlocked)
	if err != nil || !unlocked {
		_ = gate.conn.Raw(func(any) error { return driver.ErrBadConn })
		return fmt.Errorf("release request drain barrier: %v (released=%v)", err, unlocked)
	}
	return nil
}

// pendingStartupDrainSQL observes waiters from every process, on this database
// and the exact bigint advisory key. Polling uses the already-held session.
const pendingStartupDrainSQL = `SELECT EXISTS (SELECT 1 FROM pg_locks
 WHERE locktype='advisory' AND database=(SELECT oid FROM pg_database WHERE datname=current_database())
 AND classid=((hashtext($1)::bigint >> 32) & 4294967295)::oid
 AND objid=(hashtext($1)::bigint & 4294967295)::oid AND objsubid=1
 AND mode='ExclusiveLock' AND NOT granted)`

// Poll in a short transaction with a server-side timeout. Cancelling a Go
// query on this session could drop the shared lock protecting other consumers.
// SET LOCAL restores the lifecycle session's settings on every exit.
func pendingStartupDrain(conn *sql.Conn) (bool, error) {
	tx, err := conn.BeginTx(context.Background(), nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`SET LOCAL statement_timeout = '1s'`); err != nil {
		return false, err
	}
	var pending bool
	if err := tx.QueryRow(pendingStartupDrainSQL, lifecycleLock).Scan(&pending); err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return pending, nil
}

// WithRequestBarrier shares admission until an actual writer waits. Once seen,
// the cohort seals until its consumers drain; the next shared lock queues behind
// the writer. With no writer, a long phase never stops unrelated requests.
func WithRequestBarrier(ctx context.Context, db *sql.DB, work func(context.Context) error) (err error) {
	leaseContext, release, err := AcquireRequestBarrier(ctx, db)
	if err != nil {
		return err
	}
	defer func() {
		if e := release(); err == nil {
			err = e
		}
	}()
	return work(leaseContext)
}

// AcquireRequestBarrier lets SQL rows/transactions release admission when their
// database phase ends, independently of response/network lifetime.
func AcquireRequestBarrier(ctx context.Context, db *sql.DB) (context.Context, func() error, error) {
	if requestBarrierHeld(ctx) {
		return ctx, func() error { return nil }, nil
	}
	if db == nil {
		return ctx, nil, fmt.Errorf("request lifecycle database is missing")
	}
	newGate := &requestGate{serial: make(chan struct{}, 1)}
	newGate.serial <- struct{}{}
	value, _ := requestGates.LoadOrStore(db, newGate)
	gate := value.(*requestGate)
	admission, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	for {
		select {
		case <-admission.Done():
			return ctx, nil, admission.Err()
		case <-gate.serial:
		}
		if gate.active > 0 && time.Now().After(gate.pollAt) {
			pending, err := pendingStartupDrain(gate.conn)
			if err != nil {
				gate.serial <- struct{}{}
				return ctx, nil, err
			}
			gate.sealed = pending
			gate.pollAt = time.Now().Add(25 * time.Millisecond)
		}
		if gate.active > 0 && gate.sealed {
			drained := gate.drained
			gate.serial <- struct{}{}
			select {
			case <-admission.Done():
				return ctx, nil, admission.Err()
			case <-time.After(25 * time.Millisecond):
				continue // A cancelled writer must reopen admission before this phase ends.
			case <-drained:
				continue
			}
		}
		if admission.Err() != nil {
			gate.serial <- struct{}{}
			return ctx, nil, admission.Err()
		}
		if gate.active == 0 {
			conn, acquireErr := db.Conn(admission)
			if acquireErr == nil {
				_, acquireErr = conn.ExecContext(admission, `SELECT pg_advisory_lock_shared(hashtext($1))`, lifecycleLock)
				if acquireErr != nil {
					_ = conn.Raw(func(any) error { return driver.ErrBadConn })
					_ = conn.Close()
				}
			}
			if acquireErr != nil {
				gate.serial <- struct{}{}
				if admissionErr := admission.Err(); admissionErr != nil {
					// lib/pq reports a cancelled lock wait as its own cancellation error;
					// callers act on the context's reason, so keep it in the chain.
					return ctx, nil, fmt.Errorf("%w (%v)", admissionErr, acquireErr)
				}
				return ctx, nil, acquireErr
			}
			gate.conn, gate.drained = conn, make(chan struct{})
			gate.pollAt, gate.sealed = time.Now().Add(25*time.Millisecond), false
		}
		gate.active++
		gate.serial <- struct{}{}
		break
	}
	leaseContext := context.WithValue(ctx, lifecycleContextKey{}, &requestLease{held: true, gate: gate})
	return leaseContext, func() error { return ReleaseRequestBarrier(leaseContext) }, nil
}

// WithLazyRequestBarrier supplies transaction admission without holding anything
// during authentication-free processing, request body reads or response waits.
func WithLazyRequestBarrier(ctx context.Context, db *sql.DB, work func(context.Context)) (err error) {
	leaseContext := context.WithValue(ctx, lifecycleContextKey{}, &requestLease{db: db})
	defer func() { err = ReleaseRequestBarrier(leaseContext) }()
	work(leaseContext)
	return nil
}

// EnsureRequestBarrier opens the lazy request's transaction phase. Work-pool
// connectors admit individual reads separately, including contextless helpers.
func EnsureRequestBarrier(ctx context.Context) error {
	lease, _ := ctx.Value(lifecycleContextKey{}).(*requestLease)
	if lease == nil {
		return nil
	}
	lease.mu.Lock()
	defer lease.mu.Unlock()
	if lease.held {
		return nil
	}
	phase, _, err := AcquireRequestBarrier(context.WithValue(ctx, lifecycleContextKey{}, nil), lease.db)
	if err != nil {
		return err
	}
	admitted := phase.Value(lifecycleContextKey{}).(*requestLease)
	lease.gate, lease.held = admitted.gate, true
	return nil
}
