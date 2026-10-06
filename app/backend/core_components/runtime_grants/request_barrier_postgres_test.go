// request_barrier_postgres_test.go
// Proves admission and writer fairness across two independent lifecycle pools.
// Exercises shared SQL phases, queued startup, cancellation and panic cleanup.
// Every connection belongs to the opt-in disposable PostgreSQL cluster.
package runtime_grants

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/lib/pq"
	"testing"
	"time"
)

func awaitBarrierResult(t *testing.T, done <-chan error) {
	t.Helper()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("lifecycle phase deadlocked")
	}
}
func TestIndependentLifecyclePoolsKeepTrafficAndDrainFairlyPostgres(t *testing.T) {
	owner, connect := grantDisposableDB(t)
	pools := []*sql.DB{connect("fixture_owner"), connect("fixture_owner")}
	for _, db := range pools {
		db.SetMaxOpenConns(2)
	}
	finish := make(chan struct{})
	entered := make(chan struct{}, 2)
	done := make(chan error, 2)
	for _, db := range pools {
		go func(db *sql.DB) {
			done <- WithRequestBarrier(context.Background(), db, func(ctx context.Context) error {
				// A real slow database statement, followed by an active consumer.
				if _, err := owner.ExecContext(ctx, `SELECT pg_sleep(0.15)`); err != nil {
					return err
				}
				entered <- struct{}{}
				<-finish
				return nil
			})
		}(db)
	}
	<-entered
	<-entered
	stopped := false
	defer func() {
		if !stopped {
			close(finish)
		}
	}()
	// Before the fix both process cohorts seal solely because they are old.
	for _, db := range pools {
		ctx, cancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
		err := WithRequestBarrier(ctx, db, func(ctx context.Context) error { _, err := owner.ExecContext(ctx, `SELECT 1`); return err })
		cancel()
		if err != nil {
			t.Fatal("slow consumer stopped normal traffic", err)
		}
	}
	drainEntered, releaseDrain := make(chan struct{}), make(chan struct{})
	drainDone := make(chan error, 1)
	go func() {
		drainDone <- WithStartupBarrier(context.Background(), pools[1], func() error { close(drainEntered); <-releaseDrain; return nil })
	}()
	defer close(releaseDrain)
	deadline := time.Now().Add(time.Second)
	for {
		var pending bool
		if err := owner.QueryRow(pendingStartupDrainSQL, lifecycleLock).Scan(&pending); err != nil {
			t.Fatal(err)
		}
		if pending {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("exclusive waiter not visible")
		}
		time.Sleep(time.Millisecond)
	}
	// Let the bounded catalogue poll see this writer before trying both processes.
	time.Sleep(30 * time.Millisecond)
	laterEntered := make(chan struct{}, 2)
	laterDone := make(chan error, 2)
	for _, db := range pools {
		go func(db *sql.DB) {
			laterDone <- WithRequestBarrier(context.Background(), db, func(context.Context) error { laterEntered <- struct{}{}; return nil })
		}(db)
	}
	select {
	case <-laterEntered:
		t.Fatal("new request overtook startup")
	case <-time.After(50 * time.Millisecond):
	}
	close(finish)
	stopped = true
	awaitBarrierResult(t, done)
	awaitBarrierResult(t, done)
	select {
	case <-drainEntered:
	case <-time.After(2 * time.Second):
		t.Fatal("startup was starved")
	}
	select {
	case <-laterEntered:
		t.Fatal("new request ran during startup")
	default:
	}
	// Closing is deferred for failures; release now through a separate signal.
	// Use cancellation rather than double-closing the channel in cleanup.
	releaseDrain <- struct{}{}
	awaitBarrierResult(t, drainDone)
	awaitBarrierResult(t, laterDone)
	awaitBarrierResult(t, laterDone)
	for _, db := range pools {
		if db.Stats().InUse != 0 {
			t.Fatal("lifecycle slot leaked")
		}
	}
}

func TestIndependentPoolCancelledAcquisitionAndPanicCleanupPostgres(t *testing.T) {
	owner, connect := grantDisposableDB(t)
	first, second := connect("fixture_owner"), connect("fixture_owner")
	first.SetMaxOpenConns(2)
	second.SetMaxOpenConns(2)
	entered, release := make(chan struct{}), make(chan struct{})
	done := make(chan error, 1)
	go func() {
		done <- WithStartupBarrier(context.Background(), first, func() error { close(entered); <-release; return nil })
	}()
	<-entered
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Millisecond)
	err := WithRequestBarrier(ctx, second, func(context.Context) error { t.Error("cancelled consumer entered startup"); return nil })
	cancel()
	close(release)
	awaitBarrierResult(t, done)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal("acquisition was not cancelled", err)
	}
	func() {
		defer func() {
			if recover() == nil {
				t.Error("missing request panic")
			}
		}()
		_ = WithRequestBarrier(context.Background(), second, func(context.Context) error { panic("request panic") })
	}()
	if err := WithStartupBarrier(context.Background(), first, func() error { _, err := owner.Exec(`SELECT 1`); return err }); err != nil {
		t.Fatal("cancelled/panicking request stranded drain", err)
	}
	if err := WithRequestBarrier(context.Background(), second, func(context.Context) error { return nil }); err != nil {
		t.Fatal(err)
	}
	if first.Stats().InUse != 0 || second.Stats().InUse != 0 {
		t.Fatal("cancelled acquisition leaked lifecycle sessions")
	}
}

func TestDatabasePhaseTransactionDoesNotReacquireBehindStartupPostgres(t *testing.T) {
	owner, connect := grantDisposableDB(t)
	first, second := connect("fixture_owner"), connect("fixture_owner")
	first.SetMaxOpenConns(2)
	second.SetMaxOpenConns(2)
	var socket string
	var port int
	if err := owner.QueryRow(`SELECT current_setting('unix_socket_directories'),current_setting('port')::int`).Scan(&socket, &port); err != nil {
		t.Fatal(err)
	}
	connector, err := pq.NewConnector(fmt.Sprintf("host=%s port=%d user=fixture_owner dbname=postgres sslmode=disable", socket, port))
	if err != nil {
		t.Fatal(err)
	}
	work := sql.OpenDB(DatabasePhaseConnector(connector, func() *sql.DB { return first }, func() bool { return true }))
	defer work.Close()
	tx, err := work.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	started, finish := make(chan struct{}), make(chan struct{})
	done := make(chan error, 1)
	go func() {
		done <- WithStartupBarrier(context.Background(), second, func() error { close(started); <-finish; return nil })
	}()
	defer close(finish)
	deadline := time.Now().Add(time.Second)
	for {
		var pending bool
		if err := owner.QueryRow(pendingStartupDrainSQL, lifecycleLock).Scan(&pending); err != nil {
			t.Fatal(err)
		}
		if pending {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("startup never queued")
		}
		time.Sleep(time.Millisecond)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	// This is the real mutation transaction setup on an unmarked background
	// context. The connector's existing lease must replace its redundant lock.
	if err := LockRuntimeRequestBarrier(ctx, tx); err != nil {
		t.Fatal("admitted transaction queued behind its own drainer", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("committed SQL phase stranded startup")
	}
	finish <- struct{}{}
	awaitBarrierResult(t, done)
}
