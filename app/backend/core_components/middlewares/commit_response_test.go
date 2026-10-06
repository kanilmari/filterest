// commit_response_test.go
// Proves opt-in output remains private until commit and errors replace success.
// Tests the forwarding stream contract alongside status/header/body buffering.
// Keeps truthful transaction outcomes from changing ordinary request behaviour.
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

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	esessions "easelect/backend/core_components/sessions"
	"github.com/gorilla/sessions"
)

type commitTestDriver struct {
	recorder *httptest.ResponseRecorder
	failure  bool
	commits  int
}
type commitTestConn struct{ state *commitTestDriver }
type commitTestTx struct{ state *commitTestDriver }
type commitTestRows struct{}

func (d *commitTestDriver) Connect(context.Context) (driver.Conn, error) {
	return &commitTestConn{d}, nil
}
func (d *commitTestDriver) Driver() driver.Driver            { return d }
func (d *commitTestDriver) Open(string) (driver.Conn, error) { return d.Connect(context.Background()) }
func (*commitTestConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepare")
}
func (*commitTestConn) Close() error                { return nil }
func (c *commitTestConn) Begin() (driver.Tx, error) { return &commitTestTx{c.state}, nil }
func (*commitTestConn) ExecContext(context.Context, string, []driver.NamedValue) (driver.Result, error) {
	return driver.RowsAffected(1), nil
}
func (*commitTestConn) QueryContext(context.Context, string, []driver.NamedValue) (driver.Rows, error) {
	return commitTestRows{}, nil
}
func (commitTestRows) Columns() []string         { return []string{"value"} }
func (commitTestRows) Close() error              { return nil }
func (commitTestRows) Next([]driver.Value) error { return io.EOF }
func (tx *commitTestTx) Commit() error {
	tx.state.commits++
	if tx.state.recorder.Body.Len() != 0 {
		return errors.New("HTTP output preceded commit")
	}
	if tx.state.failure {
		return errors.New("injected commit failure")
	}
	return nil
}
func (*commitTestTx) Rollback() error { return nil }

func TestLazyTransactionDeliversBufferedSuccessOnlyAfterCommit(t *testing.T) {
	oldStore := esessions.Store
	esessions.Store = sessions.NewCookieStore([]byte("commit-buffer-unit-test-key"))
	t.Cleanup(func() { esessions.Store = oldStore })
	for _, failure := range []bool{false, true} {
		recorder := httptest.NewRecorder()
		state := &commitTestDriver{recorder: recorder, failure: failure}
		db := sql.OpenDB(state)
		defer db.Close()
		old, oldDB := backend.DbAdmin, backend.Db
		backend.DbAdmin, backend.Db = db, db
		handler := WithLazyTransaction(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if err := httpresponse.EnableCommitBuffer(w); err != nil {
				t.Fatal(err)
			}
			if _, err := dbutils.RequireTxWithError(r.Context()); err != nil {
				t.Fatal(err)
			}
			w.WriteHeader(201)
			_, _ = w.Write([]byte("saved"))
		}))
		request := httptest.NewRequest("POST", "/api/permissions", nil)
		request = request.WithContext(dbutils.SetRequestActorContext(request.Context(), dbutils.NewRequestActorContext(2, "admin")))
		handler.ServeHTTP(recorder, request)
		backend.DbAdmin, backend.Db = old, oldDB
		want := 201
		if failure {
			want = 500
		}
		if state.commits != 1 || recorder.Code != want || failure && strings.Contains(recorder.Body.String(), "saved") {
			t.Fatal(state, recorder)
		}
	}
}

func TestCommitResponseReleaseAndFailure(t *testing.T) {
	for _, failure := range []bool{false, true} {
		recorder := httptest.NewRecorder()
		writer := newCommitResponse(recorder)
		if err := httpresponse.EnableCommitBuffer(writer); err != nil {
			t.Fatal(err)
		}
		writer.Header().Set("Location", "/new-dataset")
		writer.Header().Set("Content-Length", "5")
		writer.WriteHeader(http.StatusCreated)
		_, _ = writer.Write([]byte("saved"))
		writer.Flush()
		if recorder.Body.Len() != 0 || recorder.Flushed || recorder.Header().Get("Location") != "" {
			t.Fatal("uncommitted response escaped")
		}
		if failure {
			writer.commitFailed()
			if recorder.Code != 500 || strings.Contains(recorder.Body.String(), "saved") || recorder.Header().Get("Location") != "" || recorder.Header().Get("Content-Length") != "" {
				t.Fatal(recorder)
			}
		} else {
			writer.release()
			if recorder.Code != 201 || recorder.Body.String() != "saved" || recorder.Header().Get("Location") == "" {
				t.Fatal(recorder)
			}
		}
	}
}

func TestCommitResponseOrdinaryStreamsAndLateOptIn(t *testing.T) {
	recorder := httptest.NewRecorder()
	writer := newCommitResponse(recorder)
	writer.WriteHeader(202)
	_, _ = writer.Write([]byte("stream"))
	writer.Flush()
	if recorder.Code != 202 || recorder.Body.String() != "stream" || !recorder.Flushed {
		t.Fatal("ordinary stream was buffered")
	}
	if err := writer.EnableCommitBuffer(); err == nil {
		t.Fatal("late buffer activation accepted")
	}
	recorder = httptest.NewRecorder()
	writer = newCommitResponse(recorder)
	_ = writer.EnableCommitBuffer()
	writer.WriteHeader(409)
	_, _ = writer.Write([]byte("review required"))
	writer.WriteHeader(201)
	writer.release()
	if recorder.Code != 409 || recorder.Body.String() != "review required" {
		t.Fatal("rollback response changed")
	}
}
