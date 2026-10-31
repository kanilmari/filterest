// transaction_admission_budget_test.go
// Proves Home's remaining deadline reaches real lazy middleware admission.
// Records lifecycle-pool acquisition, shared lock execution and work BeginTx contexts.
// Keeps ordinary admission's five-second allowance and original transaction lifetime.
package middlewares

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/runtime_grants"
)

type admissionBudgetDriver struct {
	connect, lock, begin context.Context
	block                bool
}
type admissionBudgetConn struct {
	loadConn
	state *admissionBudgetDriver
}

func (d *admissionBudgetDriver) Connect(ctx context.Context) (driver.Conn, error) {
	d.connect = ctx
	return &admissionBudgetConn{state: d}, nil
}
func (d *admissionBudgetDriver) Driver() driver.Driver { return d }
func (d *admissionBudgetDriver) Open(string) (driver.Conn, error) {
	return d.Connect(context.Background())
}
func (c *admissionBudgetConn) BeginTx(ctx context.Context, _ driver.TxOptions) (driver.Tx, error) {
	c.state.begin = ctx
	return loadTx{}, nil
}
func (c *admissionBudgetConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	if query == `SELECT pg_advisory_lock_shared(hashtext($1))` {
		c.state.lock = ctx
		if c.state.block {
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(300 * time.Millisecond):
				return nil, errors.New("admission escaped Home budget")
			}
		}
	}
	return c.loadConn.ExecContext(ctx, query, args)
}

func admissionBudgetPools(t *testing.T) (*sql.DB, *sql.DB, *admissionBudgetDriver, *admissionBudgetDriver) {
	t.Helper()
	workState, lifecycleState := &admissionBudgetDriver{}, &admissionBudgetDriver{}
	work, lifecycle := sql.OpenDB(workState), sql.OpenDB(lifecycleState)
	work.SetMaxOpenConns(1)
	lifecycle.SetMaxOpenConns(1)
	oldDB, oldBasic := backend.Db, backend.DbBasic
	backend.Db, backend.DbBasic = work, work
	t.Cleanup(func() {
		backend.Db, backend.DbBasic = oldDB, oldBasic
		work.Close()
		lifecycle.Close()
	})
	return work, lifecycle, workState, lifecycleState
}

func TestLazyTransactionAdmissionReceivesHomeDeadline(t *testing.T) {
	for _, home := range []bool{true, false} {
		name := "ordinary"
		if home {
			name = "home"
		}
		t.Run(name, func(t *testing.T) {
			work, lifecycle, workState, lifecycleState := admissionBudgetPools(t)
			type requestKey struct{}
			parent, finish := context.WithTimeout(context.Background(), time.Minute)
			defer finish()
			parent = context.WithValue(parent, requestKey{}, "original request")
			var operation context.Context
			committed := false
			handler := WithLazyTransaction(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
				ctx := request.Context()
				var cancel context.CancelFunc
				if home {
					operation, cancel = context.WithTimeout(ctx, time.Second)
					defer cancel()
					ctx = dbutils.WithReadBudget(ctx, operation)
				}
				tx, err := dbutils.RequireTxWithError(ctx)
				if err != nil {
					t.Fatal(err)
				}
				if workState.begin != ctx || workState.begin.Done() != parent.Done() {
					t.Fatal("operation context reached BeginTx")
				}
				for _, admitted := range []context.Context{lifecycleState.connect, lifecycleState.lock} {
					if admitted == nil || admitted.Value(requestKey{}) != "original request" {
						t.Fatal("admission lost original request values")
					}
					deadline, ok := admitted.Deadline()
					if !ok {
						t.Fatal("admission has no deadline")
					}
					if home {
						want, _ := operation.Deadline()
						if deadline != want {
							t.Fatal("Home admission did not receive remaining operation deadline", deadline, want)
						}
					} else if remaining := time.Until(deadline); remaining < 4*time.Second || remaining > 5*time.Second {
						t.Fatal("ordinary admission lost its existing five-second allowance", remaining)
					}
				}
				if home {
					cancel()
				}
				if _, err := tx.ExecContext(request.Context(), "following read"); err != nil {
					t.Fatal("Home budget ended request transaction", err)
				}
				if !dbutils.RegisterAfterCommitHook(request.Context(), func() { committed = true }) {
					t.Fatal("missing middleware transaction")
				}
				w.WriteHeader(http.StatusNoContent)
			}))
			request := httptest.NewRequest("GET", "/api/front-page", nil)
			response := httptest.NewRecorder()
			err := runtime_grants.WithLazyRequestBarrier(parent, lifecycle, func(ctx context.Context) {
				ctx = dbutils.SetRequestActorContext(ctx, dbutils.NewRequestActorContext(42, "basic"))
				handler.ServeHTTP(response, request.WithContext(ctx))
			})
			if err != nil || response.Code != http.StatusNoContent || !committed || work.Stats().InUse != 0 || lifecycle.Stats().InUse != 0 {
				t.Fatal("admission/work connection leaked or request did not commit", err, response.Code, committed)
			}
		})
	}
}

func TestLazyTransactionAdmissionTimeoutLeavesTransactionLazy(t *testing.T) {
	for _, phase := range []string{"pool", "shared lock"} {
		t.Run(phase, func(t *testing.T) {
			work, lifecycle, workState, lifecycleState := admissionBudgetPools(t)
			var held *sql.Conn
			if phase == "pool" {
				var err error
				held, err = lifecycle.Conn(context.Background())
				if err != nil {
					t.Fatal(err)
				}
				defer held.Close()
			} else {
				lifecycleState.block = true
			}
			handler := WithLazyTransaction(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
				budget, cancel := context.WithTimeout(request.Context(), 20*time.Millisecond)
				defer cancel()
				_, err := dbutils.RequireTxWithError(dbutils.WithReadBudget(request.Context(), budget))
				if !errors.Is(err, context.DeadlineExceeded) {
					t.Fatal("admission ignored Home deadline", err)
				}
				if _, open := dbutils.PeekTx(request.Context()); open || request.Context().Err() != nil || workState.begin != nil {
					t.Fatal("failed admission opened transaction or cancelled original request")
				}
				w.WriteHeader(http.StatusNoContent)
			}))
			request := httptest.NewRequest("GET", "/api/front-page", nil)
			start := time.Now()
			err := runtime_grants.WithLazyRequestBarrier(request.Context(), lifecycle, func(ctx context.Context) {
				ctx = dbutils.SetRequestActorContext(ctx, dbutils.NewRequestActorContext(42, "basic"))
				handler.ServeHTTP(httptest.NewRecorder(), request.WithContext(ctx))
			})
			if held != nil {
				held.Close()
			}
			if err != nil || time.Since(start) > 200*time.Millisecond || work.Stats().InUse != 0 || lifecycle.Stats().InUse != 0 {
				t.Fatal("timed-out admission leaked or exceeded budget", err, work.Stats(), lifecycle.Stats())
			}
		})
	}
}
