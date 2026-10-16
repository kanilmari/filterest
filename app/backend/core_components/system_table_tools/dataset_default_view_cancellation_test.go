// dataset_default_view_cancellation_test.go
// Proves an interrupted default-view request releases its transaction and connection.
// Drives the real handler and database/sql with a cancellable, blocked SQL driver.
// Covers waiting for a row lock and metadata work while already holding that lock.
package system_table_tools

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"easelect/backend/core_components/dbutils"
)

type defaultViewCancellationState struct {
	afterLock bool
	started   chan struct{}
	release   chan struct{}
	rollback  chan struct{}
	limits    atomic.Bool
	committed atomic.Bool
}
type defaultViewCancellationConnector struct{ state *defaultViewCancellationState }
type defaultViewCancellationConn struct{ state *defaultViewCancellationState }
type defaultViewCancellationTx struct{ state *defaultViewCancellationState }

func (c defaultViewCancellationConnector) Connect(context.Context) (driver.Conn, error) {
	return defaultViewCancellationConn{c.state}, nil
}
func (c defaultViewCancellationConnector) Driver() driver.Driver { return c }
func (c defaultViewCancellationConnector) Open(string) (driver.Conn, error) {
	return c.Connect(context.Background())
}
func (c defaultViewCancellationConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepare")
}
func (c defaultViewCancellationConn) Close() error { return nil }
func (c defaultViewCancellationConn) Begin() (driver.Tx, error) {
	return defaultViewCancellationTx{c.state}, nil
}
func (tx defaultViewCancellationTx) Commit() error {
	tx.state.committed.Store(true)
	return nil
}
func (tx defaultViewCancellationTx) Rollback() error {
	close(tx.state.rollback)
	return nil
}
func (c defaultViewCancellationConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	if !strings.Contains(query, "SET LOCAL lock_timeout") || !strings.Contains(query, "SET LOCAL statement_timeout") {
		return nil, fmt.Errorf("unexpected execution: %s", query)
	}
	c.state.limits.Store(true)
	return driver.RowsAffected(0), nil
}
func (c defaultViewCancellationConn) QueryContext(ctx context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	if strings.Contains(query, "admin_access_allowed") {
		return &rowGroupSQLRows{rows: [][]driver.Value{{true}}, columns: 1}, nil
	}
	if strings.Contains(query, "SELECT table_uid FROM public.system_db_tables") {
		if !c.state.limits.Load() || !strings.Contains(query, "FOR UPDATE") {
			return nil, errors.New("row lock was not bounded before acquisition")
		}
		if c.state.afterLock {
			return &rowGroupSQLRows{rows: [][]driver.Value{{int64(162)}}, columns: 1}, nil
		}
	} else if !strings.Contains(query, "SELECT tables.default_view_id") {
		return nil, fmt.Errorf("unexpected query: %s", query)
	}
	close(c.state.started)
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-c.state.release:
		return nil, errors.New("test released an uncancelled query")
	}
}

func TestDatasetDefaultViewCancellation(t *testing.T) {
	for _, afterLock := range []bool{false, true} {
		name := "waiting for row lock"
		if afterLock {
			name = "metadata while holding row lock"
		}
		t.Run(name, func(t *testing.T) {
			state := &defaultViewCancellationState{afterLock: afterLock,
				started: make(chan struct{}), release: make(chan struct{}), rollback: make(chan struct{})}
			db := sql.OpenDB(defaultViewCancellationConnector{state})
			db.SetMaxOpenConns(1)
			t.Cleanup(func() { db.Close() })
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			lazy := dbutils.NewLazyTx(db)
			defer lazy.Rollback()
			var invalidated atomic.Bool
			lazy.AddAfterCommitHook(func() { invalidated.Store(true) })
			request := datasetSortRequestWithUser(t, http.MethodPost, "/api/admin/dataset-default-view",
				`{"dataset":"owned_default_view","view_key":"calendar"}`, 42)
			request = request.WithContext(dbutils.SetLazyTx(ctx, lazy))
			response := httptest.NewRecorder()
			done := make(chan struct{})
			go func() { defer close(done); DatasetDefaultViewHandler(response, request) }()
			// Also release a regressed background-context query before closing the DB.
			defer func() {
				cancel()
				close(state.release)
				select {
				case <-done:
				case <-time.After(time.Second):
					t.Error("handler remained blocked after cancellation")
				}
			}()
			select {
			case <-state.started:
			case <-time.After(time.Second):
				t.Fatal("handler never reached the row-lock phase")
			}
			cancel()
			select {
			case <-done:
			case <-time.After(time.Second):
				t.Fatal("SQL query ignored request cancellation")
			}
			select {
			case <-state.rollback:
			case <-time.After(time.Second):
				t.Fatal("cancelled request left its transaction open")
			}
			if state.committed.Load() || invalidated.Load() || response.Code != http.StatusInternalServerError {
				t.Fatal("cancelled request committed, invalidated the cache or returned success", response.Code)
			}
			if err := lazy.Commit(); err == nil {
				t.Fatal("an abandoned request could still commit")
			}
			// Acquiring the sole slot proves rollback released the work connection.
			probeCtx, stop := context.WithTimeout(context.Background(), time.Second)
			defer stop()
			conn, err := db.Conn(probeCtx)
			if err != nil {
				t.Fatal("cancelled request leaked its connection", err)
			}
			conn.Close()
		})
	}
}
