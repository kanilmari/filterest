// transaction_result_saver_test.go
// Unit tests for transaction outcome logging.
// Covers session-derived user context, function-id lookup behavior, and insert/logging error branches so tx-result persistence can be refactored safely without a live database.
package txlog

import (
	"bytes"
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/logging"
	e_sessions "easelect/backend/core_components/sessions"

	"github.com/gorilla/sessions"
)

const (
	txlogTestSessionKey       = "12345678901234567890123456789012"
	txlogTestSessionSecretKey = "abcdefghijklmnopqrstuvwxyz123456"
)

type txlogMockConfig struct {
	queryRows [][]driver.Value
	queryErr  error
	execErr   error
}

type txlogMockState struct {
	mu sync.Mutex

	cfg       txlogMockConfig
	lastQuery string
	queryArgs []driver.NamedValue
	lastExec  string
	execArgs  []driver.NamedValue
}

type txlogMockDriver struct{ state *txlogMockState }
type txlogMockConn struct{ state *txlogMockState }

type txlogMockRows struct {
	cols []string
	rows [][]driver.Value
	idx  int
}

var txlogMockCounter int64

func (d *txlogMockDriver) Open(string) (driver.Conn, error) {
	return &txlogMockConn{state: d.state}, nil
}

func (c *txlogMockConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("prepare not implemented in txlog mock")
}

func (c *txlogMockConn) Close() error { return nil }

func (c *txlogMockConn) Begin() (driver.Tx, error) {
	return nil, errors.New("transactions not implemented in txlog mock")
}

func (r *txlogMockRows) Columns() []string { return r.cols }
func (r *txlogMockRows) Close() error      { return nil }

func (r *txlogMockRows) Next(dest []driver.Value) error {
	if r.idx >= len(r.rows) {
		return io.EOF
	}
	copy(dest, r.rows[r.idx])
	r.idx++
	return nil
}

func (c *txlogMockConn) Query(query string, args []driver.Value) (driver.Rows, error) {
	named := make([]driver.NamedValue, len(args))
	for i, arg := range args {
		named[i] = driver.NamedValue{Ordinal: i + 1, Value: arg}
	}
	return c.QueryContext(context.Background(), query, named)
}

func (c *txlogMockConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	c.state.mu.Lock()
	c.state.lastQuery = query
	c.state.queryArgs = append([]driver.NamedValue(nil), args...)
	cfg := c.state.cfg
	c.state.mu.Unlock()

	if cfg.queryErr != nil {
		return nil, cfg.queryErr
	}

	return &txlogMockRows{
		cols: []string{"id"},
		rows: cloneTxlogRows(cfg.queryRows),
	}, nil
}

func (c *txlogMockConn) Exec(query string, args []driver.Value) (driver.Result, error) {
	named := make([]driver.NamedValue, len(args))
	for i, arg := range args {
		named[i] = driver.NamedValue{Ordinal: i + 1, Value: arg}
	}
	return c.ExecContext(context.Background(), query, named)
}

func (c *txlogMockConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	c.state.mu.Lock()
	c.state.lastExec = query
	c.state.execArgs = append([]driver.NamedValue(nil), args...)
	cfg := c.state.cfg
	c.state.mu.Unlock()

	if cfg.execErr != nil {
		return nil, cfg.execErr
	}

	return driver.RowsAffected(1), nil
}

func cloneTxlogRows(rows [][]driver.Value) [][]driver.Value {
	cloned := make([][]driver.Value, len(rows))
	for i, row := range rows {
		cloned[i] = append([]driver.Value(nil), row...)
	}
	return cloned
}

func openTxlogMockDB(t *testing.T, cfg txlogMockConfig) (*sql.DB, *txlogMockState) {
	t.Helper()
	state := &txlogMockState{cfg: cfg}
	driverName := fmt.Sprintf("txlog_%d_%d", time.Now().UnixNano(), atomic.AddInt64(&txlogMockCounter, 1))
	sql.Register(driverName, &txlogMockDriver{state: state})

	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open returned error: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})
	return db, state
}

