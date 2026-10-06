// update_notice_admission_test.go
// Runs the actual administrator stream, snapshots and account checks through admission.
// Slow responses remain open beyond the old cohort window while traffic continues.
// SQL and network writers are local stubs; no server/database access is required.
package router

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
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
	"easelect/backend/core_components/middlewares"
	"easelect/backend/core_components/runtime_grants"
)

type noticeAdmissionDriver struct {
	reads, checks      atomic.Int32
	shared             atomic.Int32
	pending, exclusive atomic.Bool
}
type noticeAdmissionConn struct{ state *noticeAdmissionDriver }
type noticeAdmissionRows struct {
	values []driver.Value
	sent   bool
}

func (d *noticeAdmissionDriver) Connect(context.Context) (driver.Conn, error) {
	return &noticeAdmissionConn{d}, nil
}
func (d *noticeAdmissionDriver) Driver() driver.Driver { return d }
func (d *noticeAdmissionDriver) Open(string) (driver.Conn, error) {
	return d.Connect(context.Background())
}
func (*noticeAdmissionConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepare")
}
func (*noticeAdmissionConn) Close() error { return nil }
func (*noticeAdmissionConn) Begin() (driver.Tx, error) {
	return noticePollTx{}, nil
}

type noticePollTx struct{}

func (noticePollTx) Commit() error   { return nil }
func (noticePollTx) Rollback() error { return nil }

func (c *noticeAdmissionConn) ExecContext(ctx context.Context, q string, _ []driver.NamedValue) (driver.Result, error) {
	switch q {
	case `SELECT pg_advisory_lock_shared(hashtext($1))`:
		for c.state.pending.Load() {
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(time.Millisecond):
			}
		}
		c.state.shared.Add(1)
	case `SELECT pg_advisory_lock(hashtext($1))`:
		c.state.pending.Store(true)
		for c.state.shared.Load() > 0 {
			select {
			case <-ctx.Done():
				c.state.pending.Store(false)
				return nil, ctx.Err()
			case <-time.After(time.Millisecond):
			}
		}
		c.state.exclusive.Store(true)
	}
	return driver.RowsAffected(1), nil
}
func (c *noticeAdmissionConn) QueryContext(_ context.Context, q string, _ []driver.NamedValue) (driver.Rows, error) {
	values := []driver.Value{true}
	switch {
	case strings.Contains(q, "pg_advisory_unlock_shared"):
		c.state.shared.Add(-1)
	case strings.Contains(q, "pg_advisory_unlock("):
		c.state.exclusive.Store(false)
		c.state.pending.Store(false)
	case strings.Contains(q, "FROM pg_locks"):
		values = []driver.Value{c.state.pending.Load() && !c.state.exclusive.Load()}
	case strings.Contains(q, "json_value::text"):
		c.state.reads.Add(1)
		values = []driver.Value{`{"schema_version":1,"notice_id":"","state":"cleared"}`}
	case strings.Contains(q, "FROM public.system_users"):
		c.state.checks.Add(1)
		values = []driver.Value{true, true, true}
	}
	return &noticeAdmissionRows{values: values}, nil
}
func (r *noticeAdmissionRows) Columns() []string {
	names := make([]string, len(r.values))
	for i := range names {
		names[i] = "value"
	}
	return names
}
func (*noticeAdmissionRows) Close() error { return nil }
func (r *noticeAdmissionRows) Next(dest []driver.Value) error {
	if r.sent {
		return io.EOF
	}
	r.sent = true
	copy(dest, r.values)
	return nil
}
func installNoticeAdmissionFixture(t *testing.T) (*sql.DB, *noticeAdmissionDriver) {
	t.Helper()
	state := &noticeAdmissionDriver{}
	db := sql.OpenDB(state)
	db.SetMaxOpenConns(2)
	old := backend.DbLifecycle
	backend.DbLifecycle = db
	t.Cleanup(func() { backend.DbLifecycle = old; db.Close() })
	return db, state
}

type noticeAdmissionWriter struct {
	*httptest.ResponseRecorder
	ready chan struct{}
	once  sync.Once
}

func (w *noticeAdmissionWriter) Flush() { w.once.Do(func() { close(w.ready) }) }

