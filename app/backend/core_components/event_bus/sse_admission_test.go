// sse_admission_test.go
// Keeps more real SSE loops open than admission-pool slots while serving HTTP.
// In-memory subscribers and a stub lifecycle driver need no sockets or database.
// An idle stream must release its initial middleware admission before flushing.
package event_bus

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/middlewares"
)

type streamLifecycleDriver struct{}
type streamLifecycleConn struct{}
type streamLifecycleRows struct{ sent bool }

func (d streamLifecycleDriver) Connect(context.Context) (driver.Conn, error) {
	return streamLifecycleConn{}, nil
}
func (d streamLifecycleDriver) Driver() driver.Driver { return d }
func (d streamLifecycleDriver) Open(string) (driver.Conn, error) {
	return d.Connect(context.Background())
}
func (streamLifecycleConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepare")
}
func (streamLifecycleConn) Close() error { return nil }
func (streamLifecycleConn) Begin() (driver.Tx, error) {
	return nil, errors.New("unexpected transaction")
}
func (streamLifecycleConn) ExecContext(context.Context, string, []driver.NamedValue) (driver.Result, error) {
	return driver.RowsAffected(1), nil
}
func (streamLifecycleConn) QueryContext(context.Context, string, []driver.NamedValue) (driver.Rows, error) {
	return &streamLifecycleRows{}, nil
}
func (*streamLifecycleRows) Columns() []string { return []string{"released"} }
func (*streamLifecycleRows) Close() error      { return nil }
func (r *streamLifecycleRows) Next(dest []driver.Value) error {
	if r.sent {
		return io.EOF
	}
	r.sent = true
	dest[0] = true
	return nil
}

type admittedStreamWriter struct {
	*httptest.ResponseRecorder
	ready chan struct{}
	once  sync.Once
}

func (w *admittedStreamWriter) Flush() { w.once.Do(func() { w.ready <- struct{}{} }) }

func TestIdleSSEStreamsBeyondPoolSlotsStillServeRequests(t *testing.T) {
	db := sql.OpenDB(streamLifecycleDriver{})
	defer db.Close()
	db.SetMaxOpenConns(2)
	oldLifecycle := backend.DbLifecycle
	backend.DbLifecycle = db
	defer func() { backend.DbLifecycle = oldLifecycle }()
	ctx, cancel := context.WithCancel(context.Background())
	finished := make(chan struct{}, 16)
	ready := make(chan struct{}, 16)
	defer func() {
		cancel()
		for i := 0; i < 16; i++ {
			<-finished
		}
	}()
	stream := middlewares.WithStartupRequestBarrier(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		serveSSESubscription(w, r, func(*http.Request, string) (int, error) { return 0, nil }, func(string) (<-chan Event, func()) { return make(chan Event), func() {} }, nil, nil, make(chan time.Time))
	}))
	for i := 0; i < 16; i++ {
		go func() {
			defer func() { finished <- struct{}{} }()
			req := httptest.NewRequest("GET", "/api/sse/subscribe?datasets=orders", nil).WithContext(ctx)
			stream.ServeHTTP(&admittedStreamWriter{ResponseRecorder: httptest.NewRecorder(), ready: ready}, req)
		}()
	}
	for i := 0; i < 16; i++ {
		select {
		case <-ready:
		case <-time.After(2 * time.Second):
			t.Fatal("stream admission saturated the pool")
		}
	}
	if db.Stats().InUse != 0 {
		t.Fatal("idle SSE loops retained admission sessions")
	}
	req := httptest.NewRequest("GET", "/api/new-request", nil)
	response := httptest.NewRecorder()
	middlewares.WithStartupRequestBarrier(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })).ServeHTTP(response, req)
	if response.Code != 204 {
		t.Fatal("new HTTP request failed with open streams", response.Code)
	}
}
