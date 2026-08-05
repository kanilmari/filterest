// request_logging_test.go
// Unit tests for the request-logging pipeline stage.
// Covers the branch logic between HTTP requests, session lookup, optional user/group DB lookups, and log output so the monitoring middleware can be refactored more safely without changing production behavior or requiring a live database.
package request_logging

import (
	"bytes"
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/logging"
	e_sessions "easelect/backend/core_components/sessions"

	"github.com/gorilla/sessions"
)

const (
	requestLoggingSessionKey       = "12345678901234567890123456789012"
	requestLoggingSessionSecretKey = "abcdefghijklmnopqrstuvwxyz123456"
)

type requestLogMockConfig struct {
	userLookupOK  bool
	userName      string
	groupQueryErr error
	groups        []string
}

type requestLogMockDriver struct{ cfg requestLogMockConfig }
type requestLogMockConn struct{ cfg requestLogMockConfig }
type requestLogMockTx struct{}

type requestLogMockRows struct {
	cols []string
	rows [][]driver.Value
	idx  int
}

var requestLogMockCounter int64

func (d *requestLogMockDriver) Open(string) (driver.Conn, error) {
	return &requestLogMockConn{cfg: d.cfg}, nil
}

func (c *requestLogMockConn) Prepare(string) (driver.Stmt, error) {
	return nil, fmt.Errorf("prepare not supported")
}

func (c *requestLogMockConn) Close() error { return nil }

func (c *requestLogMockConn) Begin() (driver.Tx, error) {
	return &requestLogMockTx{}, nil
}

func (t *requestLogMockTx) Commit() error   { return nil }
func (t *requestLogMockTx) Rollback() error { return nil }

func (r *requestLogMockRows) Columns() []string { return r.cols }
func (r *requestLogMockRows) Close() error      { return nil }

func (r *requestLogMockRows) Next(dest []driver.Value) error {
	if r.idx >= len(r.rows) {
		return io.EOF
	}
	copy(dest, r.rows[r.idx])
	r.idx++
	return nil
}

func (c *requestLogMockConn) Query(query string, args []driver.Value) (driver.Rows, error) {
	named := make([]driver.NamedValue, len(args))
	for i, v := range args {
		named[i] = driver.NamedValue{Ordinal: i + 1, Value: v}
	}
	return c.QueryContext(context.Background(), query, named)
}

func (c *requestLogMockConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	switch {
	case strings.Contains(query, "SELECT username FROM system_users"):
		if !c.cfg.userLookupOK {
			return &requestLogMockRows{cols: []string{"username"}}, nil
		}
		return &requestLogMockRows{
			cols: []string{"username"},
			rows: [][]driver.Value{{c.cfg.userName}},
		}, nil

	case strings.Contains(query, "FROM system_user_groups g"):
		if c.cfg.groupQueryErr != nil {
			return nil, c.cfg.groupQueryErr
		}
		rows := make([][]driver.Value, 0, len(c.cfg.groups))
		for _, group := range c.cfg.groups {
			rows = append(rows, []driver.Value{group})
		}
		return &requestLogMockRows{
			cols: []string{"name"},
			rows: rows,
		}, nil

	default:
		return nil, fmt.Errorf("unexpected query: %s", query)
	}
}

func openRequestLogMockDB(t *testing.T, cfg requestLogMockConfig) *sql.DB {
	t.Helper()
	driverName := fmt.Sprintf("request_logging_%d_%d", time.Now().UnixNano(), atomic.AddInt64(&requestLogMockCounter, 1))
	sql.Register(driverName, &requestLogMockDriver{cfg: cfg})
	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open mock: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})
	return db
}

func initRequestLoggingSessionStore(t *testing.T) {
	t.Helper()
	e_sessions.Store = nil
	e_sessions.SessionName = "session"
	t.Setenv("SESSION_KEY", requestLoggingSessionKey)
	t.Setenv("SESSION_SECRET_KEY", requestLoggingSessionSecretKey)
	t.Setenv("INSTANCE_NAME", "")
	e_sessions.InitSessionStore()
	t.Cleanup(func() {
		e_sessions.Store = nil
		e_sessions.SessionName = "session"
	})
}

func newRequestLogRequestWithSession(t *testing.T, mutate func(*sessions.Session)) *http.Request {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "https://example.com/api/data?dataset=people", nil)
	rec := httptest.NewRecorder()
	session, err := e_sessions.Store.Get(req, e_sessions.SessionName)
	if err != nil {
		t.Fatalf("Store.Get returned error: %v", err)
	}
	mutate(session)
	if err := session.Save(req, rec); err != nil {
		t.Fatalf("session.Save returned error: %v", err)
	}
	for _, cookie := range rec.Result().Cookies() {
		req.AddCookie(cookie)
	}
	return req
}

func withCapturedLogs(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	logging.SetOutput(&buf)
	t.Cleanup(func() {
		logging.SetOutput(os.Stderr)
	})
	return &buf
}