func TestAdministratorNoticeStreamBeyondCohortWindowServesOrdinaryTraffic(t *testing.T) {
	lifecycle, state := installNoticeAdmissionFixture(t)
	oldDB := backend.Db
	backend.Db = sql.OpenDB(state)
	t.Cleanup(func() { backend.Db.Close(); backend.Db = oldDB })
	oldRead, oldCheck := readProductionUpdateNotice, productionUpdateNoticeAdminOK
	readProductionUpdateNotice = readProductionUpdateNoticeFromDatabase
	productionUpdateNoticeAdminOK = productionUpdateNoticeAdminStillAllowed
	defer func() { readProductionUpdateNotice = oldRead; productionUpdateNoticeAdminOK = oldCheck }()
	oldSnapshot, oldRecheck := productionUpdateNoticeSnapshotInterval, productionUpdateNoticeRecheck
	productionUpdateNoticeSnapshotInterval, productionUpdateNoticeRecheck = 20*time.Millisecond, 20*time.Millisecond
	defer func() {
		productionUpdateNoticeSnapshotInterval, productionUpdateNoticeRecheck = oldSnapshot, oldRecheck
	}()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	writer := &noticeAdmissionWriter{ResponseRecorder: httptest.NewRecorder(), ready: make(chan struct{})}
	req := httptest.NewRequest("GET", "/api/admin/update-notice/stream", nil)
	req = req.WithContext(dbutils.SetRequestActorContext(ctx, dbutils.NewRequestActorContext(2, "admin")))
	go func() {
		defer close(done)
		middlewares.WithStartupRequestBarrier(http.HandlerFunc(adminUpdateNoticeStreamHandler)).ServeHTTP(writer, req)
	}()
	defer func() { cancel(); <-done }()
	select {
	case <-writer.ready:
	case <-time.After(time.Second):
		t.Fatal("administrator stream never opened")
	}
	time.Sleep(150 * time.Millisecond)
	ordinary := middlewares.WithStartupRequestBarrier(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		err := runtime_grants.WithRequestBarrier(r.Context(), lifecycle, func(context.Context) error { return nil })
		if err != nil {
			http.Error(w, err.Error(), 503)
			return
		}
		w.WriteHeader(204)
	}))
	requestCtx, requestCancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
	defer requestCancel()
	response := httptest.NewRecorder()
	ordinary.ServeHTTP(response, httptest.NewRequest("GET", "/api/ordinary", nil).WithContext(requestCtx))
	if response.Code != 204 {
		t.Fatal("administrator stream blocked ordinary request", response.Code)
	}
	if state.reads.Load() < 2 || state.checks.Load() < 1 {
		t.Fatal("production snapshot/account callbacks did not run")
	}
	// The same actual stream must allow a pending startup to finish. Hold the
	// startup phase to prove a later ordinary HTTP request waits and then resumes.
	drainEntered, releaseDrain := make(chan struct{}), make(chan struct{})
	drainDone := make(chan error, 1)
	go func() {
		drainDone <- runtime_grants.WithStartupBarrier(context.Background(), lifecycle, func() error { close(drainEntered); <-releaseDrain; return nil })
	}()
	released := false
	defer func() {
		if !released {
			close(releaseDrain)
		}
	}()
	select {
	case <-drainEntered:
	case <-time.After(250 * time.Millisecond):
		t.Fatal("idle administrator stream stranded startup")
	}
	laterDone := make(chan int, 1)
	go func() {
		res := httptest.NewRecorder()
		ordinary.ServeHTTP(res, httptest.NewRequest("GET", "/api/later", nil))
		laterDone <- res.Code
	}()
	select {
	case <-laterDone:
		t.Fatal("ordinary request overtook startup")
	case <-time.After(40 * time.Millisecond):
	}
	close(releaseDrain)
	released = true
	select {
	case err := <-drainDone:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("startup did not finish")
	}
	select {
	case status := <-laterDone:
		if status != 204 {
			t.Fatal("ordinary request did not resume", status)
		}
	case <-time.After(time.Second):
		t.Fatal("ordinary request stranded after startup")
	}
	// Synchronize cancellation before inspecting slots; callbacks may briefly hold one.
	cancel()
	<-done
	if lifecycle.Stats().InUse != 0 {
		t.Fatal("closed administrator stream leaked admission")
	}
}