func initTxlogSessionStore(t *testing.T) {
	t.Helper()
	e_sessions.Store = nil
	e_sessions.SessionName = "session"
	t.Setenv("SESSION_KEY", txlogTestSessionKey)
	t.Setenv("SESSION_SECRET_KEY", txlogTestSessionSecretKey)
	t.Setenv("INSTANCE_NAME", "")
	e_sessions.InitSessionStore()
	t.Cleanup(func() {
		e_sessions.Store = nil
		e_sessions.SessionName = "session"
	})
}

func newTxlogRequestWithSession(t *testing.T, method, path string, mutate func(*sessions.Session)) *http.Request {
	t.Helper()
	req := httptest.NewRequest(method, "https://example.com"+path, nil)
	rec := httptest.NewRecorder()
	session, err := e_sessions.Store.Get(req, e_sessions.SessionName)
	if err != nil {
		t.Fatalf("Store.Get returned error: %v", err)
	}
	if mutate != nil {
		mutate(session)
	}
	if err := session.Save(req, rec); err != nil {
		t.Fatalf("session.Save returned error: %v", err)
	}
	for _, cookie := range rec.Result().Cookies() {
		req.AddCookie(cookie)
	}
	return req
}

func captureTxlogOutput(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	logging.SetOutput(&buf)
	t.Cleanup(func() {
		logging.SetOutput(os.Stderr)
	})
	return &buf
}

func driverArgValues(args []driver.NamedValue) []driver.Value {
	values := make([]driver.Value, len(args))
	for i, arg := range args {
		values[i] = arg.Value
	}
	return values
}

func withTxlogDB(t *testing.T, db *sql.DB) {
	t.Helper()
	orig := backend.Db
	backend.Db = db
	t.Cleanup(func() {
		backend.Db = orig
	})
}

func TestShouldLogTransactionResult(t *testing.T) {
	tests := []struct {
		name    string
		method  string
		success bool
		want    bool
	}{
		{name: "successful get skipped", method: http.MethodGet, success: true, want: false},
		{name: "successful head skipped", method: http.MethodHead, success: true, want: false},
		{name: "failed get kept", method: http.MethodGet, success: false, want: true},
		{name: "successful post kept", method: http.MethodPost, success: true, want: true},
		{name: "successful patch kept", method: http.MethodPatch, success: true, want: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := shouldLogTransactionResult(tt.method, tt.success); got != tt.want {
				t.Fatalf("shouldLogTransactionResult(%q, %v) = %v, want %v", tt.method, tt.success, got, tt.want)
			}
		})
	}
}

func TestLogTransactionResult_InsertsResolvedContext(t *testing.T) {
	initTxlogSessionStore(t)
	db, state := openTxlogMockDB(t, txlogMockConfig{
		queryRows: [][]driver.Value{{int64(17)}},
	})
	withTxlogDB(t, db)
	logBuf := captureTxlogOutput(t)

	req := newTxlogRequestWithSession(t, http.MethodPost, "/api/widgets", func(session *sessions.Session) {
		session.Values["user_id"] = 42
		session.Values["username"] = "alice"
	})

	LogTransactionResult(req, true, nil)

	state.mu.Lock()
	defer state.mu.Unlock()

	if !strings.Contains(state.lastQuery, "SELECT id FROM system_functions") {
		t.Fatalf("lastQuery = %q, want function lookup query", state.lastQuery)
	}
	queryArgs := driverArgValues(state.queryArgs)
	if len(queryArgs) != 1 || queryArgs[0] != "/api/widgets" {
		t.Fatalf("queryArgs = %#v, want [/api/widgets]", queryArgs)
	}
	if !strings.Contains(state.lastExec, "INSERT INTO system_transaction_log") {
		t.Fatalf("lastExec = %q, want transaction log insert", state.lastExec)
	}

	execArgs := driverArgValues(state.execArgs)
	if len(execArgs) != 6 {
		t.Fatalf("execArgs len = %d, want 6", len(execArgs))
	}
	if execArgs[0] != int64(17) {
		t.Fatalf("function_id arg = %#v, want int64(17)", execArgs[0])
	}
	if execArgs[1] != "POST" {
		t.Fatalf("method arg = %#v, want POST", execArgs[1])
	}
	if execArgs[2] != int64(42) {
		t.Fatalf("user_id arg = %#v, want int64(42)", execArgs[2])
	}
	if execArgs[3] != "alice" {
		t.Fatalf("username arg = %#v, want alice", execArgs[3])
	}
	if execArgs[4] != true {
		t.Fatalf("success arg = %#v, want true", execArgs[4])
	}
	if execArgs[5] != nil {
		t.Fatalf("error_message arg = %#v, want nil", execArgs[5])
	}
	if logBuf.Len() != 0 {
		t.Fatalf("log output = %q, want no warnings", logBuf.String())
	}
}

