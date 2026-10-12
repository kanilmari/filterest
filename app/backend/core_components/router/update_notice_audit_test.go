// update_notice_audit_test.go
// Exercises actual notice handlers through audit middleware and its batch writer.
// Local lifecycle and audit drivers stand in for SQL; no database is contacted.
// Proves exceptional 200 stream endings remain failed, attributed audit events.
package router

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	e_sessions "easelect/backend/core_components/sessions"
	"easelect/backend/pipeline/audit"
	"github.com/gorilla/sessions"
)

type noticeAuditDriver struct {
	*noticeAdmissionDriver
	events chan []driver.NamedValue
}

type noticeAuditConn struct {
	*noticeAdmissionConn
	events chan []driver.NamedValue
}

func (d *noticeAuditDriver) Connect(context.Context) (driver.Conn, error) {
	return &noticeAuditConn{noticeAdmissionConn: &noticeAdmissionConn{d.noticeAdmissionDriver}, events: d.events}, nil
}
func (d *noticeAuditDriver) Driver() driver.Driver { return d }
func (d *noticeAuditDriver) Open(string) (driver.Conn, error) {
	return d.Connect(context.Background())
}
func (c *noticeAuditConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if strings.Contains(query, "SELECT username") {
		return &noticeAdmissionRows{values: []driver.Value{"fixture-admin"}}, nil
	}
	return c.noticeAdmissionConn.QueryContext(ctx, query, args)
}
func (c *noticeAuditConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	if strings.Contains(query, "INSERT INTO system_audit_log") {
		for offset := 0; offset < len(args); offset += 11 {
			c.events <- append([]driver.NamedValue(nil), args[offset:offset+11]...)
		}
		return driver.RowsAffected(len(args) / 11), nil
	}
	return c.noticeAdmissionConn.ExecContext(ctx, query, args)
}

type noticeAuditWriter struct {
	*httptest.ResponseRecorder
	failWrites bool
	onFlush    func()
}

func (w *noticeAuditWriter) Write(payload []byte) (int, error) {
	if w.failWrites {
		return 0, errors.New("fixture write failure")
	}
	return w.ResponseRecorder.Write(payload)
}

func (w *noticeAuditWriter) Flush() {
	w.ResponseRecorder.Flush()
	if w.onFlush != nil {
		w.onFlush()
	}
}

func TestAdminUpdateNoticeStreamAuditsFailuresAndRevocations(t *testing.T) {
	installNoticeAdmissionFixture(t)
	events := make(chan []driver.NamedValue, 16)
	db := sql.OpenDB(&noticeAuditDriver{noticeAdmissionDriver: &noticeAdmissionDriver{}, events: events})
	oldDB, oldStore := backend.Db, e_sessions.Store
	backend.Db = db
	e_sessions.Store = sessions.NewCookieStore([]byte("01234567890123456789012345678901"))
	t.Cleanup(func() { backend.Db = oldDB; e_sessions.Store = oldStore; db.Close() })
	oldRead, oldCheck := readProductionUpdateNotice, productionUpdateNoticeAdminOK
	oldHeartbeat, oldSnapshot := productionUpdateNoticeHeartbeat, productionUpdateNoticeSnapshotInterval
	oldRecheck, oldLifetime := productionUpdateNoticeRecheck, productionUpdateNoticeLifetime
	t.Cleanup(func() {
		readProductionUpdateNotice, productionUpdateNoticeAdminOK = oldRead, oldCheck
		productionUpdateNoticeHeartbeat, productionUpdateNoticeSnapshotInterval = oldHeartbeat, oldSnapshot
		productionUpdateNoticeRecheck, productionUpdateNoticeLifetime = oldRecheck, oldLifetime
	})

	for _, test := range []struct {
		name          string
		snapshotError int
		revoked       bool
		checkError    bool
		writeError    bool
		clientClosure bool
		wantStatus    int
		wantAudit     bool
	}{
		{name: "initial snapshot failure", snapshotError: 1, wantStatus: 503, wantAudit: true},
		{name: "later snapshot failure", snapshotError: 2, wantStatus: 200, wantAudit: true},
		{name: "access revocation", revoked: true, wantStatus: 200, wantAudit: true},
		{name: "admin recheck failure", checkError: true, wantStatus: 200, wantAudit: true},
		{name: "stream write failure", writeError: true, wantStatus: 200, wantAudit: true},
		{name: "normal lifetime", wantStatus: 200},
		{name: "normal client closure", clientClosure: true, wantStatus: 200},
	} {
		t.Run(test.name, func(t *testing.T) {
			readCount := 0
			readProductionUpdateNotice = func(context.Context, time.Time) (productionUpdateNoticeSnapshot, error) {
				readCount++
				if readCount == test.snapshotError {
					return productionUpdateNoticeSnapshot{}, errors.New("fixture snapshot failure")
				}
				return snapshotProductionUpdateNotice(emptyProductionUpdateNotice(), time.Now()), nil
			}
			productionUpdateNoticeAdminOK = func(context.Context, int) (bool, error) {
				if test.checkError {
					return false, errors.New("fixture account read failure")
				}
				return !test.revoked, nil
			}
			productionUpdateNoticeHeartbeat, productionUpdateNoticeSnapshotInterval = time.Hour, time.Hour
			productionUpdateNoticeRecheck, productionUpdateNoticeLifetime = time.Hour, 20*time.Millisecond
			if test.snapshotError == 2 {
				productionUpdateNoticeSnapshotInterval = time.Millisecond
			}
			if test.revoked || test.checkError {
				productionUpdateNoticeRecheck = time.Millisecond
			}
			request := httptest.NewRequest(http.MethodGet, "/api/admin/update-notice/stream", nil)
			ctx, cancel := context.WithCancel(request.Context())
			defer cancel()
			request = request.WithContext(ctx)
			session, err := e_sessions.Store.Get(request, e_sessions.SessionName)
			if err != nil {
				t.Fatal(err)
			}
			session.Values["user_id"] = 42
			request = request.WithContext(dbutils.SetRequestActorContext(request.Context(), dbutils.NewRequestActorContext(42, "admin")))
			writer := &noticeAuditWriter{ResponseRecorder: httptest.NewRecorder(), failWrites: test.writeError}
			if test.clientClosure {
				writer.onFlush = cancel
			}
			audit.WithAudit("router.adminUpdateNoticeStreamHandler", adminUpdateNoticeStreamHandler)(writer, request)
			if writer.Code != test.wantStatus {
				t.Fatal("wrong HTTP outcome", writer.Code, test.wantStatus)
			}
			if test.snapshotError == 1 && strings.Contains(writer.Body.String(), "event: update_notice") {
				t.Fatal("failed initial read started a successful stream")
			}
			if (test.revoked || test.checkError) && !strings.Contains(writer.Body.String(), "event: access_revoked") {
				t.Fatal("revocation event missing", writer.Body.String())
			}
			if test.wantAudit {
				select {
				case event := <-events:
					if event[1].Value != int64(42) || event[3].Value != "router.adminUpdateNoticeStreamHandler" || event[5].Value != request.URL.Path || event[8].Value != false {
						t.Fatal("stream failure was not a failed, attributed audit row", event)
					}
				case <-time.After(2 * time.Second):
					t.Fatal("stream failure never reached the audit writer")
				}
			} else {
				// Give the real 500ms batch flusher a full interval to expose any
				// erroneous success event instead of only checking an empty queue.
				select {
				case event := <-events:
					t.Fatal("ordinary successful stream was audited", event)
				case <-time.After(600 * time.Millisecond):
				}
			}
		})
	}
}
