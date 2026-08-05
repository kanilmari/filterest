// with_lazy_transaction_test.go
// Regression tests for HTTP-status-aware request transaction finalization.
// Exercises handlers, lazy SQL transactions, and response status capture without a live database.
// Exists to prove failed REVOKE/UPDATE work rolls back while successful requests still commit.
package lazy_transaction

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	e_sessions "easelect/backend/core_components/sessions"
)

type requestTransactionDriverState struct {
	mu sync.Mutex

	beginCount    int
	commitCount   int
	rollbackCount int
	execQueries   []string
}

type requestTransactionSnapshot struct {
	beginCount    int
	commitCount   int
	rollbackCount int
	execQueries   []string
}

type requestTransactionDriver struct {
	state *requestTransactionDriverState
}

type requestTransactionConn struct {
	state *requestTransactionDriverState
}

type requestTransactionTx struct {
	state *requestTransactionDriverState
}

type requestTransactionRows struct{}

var requestTransactionDriverCounter int64

func (driverImpl *requestTransactionDriver) Open(string) (driver.Conn, error) {
	return &requestTransactionConn{state: driverImpl.state}, nil
}

func (*requestTransactionConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("prepare is not implemented in request transaction test driver")
}

func (*requestTransactionConn) Close() error {
	return nil
}

func (conn *requestTransactionConn) Begin() (driver.Tx, error) {
	return conn.BeginTx(context.Background(), driver.TxOptions{})
}

func (conn *requestTransactionConn) BeginTx(context.Context, driver.TxOptions) (driver.Tx, error) {
	conn.state.mu.Lock()
	conn.state.beginCount++
	conn.state.mu.Unlock()
	return &requestTransactionTx{state: conn.state}, nil
}

func (conn *requestTransactionConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	conn.state.mu.Lock()
	conn.state.execQueries = append(conn.state.execQueries, query)
	conn.state.mu.Unlock()
	return driver.RowsAffected(1), nil
}

func (*requestTransactionConn) QueryContext(context.Context, string, []driver.NamedValue) (driver.Rows, error) {
	return &requestTransactionRows{}, nil
}

func (tx *requestTransactionTx) Commit() error {
	tx.state.mu.Lock()
	tx.state.commitCount++
	tx.state.mu.Unlock()
	return nil
}

func (tx *requestTransactionTx) Rollback() error {
	tx.state.mu.Lock()
	tx.state.rollbackCount++
	tx.state.mu.Unlock()
	return nil
}

func (*requestTransactionRows) Columns() []string {
	return []string{"id"}
}

func (*requestTransactionRows) Close() error {
	return nil
}

func (*requestTransactionRows) Next([]driver.Value) error {
	return io.EOF
}

func openRequestTransactionTestDB(t *testing.T) (*sql.DB, *requestTransactionDriverState) {
	t.Helper()
	state := &requestTransactionDriverState{}
	driverName := fmt.Sprintf(
		"easelect-request-transaction-%d-%d",
		time.Now().UnixNano(),
		atomic.AddInt64(&requestTransactionDriverCounter, 1),
	)
	sql.Register(driverName, &requestTransactionDriver{state: state})

	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open() returned error: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})
	return db, state
}

func installRequestTransactionTestRuntime(t *testing.T, db *sql.DB) {
	t.Helper()
	originalDB := backend.Db
	originalGuestDB := backend.DbGuest
	originalStore := e_sessions.Store
	originalSessionName := e_sessions.SessionName

	backend.Db = db
	backend.DbGuest = db
	e_sessions.Store = nil
	t.Setenv("SESSION_KEY", "12345678901234567890123456789012")
	t.Setenv("SESSION_SECRET_KEY", "abcdefghijklmnopqrstuvwxyz123456")
	t.Setenv("INSTANCE_NAME", "")
	e_sessions.InitSessionStore()

	t.Cleanup(func() {
		backend.Db = originalDB
		backend.DbGuest = originalGuestDB
		e_sessions.Store = originalStore
		e_sessions.SessionName = originalSessionName
	})
}

func snapshotRequestTransactionState(state *requestTransactionDriverState) requestTransactionSnapshot {
	state.mu.Lock()
	defer state.mu.Unlock()
	return requestTransactionSnapshot{
		beginCount:    state.beginCount,
		commitCount:   state.commitCount,
		rollbackCount: state.rollbackCount,
		execQueries:   append([]string(nil), state.execQueries...),
	}
}

