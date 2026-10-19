// audit_flush_test.go
// Verifies the audit queue's database-swap barrier, cancellation and cold start.
// Connects the real singleton writer to controllable in-memory SQL drivers.
// Prevents delayed audit batches from leaking into another test's database.
package audit

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	backend "easelect/backend/core_components"
)

type auditFlushDriver struct {
	mu           sync.Mutex
	handlers     []string
	beforeInsert func(context.Context, []string) error
}

type auditFlushConn struct{ state *auditFlushDriver }

func (d *auditFlushDriver) Connect(context.Context) (driver.Conn, error) {
	return &auditFlushConn{state: d}, nil
}
func (d *auditFlushDriver) Driver() driver.Driver { return d }
func (d *auditFlushDriver) Open(string) (driver.Conn, error) {
	return d.Connect(context.Background())
}
func (c *auditFlushConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("audit flush fixture does not prepare statements")
}
func (c *auditFlushConn) Close() error { return nil }
func (c *auditFlushConn) Begin() (driver.Tx, error) {
	return nil, errors.New("audit flush fixture does not begin transactions")
}
func (c *auditFlushConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	if !strings.Contains(query, "INSERT INTO system_audit_log") {
		return nil, fmt.Errorf("unexpected audit fixture query: %s", query)
	}
	handlers := make([]string, 0, len(args)/11)
	for offset := 3; offset < len(args); offset += 11 {
		handlers = append(handlers, args[offset].Value.(string))
	}
	if c.state.beforeInsert != nil {
		if err := c.state.beforeInsert(ctx, handlers); err != nil {
			return nil, err
		}
	}
	c.state.mu.Lock()
	c.state.handlers = append(c.state.handlers, handlers...)
	c.state.mu.Unlock()
	return driver.RowsAffected(len(handlers)), nil
}
func (d *auditFlushDriver) inserted() []string {
	d.mu.Lock()
	defer d.mu.Unlock()
	return slices.Clone(d.handlers)
}

func openAuditFlushDB(beforeInsert func(context.Context, []string) error) (*sql.DB, *auditFlushDriver) {
	state := &auditFlushDriver{beforeInsert: beforeInsert}
	return sql.OpenDB(state), state
}

func flushAuditForTest(t *testing.T) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := Flush(ctx); err != nil {
		t.Fatalf("flush audit events: %v", err)
	}
}

func installAuditFlushDBs(t *testing.T, dbs ...*sql.DB) {
	t.Helper()
	flushAuditForTest(t)
	previous := backend.Db
	backend.Db = dbs[0]
	t.Cleanup(func() {
		flushAuditForTest(t)
		backend.Db = previous
		for _, db := range dbs {
			_ = db.Close()
		}
	})
}

func enqueueAuditHandlers(prefix string, count int) []string {
	handlers := make([]string, count)
	for i := range handlers {
		handlers[i] = fmt.Sprintf("%s-%d", prefix, i)
		enqueue(AuditEvent{CreatedAt: time.Now(), HandlerName: handlers[i]})
	}
	return handlers
}