func TestLogTransactionResult_SkipsSuccessfulGets(t *testing.T) {
	initTxlogSessionStore(t)
	db, state := openTxlogMockDB(t, txlogMockConfig{
		queryRows: [][]driver.Value{{int64(17)}},
	})
	withTxlogDB(t, db)

	req := httptest.NewRequest(http.MethodGet, "https://example.com/api/widgets", nil)

	LogTransactionResult(req, true, nil)

	state.mu.Lock()
	defer state.mu.Unlock()

	if state.lastQuery != "" {
		t.Fatalf("lastQuery = %q, want empty string for skipped successful GET", state.lastQuery)
	}
	if state.lastExec != "" {
		t.Fatalf("lastExec = %q, want empty string for skipped successful GET", state.lastExec)
	}
}

func TestLogTransactionResult_UsesNilFunctionIDAndErrorMessageWhenLookupMisses(t *testing.T) {
	initTxlogSessionStore(t)
	db, state := openTxlogMockDB(t, txlogMockConfig{
		queryRows: nil,
	})
	withTxlogDB(t, db)

	req := httptest.NewRequest(http.MethodDelete, "https://example.com/api/widgets/5", nil)

	LogTransactionResult(req, false, errors.New("rollback failed"))

	state.mu.Lock()
	defer state.mu.Unlock()

	execArgs := driverArgValues(state.execArgs)
	if len(execArgs) != 6 {
		t.Fatalf("execArgs len = %d, want 6", len(execArgs))
	}
	if execArgs[0] != nil {
		t.Fatalf("function_id arg = %#v, want nil when lookup returns no rows", execArgs[0])
	}
	if execArgs[1] != "DELETE" {
		t.Fatalf("method arg = %#v, want DELETE", execArgs[1])
	}
	if execArgs[2] != int64(0) {
		t.Fatalf("user_id arg = %#v, want int64(0) for missing session", execArgs[2])
	}
	if execArgs[3] != "" {
		t.Fatalf("username arg = %#v, want empty string", execArgs[3])
	}
	if execArgs[4] != false {
		t.Fatalf("success arg = %#v, want false", execArgs[4])
	}
	if execArgs[5] != "rollback failed" {
		t.Fatalf("error_message arg = %#v, want rollback failed", execArgs[5])
	}
}

func TestLogTransactionResult_LogsLookupAndInsertFailures(t *testing.T) {
	initTxlogSessionStore(t)
	db, state := openTxlogMockDB(t, txlogMockConfig{
		queryErr: errors.New("lookup exploded"),
		execErr:  errors.New("insert exploded"),
	})
	withTxlogDB(t, db)
	logBuf := captureTxlogOutput(t)

	req := newTxlogRequestWithSession(t, http.MethodPut, "/api/widgets/7", func(session *sessions.Session) {
		session.Values["user_id"] = 9
		session.Values["username"] = "bob"
	})

	LogTransactionResult(req, false, errors.New("tx failed"))

	state.mu.Lock()
	execArgs := driverArgValues(state.execArgs)
	state.mu.Unlock()

	if len(execArgs) != 6 {
		t.Fatalf("execArgs len = %d, want 6", len(execArgs))
	}
	if execArgs[0] != nil {
		t.Fatalf("function_id arg = %#v, want nil when lookup errors", execArgs[0])
	}

	logOutput := logBuf.String()
	if !strings.Contains(logOutput, `msg="transaction log function lookup failed"`) ||
		!strings.Contains(logOutput, `error="lookup exploded"`) {
		t.Fatalf("log output = %q, want structured lookup error line", logOutput)
	}
	if !strings.Contains(logOutput, `msg="transaction log insert failed"`) ||
		!strings.Contains(logOutput, `error="insert exploded"`) {
		t.Fatalf("log output = %q, want structured insert error line", logOutput)
	}
}
