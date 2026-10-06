// startup_load_test.go
// Runs administrator lazy transactions through real admission under pool load.
// A one-slot work pool must remain usable independently of the lifecycle session.
// The stub driver records releases and avoids external database/network access.
package middlewares

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	esessions "easelect/backend/core_components/sessions"
	"github.com/gorilla/sessions"
)

type loadDriver struct{}
type loadConn struct{}
type loadTx struct{}
type loadRows struct {
	sent  bool
	value bool
}

func (d loadDriver) Connect(context.Context) (driver.Conn, error) { return loadConn{}, nil }
func (d loadDriver) Driver() driver.Driver                        { return d }
func (d loadDriver) Open(string) (driver.Conn, error)             { return d.Connect(context.Background()) }
func (loadConn) Prepare(string) (driver.Stmt, error)              { return nil, errors.New("unexpected prepare") }
func (loadConn) Close() error                                     { return nil }
func (loadConn) Begin() (driver.Tx, error)                        { return loadTx{}, nil }
func (loadConn) ExecContext(context.Context, string, []driver.NamedValue) (driver.Result, error) {
	return driver.RowsAffected(1), nil
}
func (loadConn) QueryContext(_ context.Context, q string, _ []driver.NamedValue) (driver.Rows, error) {
	return &loadRows{value: !strings.Contains(q, "FROM pg_locks")}, nil
}
func (loadTx) Commit() error        { return nil }
func (loadTx) Rollback() error      { return nil }
func (*loadRows) Columns() []string { return []string{"released"} }
func (*loadRows) Close() error      { return nil }
func (r *loadRows) Next(dest []driver.Value) error {
	if r.sent {
		return io.EOF
	}
	r.sent = true
	dest[0] = r.value
	return nil
}

func TestAdministratorHandlerCannotDeadlockOnItsOwnAdmission(t *testing.T) {
	admin, lifecycle := sql.OpenDB(loadDriver{}), sql.OpenDB(loadDriver{})
	defer admin.Close()
	defer lifecycle.Close()
	admin.SetMaxOpenConns(1)
	lifecycle.SetMaxOpenConns(2)
	oldDB, oldAdmin, oldLifecycle := backend.Db, backend.DbAdmin, backend.DbLifecycle
	backend.Db, backend.DbAdmin, backend.DbLifecycle = admin, admin, lifecycle
	oldStore := esessions.Store
	esessions.Store = sessions.NewCookieStore([]byte("load-proof"))
	defer func() { esessions.Store = oldStore }()
	defer func() { backend.Db, backend.DbAdmin, backend.DbLifecycle = oldDB, oldAdmin, oldLifecycle }()
	wrapped := WithStartupRequestBarrier(WithLazyTransaction(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := dbutils.RequireTxWithError(r.Context()); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		w.WriteHeader(204)
	})))
	finished := make(chan int, 24)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	for i := 0; i < 24; i++ {
		go func() {
			req := httptest.NewRequest("POST", "/api/admin/work", nil)
			req = req.WithContext(dbutils.SetRequestActorContext(ctx, dbutils.NewRequestActorContext(2, "admin")))
			response := httptest.NewRecorder()
			wrapped.ServeHTTP(response, req)
			finished <- response.Code
		}()
	}
	for i := 0; i < 24; i++ {
		select {
		case status := <-finished:
			if status != 204 {
				t.Fatalf("administrator response failed under load: %d", status)
			}
		case <-time.After(3 * time.Second):
			t.Fatal("administrator handler deadlocked against admission")
		}
	}
	if admin.Stats().InUse != 0 || lifecycle.Stats().InUse != 0 {
		t.Fatal("admission or transactions leaked slots")
	}
}

func TestSlowOrdinaryTransactionKeepsOtherHTTPRequestsAvailable(t *testing.T) {
	admin, lifecycle := sql.OpenDB(loadDriver{}), sql.OpenDB(loadDriver{})
	defer admin.Close()
	defer lifecycle.Close()
	admin.SetMaxOpenConns(2)
	lifecycle.SetMaxOpenConns(2)
	oldDB, oldAdmin, oldLifecycle := backend.Db, backend.DbAdmin, backend.DbLifecycle
	backend.Db, backend.DbAdmin, backend.DbLifecycle = admin, admin, lifecycle
	defer func() { backend.Db, backend.DbAdmin, backend.DbLifecycle = oldDB, oldAdmin, oldLifecycle }()
	entered, finish := make(chan struct{}), make(chan struct{})
	done := make(chan int, 1)
	wrapped := WithStartupRequestBarrier(WithLazyTransaction(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := dbutils.RequireTxWithError(r.Context()); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		if r.URL.Path == "/api/slow" {
			close(entered)
			<-finish
		}
		w.WriteHeader(204)
	})))
	request := func(ctx context.Context, path string) *http.Request {
		return httptest.NewRequest("GET", path, nil).WithContext(dbutils.SetRequestActorContext(ctx, dbutils.NewRequestActorContext(2, "admin")))
	}
	go func() {
		response := httptest.NewRecorder()
		wrapped.ServeHTTP(response, request(context.Background(), "/api/slow"))
		done <- response.Code
	}()
	<-entered
	defer func() {
		close(finish)
		if status := <-done; status != 204 {
			t.Error("slow request failed", status)
		}
	}()
	time.Sleep(150 * time.Millisecond)
	ctx, cancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
	defer cancel()
	response := httptest.NewRecorder()
	wrapped.ServeHTTP(response, request(ctx, "/api/ordinary"))
	if response.Code != 204 {
		t.Fatal("slow ordinary request blocked another HTTP request", response.Code)
	}
}

func TestPanickingHTTPTransactionReleasesItsAdmission(t *testing.T) {
	admin, lifecycle := sql.OpenDB(loadDriver{}), sql.OpenDB(loadDriver{})
	defer admin.Close()
	defer lifecycle.Close()
	oldDB, oldAdmin, oldLifecycle := backend.Db, backend.DbAdmin, backend.DbLifecycle
	backend.Db, backend.DbAdmin, backend.DbLifecycle = admin, admin, lifecycle
	defer func() { backend.Db, backend.DbAdmin, backend.DbLifecycle = oldDB, oldAdmin, oldLifecycle }()
	req := httptest.NewRequest("GET", "/api/panic", nil).WithContext(dbutils.SetRequestActorContext(context.Background(), dbutils.NewRequestActorContext(2, "admin")))
	handler := WithStartupRequestBarrier(WithLazyTransaction(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := dbutils.RequireTxWithError(r.Context()); err != nil {
			t.Error(err)
			return
		}
		panic("request panic")
	})))
	func() {
		defer func() {
			if recover() == nil {
				t.Error("panic was swallowed")
			}
		}()
		handler.ServeHTTP(httptest.NewRecorder(), req)
	}()
	if admin.Stats().InUse != 0 || lifecycle.Stats().InUse != 0 {
		t.Fatal("panic leaked work or admission")
	}
}
