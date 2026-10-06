// slow_login_admission_test.go
// Runs the actual JSON login handler with a slowly sent request body.
// Lifecycle admission begins with SQL, so an unfinished body holds no barrier.
// The local driver and body need neither database nor network access.
package auth

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/middlewares"
	"easelect/backend/core_components/runtime_grants"
)

type slowLoginConnector struct{}
type slowLoginConn struct{}

func (d slowLoginConnector) Connect(context.Context) (driver.Conn, error) {
	return slowLoginConn{}, nil
}
func (d slowLoginConnector) Driver() driver.Driver            { return d }
func (d slowLoginConnector) Open(string) (driver.Conn, error) { return d.Connect(context.Background()) }
func (slowLoginConn) Prepare(string) (driver.Stmt, error) {
	return nil, fmt.Errorf("unexpected prepare")
}
func (slowLoginConn) Close() error              { return nil }
func (slowLoginConn) Begin() (driver.Tx, error) { return nil, fmt.Errorf("unexpected transaction") }
func (slowLoginConn) ExecContext(context.Context, string, []driver.NamedValue) (driver.Result, error) {
	return driver.RowsAffected(1), nil
}
func (slowLoginConn) QueryContext(_ context.Context, q string, _ []driver.NamedValue) (driver.Rows, error) {
	return &credentialMockRows{cols: []string{"lock"}, vals: []driver.Value{!strings.Contains(q, "FROM pg_locks")}}, nil
}

type slowLoginBody struct {
	started, finish chan struct{}
	once            sync.Once
}

func (b *slowLoginBody) Read([]byte) (int, error) {
	b.once.Do(func() { close(b.started) })
	<-b.finish
	return 0, io.EOF
}
func (*slowLoginBody) Close() error { return nil }

func TestSlowLoginBodyDoesNotHoldAdmissionOrStopOrdinaryRequests(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	lifecycle := sql.OpenDB(slowLoginConnector{})
	defer lifecycle.Close()
	old := backend.DbLifecycle
	backend.DbLifecycle = lifecycle
	defer func() { backend.DbLifecycle = old }()
	body := &slowLoginBody{started: make(chan struct{}), finish: make(chan struct{})}
	done := make(chan int, 1)
	req := httptest.NewRequest("POST", "/api/login", nil)
	req.Body = body
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Bypass-Ratelimit", "test-mode")
	req.RemoteAddr = "127.0.0.1:9012"
	go func() {
		response := httptest.NewRecorder()
		middlewares.WithStartupRequestBarrier(http.HandlerFunc(LoginAPIHandler)).ServeHTTP(response, req)
		done <- response.Code
	}()
	defer func() {
		close(body.finish)
		if status := <-done; status != 400 {
			t.Error("unexpected unfinished-body result", status)
		}
	}()
	select {
	case <-body.started:
	case <-time.After(time.Second):
		t.Fatal("login handler never read its body")
	}
	time.Sleep(150 * time.Millisecond)
	if lifecycle.Stats().InUse != 0 {
		t.Fatal("login body retained database admission")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
	defer cancel()
	if err := runtime_grants.WithRequestBarrier(ctx, lifecycle, func(context.Context) error { return nil }); err != nil {
		t.Fatal("unfinished login stopped ordinary traffic", err)
	}
}