func TestLogUserRequest_StaticFileBypassesLogging(t *testing.T) {
	t.Setenv("REQUEST_LOGGING_DEBUG", "true")
	logBuf := withCapturedLogs(t)
	calls := 0

	handler := LogUserRequest(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.WriteHeader(http.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodGet, "https://example.com/frontend/app.css", nil)
	rec := httptest.NewRecorder()
	handler(rec, req)

	if calls != 1 {
		t.Fatalf("handler call count = %d, want 1", calls)
	}
	if logBuf.Len() != 0 {
		t.Fatalf("log output = %q, want no logging for static file", logBuf.String())
	}
}

func TestLogUserRequest_DebugDisabledBypassesLogging(t *testing.T) {
	t.Setenv("REQUEST_LOGGING_DEBUG", "false")
	logBuf := withCapturedLogs(t)
	calls := 0

	handler := LogUserRequest(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.WriteHeader(http.StatusAccepted)
	})

	req := httptest.NewRequest(http.MethodGet, "https://example.com/api/data", nil)
	rec := httptest.NewRecorder()
	handler(rec, req)

	if calls != 1 {
		t.Fatalf("handler call count = %d, want 1", calls)
	}
	if logBuf.Len() != 0 {
		t.Fatalf("log output = %q, want no logging when debug=false", logBuf.String())
	}
}

func TestLogUserRequest_LogsAnonymousSession(t *testing.T) {
	t.Setenv("REQUEST_LOGGING_DEBUG", "true")
	initRequestLoggingSessionStore(t)
	logBuf := withCapturedLogs(t)
	calls := 0

	handler := LogUserRequest(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.WriteHeader(http.StatusOK)
	})

	req := newRequestLogRequestWithSession(t, func(session *sessions.Session) {})
	rec := httptest.NewRecorder()
	handler(rec, req)

	if calls != 1 {
		t.Fatalf("handler call count = %d, want 1", calls)
	}
	logOutput := logBuf.String()
	if !strings.Contains(logOutput, `msg="request observed"`) ||
		!strings.Contains(logOutput, "auth_state=anonymous") ||
		!strings.Contains(logOutput, "dataset=people") {
		t.Fatalf("log output = %q, want structured anonymous dataset log", logOutput)
	}
}

func TestLogUserRequest_LogsInvalidUserIDType(t *testing.T) {
	t.Setenv("REQUEST_LOGGING_DEBUG", "true")
	initRequestLoggingSessionStore(t)
	logBuf := withCapturedLogs(t)

	handler := LogUserRequest(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	req := newRequestLogRequestWithSession(t, func(session *sessions.Session) {
		session.Values["user_id"] = "not-an-int"
	})
	rec := httptest.NewRecorder()
	handler(rec, req)

	if !strings.Contains(logBuf.String(), `msg="request logging user_id invalid"`) {
		t.Fatalf("log output = %q, want structured invalid user_id log", logBuf.String())
	}
}

func TestLogUserRequest_LogsUserLookupFailure(t *testing.T) {
	t.Setenv("REQUEST_LOGGING_DEBUG", "true")
	initRequestLoggingSessionStore(t)
	logBuf := withCapturedLogs(t)

	origDB := backend.Db
	backend.Db = openRequestLogMockDB(t, requestLogMockConfig{userLookupOK: false})
	t.Cleanup(func() {
		backend.Db = origDB
	})

	handler := LogUserRequest(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	req := newRequestLogRequestWithSession(t, func(session *sessions.Session) {
		session.Values["user_id"] = 42
	})
	rec := httptest.NewRecorder()
	handler(rec, req)

	if !strings.Contains(logBuf.String(), `msg="request logging username lookup failed"`) {
		t.Fatalf("log output = %q, want structured username lookup error log", logBuf.String())
	}
}

func TestLogUserRequest_LogsUserAndGroups(t *testing.T) {
	t.Setenv("REQUEST_LOGGING_DEBUG", "true")
	initRequestLoggingSessionStore(t)
	logBuf := withCapturedLogs(t)

	origDB := backend.Db
	backend.Db = openRequestLogMockDB(t, requestLogMockConfig{
		userLookupOK: true,
		userName:     "alice",
		groups:       []string{"admins", "editors"},
	})
	t.Cleanup(func() {
		backend.Db = origDB
	})

	handler := LogUserRequest(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	req := newRequestLogRequestWithSession(t, func(session *sessions.Session) {
		session.Values["user_id"] = 42
	})
	rec := httptest.NewRecorder()
	handler(rec, req)

	logOutput := logBuf.String()
	if !strings.Contains(logOutput, `msg="request observed"`) ||
		!strings.Contains(logOutput, "username=alice") ||
		!strings.Contains(logOutput, "group_count=2") ||
		!strings.Contains(logOutput, `groups="[admins editors]"`) {
		t.Fatalf("log output = %q, want structured user and groups log", logOutput)
	}
}

func TestLogUserRequest_LogsGroupQueryFailure(t *testing.T) {
	t.Setenv("REQUEST_LOGGING_DEBUG", "true")
	initRequestLoggingSessionStore(t)
	logBuf := withCapturedLogs(t)

	origDB := backend.Db
	backend.Db = openRequestLogMockDB(t, requestLogMockConfig{
		userLookupOK:  true,
		userName:      "alice",
		groupQueryErr: fmt.Errorf("group lookup failed"),
	})
	t.Cleanup(func() {
		backend.Db = origDB
	})

	handler := LogUserRequest(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	req := newRequestLogRequestWithSession(t, func(session *sessions.Session) {
		session.Values["user_id"] = 42
	})
	rec := httptest.NewRecorder()
	handler(rec, req)

	if !strings.Contains(logBuf.String(), `msg="request logging group lookup failed"`) {
		t.Fatalf("log output = %q, want structured group fetch error log", logBuf.String())
	}
}
