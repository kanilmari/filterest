// request_barrier_test.go
// Proves process admission uses one lifecycle slot for many active consumers.
// Stub sessions isolate saturation from PostgreSQL; real draining has its own proof.
// Idle-stream release and cancelled acquisition must leave the gate reusable.
package runtime_grants

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type barrierDriver struct {
	locks   atomic.Int32
	pending atomic.Bool
	block   atomic.Bool
	closed  atomic.Int32
}
type barrierConn struct{ state *barrierDriver }
type barrierRows struct {
	sent  bool
	value bool
}

func (d *barrierDriver) Connect(context.Context) (driver.Conn, error) { return &barrierConn{d}, nil }
func (d *barrierDriver) Driver() driver.Driver                        { return d }
func (d *barrierDriver) Open(string) (driver.Conn, error)             { return d.Connect(context.Background()) }
func (*barrierConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepare")
}
func (c *barrierConn) Close() error            { c.state.closed.Add(1); return nil }
func (*barrierConn) Begin() (driver.Tx, error) { return barrierPollTx{}, nil }

type barrierPollTx struct{}

func (barrierPollTx) Commit() error   { return nil }
func (barrierPollTx) Rollback() error { return nil }
func (c *barrierConn) ExecContext(ctx context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	if c.state.block.Load() {
		<-ctx.Done()
		return nil, ctx.Err()
	}
	if query == `SELECT pg_advisory_lock_shared(hashtext($1))` {
		c.state.locks.Add(1)
	}
	return driver.RowsAffected(1), nil
}
func (c *barrierConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	value := true
	if query == pendingStartupDrainSQL {
		value = c.state.pending.Load()
	}
	return &barrierRows{value: value}, nil
}
func (*barrierRows) Columns() []string { return []string{"released"} }
func (*barrierRows) Close() error      { return nil }
func (r *barrierRows) Next(dest []driver.Value) error {
	if r.sent {
		return io.EOF
	}
	r.sent = true
	dest[0] = r.value
	return nil
}

func TestRequestAdmissionSharesOneSessionBeyondPoolCapacity(t *testing.T) {
	d := &barrierDriver{}
	db := sql.OpenDB(d)
	defer db.Close()
	db.SetMaxOpenConns(2)
	// Admit more consumers than the pool has slots while their responses overlap.
	err := WithRequestBarrier(context.Background(), db, func(context.Context) error {
		for i := 0; i < 20; i++ {
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			err := WithRequestBarrier(ctx, db, func(context.Context) error {
				if db.Stats().InUse != 1 {
					return errors.New("admission consumed one session per request")
				}
				return nil
			})
			cancel()
			if err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if d.locks.Load() != 1 {
		t.Fatal("cohort took multiple session locks", d.locks.Load())
	}
}

func TestOpenStreamsReleaseAdmissionAndServeNewRequests(t *testing.T) {
	db := sql.OpenDB(&barrierDriver{})
	defer db.Close()
	db.SetMaxOpenConns(2)
	done := make(chan struct{})
	entered := make(chan error, 32)
	finished := make(chan error, 32)
	var stopOnce sync.Once
	stop := func() { stopOnce.Do(func() { close(done) }) }
	defer stop()
	for i := 0; i < 32; i++ {
		go func() {
			finished <- WithRequestBarrier(context.Background(), db, func(ctx context.Context) error {
				err := ReleaseRequestBarrier(ctx)
				entered <- err
				if err != nil {
					return err
				}
				<-done
				return nil
			})
		}()
	}
	for i := 0; i < 32; i++ {
		if err := <-entered; err != nil {
			t.Fatal(err)
		}
	}
	if err := WithRequestBarrier(context.Background(), db, func(context.Context) error { return nil }); err != nil {
		t.Fatal("new request failed with idle streams", err)
	}
	if db.Stats().InUse != 0 {
		t.Fatal("idle streams held lifecycle slots")
	}
	// Cleanup waits for every response to run its idempotent release.
	stop()
	for i := 0; i < 32; i++ {
		if err := <-finished; err != nil {
			t.Fatal(err)
		}
	}
}

func TestSlowDatabasePhaseDoesNotSealOrdinaryRequests(t *testing.T) {
	db := sql.OpenDB(&barrierDriver{})
	defer db.Close()
	db.SetMaxOpenConns(2)
	entered, finish := make(chan struct{}), make(chan struct{})
	done := make(chan error, 1)
	go func() {
		done <- WithRequestBarrier(context.Background(), db, func(context.Context) error { close(entered); <-finish; return nil })
	}()
	<-entered
	defer func() {
		close(finish)
		if err := <-done; err != nil {
			t.Error(err)
		}
	}()
	time.Sleep(150 * time.Millisecond)
	ctx, cancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
	defer cancel()
	if err := WithRequestBarrier(ctx, db, func(context.Context) error { return nil }); err != nil {
		t.Fatal("long phase stopped ordinary traffic", err)
	}
}

func TestCancelledWriterReopensAdmissionBeforeSlowPhaseEnds(t *testing.T) {
	state := &barrierDriver{}
	db := sql.OpenDB(state)
	defer db.Close()
	entered, finish := make(chan struct{}), make(chan struct{})
	done := make(chan error, 1)
	go func() {
		done <- WithRequestBarrier(context.Background(), db, func(context.Context) error { close(entered); <-finish; return nil })
	}()
	<-entered
	defer func() { close(finish); <-done }()
	state.pending.Store(true)
	time.Sleep(30 * time.Millisecond)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Millisecond)
	err := WithRequestBarrier(ctx, db, func(context.Context) error { t.Error("joined sealed cohort"); return nil })
	cancel()
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal("pending writer did not seal admission", err)
	}
	state.pending.Store(false)
	ctx, cancel = context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	if err := WithRequestBarrier(ctx, db, func(context.Context) error { return nil }); err != nil {
		t.Fatal("cancelled drain stranded admission", err)
	}
}

func TestRequestPanicAndCancelledAcquisitionReleaseAdmission(t *testing.T) {
	state := &barrierDriver{}
	db := sql.OpenDB(state)
	defer db.Close()
	db.SetMaxOpenConns(2)
	func() {
		defer func() {
			if recover() == nil {
				t.Error("request did not panic")
			}
		}()
		_ = WithRequestBarrier(context.Background(), db, func(context.Context) error { panic("handler panic") })
	}()
	if db.Stats().InUse != 0 {
		t.Fatal("panic kept admission")
	}
	state.block.Store(true)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	err := WithRequestBarrier(ctx, db, func(context.Context) error { t.Error("cancelled acquisition entered handler"); return nil })
	cancel()
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal(err)
	}
	state.block.Store(false)
	if err := WithRequestBarrier(context.Background(), db, func(context.Context) error { return nil }); err != nil {
		t.Fatal("cancelled lock left gate unusable", err)
	}
	if db.Stats().InUse != 0 || state.closed.Load() == 0 {
		t.Fatal("cancelled session was not discarded")
	}
}