func queryListContains(queries []string, fragment string) bool {
	for _, query := range queries {
		if strings.Contains(query, fragment) {
			return true
		}
	}
	return false
}

func runRequestTransactionHandler(t *testing.T, statusCode int, mutationSQL string) requestTransactionSnapshot {
	t.Helper()
	db, state := openRequestTransactionTestDB(t)
	installRequestTransactionTestRuntime(t, db)

	var handlerErr error
	handler := WithLazyTx(func(w http.ResponseWriter, r *http.Request) {
		tx, ok := dbutils.RequireTx(r.Context())
		if !ok {
			handlerErr = errors.New("request transaction was not available")
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		_, handlerErr = tx.Exec(mutationSQL)
		w.WriteHeader(statusCode)
	})

	request := httptest.NewRequest(http.MethodPost, "https://example.com/api/test-atomicity", nil)
	actor := dbutils.NewRequestActorContext(1, "guest")
	request = request.WithContext(dbutils.SetRequestActorContext(request.Context(), actor))
	response := httptest.NewRecorder()
	handler(response, request)

	if handlerErr != nil {
		t.Fatalf("transaction-backed handler returned error: %v", handlerErr)
	}
	if response.Code != statusCode {
		t.Fatalf("response status = %d, want %d", response.Code, statusCode)
	}
	return snapshotRequestTransactionState(state)
}

func TestWithLazyTxRollsBackRevokeOnForbiddenResponse(t *testing.T) {
	state := runRequestTransactionHandler(
		t,
		http.StatusForbidden,
		"REVOKE UPDATE ON sample_table FROM sample_role",
	)

	if state.beginCount != 1 || state.commitCount != 0 || state.rollbackCount != 1 {
		t.Fatalf("transaction counts = begin:%d commit:%d rollback:%d, want 1/0/1", state.beginCount, state.commitCount, state.rollbackCount)
	}
	if !queryListContains(state.execQueries, "REVOKE UPDATE") {
		t.Fatalf("exec queries = %v, want REVOKE mutation", state.execQueries)
	}
}

func TestWithLazyTxRollsBackUpdateOnServerErrorResponse(t *testing.T) {
	state := runRequestTransactionHandler(
		t,
		http.StatusInternalServerError,
		"UPDATE sample_table SET title = 'partial' WHERE id = 1",
	)

	if state.beginCount != 1 || state.commitCount != 0 || state.rollbackCount != 1 {
		t.Fatalf("transaction counts = begin:%d commit:%d rollback:%d, want 1/0/1", state.beginCount, state.commitCount, state.rollbackCount)
	}
	if !queryListContains(state.execQueries, "UPDATE sample_table") {
		t.Fatalf("exec queries = %v, want UPDATE mutation", state.execQueries)
	}
}

func TestWithLazyTxCommitsSuccessfulAndRedirectResponses(t *testing.T) {
	for _, statusCode := range []int{http.StatusOK, http.StatusCreated, http.StatusSeeOther} {
		t.Run(http.StatusText(statusCode), func(t *testing.T) {
			state := runRequestTransactionHandler(
				t,
				statusCode,
				"UPDATE sample_table SET title = 'complete' WHERE id = 1",
			)

			if state.beginCount != 1 || state.commitCount != 1 || state.rollbackCount != 0 {
				t.Fatalf("transaction counts = begin:%d commit:%d rollback:%d, want 1/1/0", state.beginCount, state.commitCount, state.rollbackCount)
			}
		})
	}
}

func TestWithLazyTxDoesNotOpenTransactionForNonMutatingHandler(t *testing.T) {
	db, state := openRequestTransactionTestDB(t)
	installRequestTransactionTestRuntime(t, db)

	handler := WithLazyTx(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
	})
	request := httptest.NewRequest(http.MethodGet, "https://example.com/api/read-only", nil)
	request = request.WithContext(dbutils.SetRequestActorContext(
		request.Context(),
		dbutils.NewRequestActorContext(1, "guest"),
	))
	handler(httptest.NewRecorder(), request)

	snapshot := snapshotRequestTransactionState(state)
	if snapshot.beginCount != 0 || snapshot.commitCount != 0 || snapshot.rollbackCount != 0 {
		t.Fatalf("transaction counts = begin:%d commit:%d rollback:%d, want no transaction", snapshot.beginCount, snapshot.commitCount, snapshot.rollbackCount)
	}
}