func TestFlushDrainsQueuedEventsBeforeDatabaseSwap(t *testing.T) {
	seedStarted, releaseSeed := make(chan struct{}), make(chan struct{})
	var releaseSeedOnce sync.Once
	finishSeed := func() { releaseSeedOnce.Do(func() { close(releaseSeed) }) }
	defer finishSeed()
	oldDB, oldState := openAuditFlushDB(func(ctx context.Context, handlers []string) error {
		if strings.HasPrefix(handlers[0], "seed-") {
			close(seedStarted)
			select {
			case <-releaseSeed:
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		return nil
	})
	type pendingInsert struct {
		handlers []string
		finish   chan struct{}
	}
	inserts := make(chan pendingInsert, 2)
	releaseAll := make(chan struct{})
	defer close(releaseAll)
	currentDB, currentState := openAuditFlushDB(func(ctx context.Context, handlers []string) error {
		call := pendingInsert{handlers: handlers, finish: make(chan struct{})}
		select {
		case inserts <- call:
		case <-ctx.Done():
			return ctx.Err()
		}
		select {
		case <-call.finish:
		case <-releaseAll:
		case <-ctx.Done():
			return ctx.Err()
		}
		return nil
	})
	installAuditFlushDBs(t, oldDB, currentDB)
	seed := enqueueAuditHandlers("seed", 1)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	seedFlushed := make(chan error, 1)
	go func() { seedFlushed <- Flush(ctx) }()
	select {
	case <-seedStarted:
	case <-time.After(5 * time.Second):
		t.Fatal("seed batch never reached the writer")
	}
	// The writer has already captured oldDB and is blocked inside that insert.
	// These events are definitely queued, and cannot trigger a DB read yet.
	want := enqueueAuditHandlers("queued", batchSize+7)
	backend.Db = currentDB
	flushed := make(chan error, 1)
	go func() { flushed <- Flush(ctx) }()
	finishSeed()
	for offset := 0; offset < len(want); {
		select {
		case call := <-inserts:
			end := offset + len(call.handlers)
			if len(call.handlers) == 0 || len(call.handlers) > batchSize || end > len(want) {
				t.Fatalf("unexpected insert size: %d", len(call.handlers))
			}
			if !slices.Equal(call.handlers, want[offset:end]) {
				t.Fatalf("insert order = %v, want %v", call.handlers, want[offset:end])
			}
			select {
			case err := <-flushed:
				t.Fatalf("Flush returned before insert completed: %v", err)
			default:
			}
			close(call.finish)
			offset = end
		case <-time.After(5 * time.Second):
			t.Fatal("queued events never reached the database installed at Flush")
		}
	}
	if err := <-seedFlushed; err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-flushed:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Flush did not acknowledge completed inserts")
	}
	if got := currentState.inserted(); !slices.Equal(got, want) {
		t.Fatalf("Flush returned before all queued events were inserted: %v", got)
	}
	// Reuse the earlier DB as the next destination. A second barrier proves no
	// earlier event was left in either the writer's batch or the event channel.
	backend.Db = oldDB
	newEvents := enqueueAuditHandlers("new", 1)
	flushAuditForTest(t)
	if got := oldState.inserted(); !slices.Equal(got, append(seed, newEvents...)) {
		t.Fatalf("events leaked across database swap: %v", got)
	}
	if got := currentState.inserted(); !slices.Equal(got, want) {
		t.Fatalf("earlier database changed after Flush: %v", got)
	}
}

func TestFlushCancellationDoesNotBlockWriter(t *testing.T) {
	for _, mode := range []string{"already cancelled", "waiting for insert", "full queue"} {
		t.Run(mode, func(t *testing.T) {
			started, release := make(chan struct{}), make(chan struct{})
			var once sync.Once
			unblock := func() { once.Do(func() { close(release) }) }
			defer unblock()
			db, _ := openAuditFlushDB(func(ctx context.Context, handlers []string) error {
				if handlers[0] == "blocked-0" {
					close(started)
					select {
					case <-release:
					case <-ctx.Done():
						return ctx.Err()
					}
				}
				return nil
			})
			installAuditFlushDBs(t, db)
			if mode != "already cancelled" {
				enqueueAuditHandlers("blocked", batchSize)
				select {
				case <-started:
				case <-time.After(5 * time.Second):
					t.Fatal("insert did not start")
				}
			}
			if mode == "full queue" {
				enqueueAuditHandlers("queued", channelBufferSize)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
			defer cancel()
			wantErr := context.DeadlineExceeded
			if mode == "already cancelled" {
				cancel()
				wantErr = context.Canceled
			}
			before := time.Now()
			if err := Flush(ctx); !errors.Is(err, wantErr) {
				t.Fatalf("Flush error = %v, want %v", err, wantErr)
			}
			if time.Since(before) > time.Second {
				t.Fatal("cancelled Flush did not return promptly")
			}
			unblock()
			// An abandoned acknowledgement must not strand the only writer.
			flushAuditForTest(t)
		})
	}
}

func TestFlushBeforeInserterStarts(t *testing.T) {
	mode := os.Getenv("FILTEREST_AUDIT_FLUSH_COLD_START")
	if mode == "" {
		// A fresh process proves cold start without resetting a live singleton
		// or depending on Go's test ordering, including under -shuffle and -race.
		for _, mode := range []string{"empty", "concurrent enqueue"} {
			t.Run(mode, func(t *testing.T) {
				ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
				defer cancel()
				cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestFlushBeforeInserterStarts$", "-test.timeout=10s")
				cmd.Env = append(os.Environ(), "FILTEREST_AUDIT_FLUSH_COLD_START="+mode)
				if output, err := cmd.CombinedOutput(); err != nil {
					t.Fatalf("cold-start process failed: %v\n%s", err, output)
				}
			})
		}
		return
	}
	if eventChan != nil {
		t.Fatal("audit inserter already started")
	}
	db, state := openAuditFlushDB(nil)
	backend.Db = db
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	const callers = 16
	results := make(chan error, callers)
	for range callers {
		go func() {
			if mode == "concurrent enqueue" {
				enqueueAuditHandlers("startup", 1)
			}
			results <- Flush(ctx)
		}()
	}
	for range callers {
		if err := <-results; err != nil {
			t.Fatalf("cold-start Flush: %v", err)
		}
	}
	wantCount := 0
	if mode == "concurrent enqueue" {
		wantCount = callers
	}
	if got := len(state.inserted()); got != wantCount {
		t.Fatalf("inserted events = %d, want %d", got, wantCount)
	}
}
