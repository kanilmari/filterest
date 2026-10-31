// request_barrier_budget_test.go
// Proves active-cohort polls receive only Home's remaining admission budget.
// Records transaction lifetime, SQL timeout and read context through the real gate.
// Timeout recovery must preserve the existing lease and admit a following request.
package runtime_grants

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"strings"
	"testing"
	"time"
)

type cohortPollDriver struct {
	barrierDriver
	queryContext, beginContext context.Context
	timeout                    time.Duration
	settings                   []string
	polls, commits, rollbacks  int
	blocked, inTransaction     bool
}
type cohortPollConn struct {
	*barrierConn
	state *cohortPollDriver
}
type cohortPollTx struct{ state *cohortPollDriver }
type cohortPollStatement struct{ state *cohortPollDriver }

func (d *cohortPollDriver) Connect(context.Context) (driver.Conn, error) {
	return &cohortPollConn{&barrierConn{&d.barrierDriver}, d}, nil
}
func (d *cohortPollDriver) Driver() driver.Driver { return d }
func (d *cohortPollDriver) Open(string) (driver.Conn, error) {
	return d.Connect(context.Background())
}
func (c *cohortPollConn) BeginTx(ctx context.Context, _ driver.TxOptions) (driver.Tx, error) {
	c.state.beginContext, c.state.inTransaction = ctx, true
	return cohortPollTx{c.state}, nil
}
func (c *cohortPollConn) Prepare(string) (driver.Stmt, error) {
	return cohortPollStatement{c.state}, nil
}
func (c *cohortPollConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	const prefix = "SET LOCAL statement_timeout = '"
	if strings.HasPrefix(query, prefix) {
		var err error
		c.state.timeout, err = time.ParseDuration(strings.TrimSuffix(strings.TrimPrefix(query, prefix), "'"))
		c.state.settings = append(c.state.settings, query)
		return driver.RowsAffected(1), err
	}
	return c.barrierConn.ExecContext(ctx, query, args)
}
func (c *cohortPollConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if query == pendingStartupDrainSQL {
		return c.state.poll(ctx)
	}
	return c.barrierConn.QueryContext(ctx, query, args)
}
func (d *cohortPollDriver) poll(ctx context.Context) (driver.Rows, error) {
	d.queryContext = ctx
	d.polls++
	if d.blocked {
		timer := time.NewTimer(d.timeout)
		defer timer.Stop()
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-timer.C:
			return nil, errors.New("server statement timeout")
		}
	}
	return &barrierRows{value: false}, nil
}
func (tx cohortPollTx) Commit() error {
	tx.state.commits++
	tx.state.inTransaction = false
	return nil
}
func (tx cohortPollTx) Rollback() error {
	tx.state.rollbacks++
	tx.state.inTransaction = false
	return nil
}
func (cohortPollStatement) Close() error  { return nil }
func (cohortPollStatement) NumInput() int { return 1 }
func (cohortPollStatement) Exec([]driver.Value) (driver.Result, error) {
	return nil, errors.New("unexpected statement exec")
}
func (s cohortPollStatement) Query([]driver.Value) (driver.Rows, error) {
	return s.state.poll(context.Background())
}
func (s cohortPollStatement) QueryContext(ctx context.Context, _ []driver.NamedValue) (driver.Rows, error) {
	return s.state.poll(ctx)
}

func activeCohortPoll(t *testing.T) (*sql.DB, *cohortPollDriver, *requestGate, func() error) {
	t.Helper()
	d := &cohortPollDriver{}
	db := sql.OpenDB(d)
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { db.Close(); requestGates.Delete(db) })
	_, release, err := AcquireRequestBarrier(context.Background(), db)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := release(); err != nil {
			t.Error(err)
		}
	})
	value, _ := requestGates.Load(db)
	gate := value.(*requestGate)
	gate.pollAt = time.Now().Add(-time.Second)
	return db, d, gate, release
}

func TestRequestCohortPollReceivesOnlyHomeBudget(t *testing.T) {
	for _, tc := range []struct {
		name   string
		home   bool
		budget time.Duration
	}{
		{"home remainder", true, 200 * time.Millisecond},
		{"home one second cap", true, 2 * time.Second},
		{"ordinary deadline", false, 20 * time.Millisecond},
		{"ordinary background", false, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, d, _, _ := activeCohortPoll(t)
			ctx := context.Background()
			if tc.budget != 0 {
				var cancel context.CancelFunc
				ctx, cancel = context.WithTimeout(ctx, tc.budget)
				defer cancel()
			}
			if tc.home {
				ctx = WithRequestBarrierBudget(ctx)
			}
			deadline, _ := ctx.Deadline()
			_, release, err := AcquireRequestBarrier(ctx, db)
			if err != nil {
				t.Fatal(err)
			}
			defer release()
			if d.polls != 1 || d.beginContext != context.Background() || d.commits != 1 || d.inTransaction {
				t.Fatal("poll branch/lifetime changed", d.polls, d.beginContext, d.commits, d.inTransaction)
			}
			if tc.home {
				got, ok := d.queryContext.Deadline()
				if !ok || got != deadline || d.timeout < time.Millisecond || d.timeout > min(time.Second, tc.budget) {
					t.Fatal("poll lost remaining deadline/timeout", got, deadline, d.timeout)
				}
			} else if d.queryContext != context.Background() || len(d.settings) != 1 || d.settings[0] != "SET LOCAL statement_timeout = '1s'" {
				t.Fatal("ordinary poll changed", d.queryContext, d.settings)
			}
		})
	}
}

func TestRequestCohortPollTimeoutKeepsActiveLease(t *testing.T) {
	db, d, gate, releaseActive := activeCohortPoll(t)
	d.blocked = true
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, release, err := AcquireRequestBarrier(WithRequestBarrierBudget(ctx), db)
	elapsed := time.Since(start)
	if err == nil || release != nil || elapsed > 120*time.Millisecond || elapsed < 10*time.Millisecond || d.polls != 1 {
		t.Fatal("blocked active poll escaped budget or was not reached", err, elapsed, d.polls)
	}
	if gate.active != 1 || d.inTransaction || d.rollbacks != 1 || db.Stats().InUse != 1 || d.closed.Load() != 0 || d.locks.Load() != 1 {
		t.Fatal("poll timeout damaged active lifecycle lease", gate.active, d, db.Stats())
	}
	d.blocked = false
	ctx, finish := context.WithTimeout(context.Background(), time.Second)
	defer finish()
	_, release, err = AcquireRequestBarrier(WithRequestBarrierBudget(ctx), db)
	if err != nil || d.polls != 2 || d.closed.Load() != 0 || d.locks.Load() != 1 {
		t.Fatal("following poll did not reuse active session", err, d)
	}
	if err := release(); err != nil {
		t.Fatal(err)
	}
	if err := releaseActive(); err != nil || db.Stats().InUse != 0 {
		t.Fatal("lifecycle slot leaked", err, db.Stats())
	}
}
