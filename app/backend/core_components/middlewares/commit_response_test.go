// commit_response_test.go
// Proves opt-in output remains private until commit and errors replace success.
// Tests the forwarding stream contract alongside status/header/body buffering.
// Keeps read and stream forwarding intact while finite writes wait for commit.
package middlewares

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
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	esessions "easelect/backend/core_components/sessions"
	"github.com/gorilla/sessions"
)

type commitTestDriver struct {
	recorder  *httptest.ResponseRecorder
	failure   bool
	commits   int
	rollbacks int
	// beforeCommit observes the response at the moment of COMMIT.
	beforeCommit func()
	// cleanupErr simulates a release failure after a successful commit.
	cleanupErr error
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
	if tx.state.beforeCommit != nil {
		tx.state.beforeCommit()
	}
	if tx.state.recorder != nil && tx.state.recorder.Body.Len() != 0 {
		return errors.New("HTTP output preceded commit")
	}
	if tx.state.failure {
		return errors.New("injected commit failure")
	}
	return dbutils.CommittedWithCleanupError(tx.state.cleanupErr)
}
func (tx *commitTestTx) Rollback() error { tx.state.rollbacks++; return nil }

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

func TestLazyTransactionFiniteWritesWaitForCommit(t *testing.T) {
	oldStore := esessions.Store
	esessions.Store = sessions.NewCookieStore([]byte("finite-write-unit-test"))
	t.Cleanup(func() { esessions.Store = oldStore })
	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		for _, failure := range []bool{false, true} {
			t.Run(method+"/failure="+fmt.Sprint(failure), func(t *testing.T) {
				recorder := httptest.NewRecorder()
				recorder.Header().Set("X-Outer", "preserved")
				state := &commitTestDriver{recorder: recorder, failure: failure}
				configureCommitTestDB(t, state)
				handler := WithLazyTransaction(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if _, err := dbutils.RequireTxWithError(r.Context()); err != nil {
						t.Fatal(err)
					}
					w.Header().Set("Location", "/saved")
					w.Header().Set("Content-Length", "5")
					http.SetCookie(w, &http.Cookie{Name: "saved", Value: "yes"})
					w.WriteHeader(http.StatusCreated)
					_, _ = w.Write([]byte("saved"))
					w.(http.Flusher).Flush()
					if recorder.Code != http.StatusOK || recorder.Body.Len() != 0 || recorder.Flushed || recorder.Header().Get("Location") != "" || len(recorder.Header().Values("Set-Cookie")) != 0 {
						t.Error("success status, body, flush or headers escaped before commit")
					}
				}))
				request := commitTestRequest(method, "/api/update-row?dataset=plain_rows")
				handler.ServeHTTP(recorder, request)
				want := http.StatusCreated
				if failure {
					want = http.StatusInternalServerError
				}
				if state.commits != 1 || recorder.Code != want || recorder.Header().Get("X-Outer") != "preserved" {
					t.Fatal(state, recorder)
				}
				if failure {
					assertNoBufferedSuccess(t, recorder)
				} else if recorder.Body.String() != "saved" || recorder.Header().Get("Location") != "/saved" || len(recorder.Result().Cookies()) != 1 {
					t.Fatal(recorder)
				}
			})
		}
	}
}

func configureCommitTestDB(t *testing.T, state *commitTestDriver) {
	t.Helper()
	db := sql.OpenDB(state)
	old, oldDB := backend.DbAdmin, backend.Db
	backend.DbAdmin, backend.Db = db, db
	t.Cleanup(func() { backend.DbAdmin, backend.Db = old, oldDB; _ = db.Close() })
}

func commitTestRequest(method, target string) *http.Request {
	request := httptest.NewRequest(method, target, nil)
	return request.WithContext(dbutils.SetRequestActorContext(request.Context(), dbutils.NewRequestActorContext(2, "admin")))
}

func assertNoBufferedSuccess(t *testing.T, recorder *httptest.ResponseRecorder) {
	t.Helper()
	if recorder.Code != 500 || strings.Contains(recorder.Body.String(), "saved") || recorder.Header().Get("Location") != "" || recorder.Header().Get("Content-Length") != "" || len(recorder.Result().Cookies()) != 0 {
		t.Fatal("uncommitted success escaped", recorder)
	}
}

func TestLazyTransactionStreamingAndReadResponsesStillForward(t *testing.T) {
	for _, test := range []struct{ method, mediaType string }{
		{http.MethodPost, "text/event-stream; charset=utf-8"},
		{http.MethodPost, "application/x-ndjson"},
		{http.MethodGet, "application/json"},
		{http.MethodHead, "application/json"},
		{http.MethodOptions, "application/json"},
	} {
		t.Run(test.method+"/"+test.mediaType, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			state := &commitTestDriver{recorder: recorder}
			configureCommitTestDB(t, state)
			handler := WithLazyTransaction(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", test.mediaType)
				_, _ = w.Write([]byte("first\n"))
				w.(http.Flusher).Flush()
				if recorder.Body.String() != "first\n" || !recorder.Flushed || recorder.Header().Get("Content-Type") != test.mediaType {
					t.Fatal("first chunk delayed", recorder)
				}
				_, _ = w.Write([]byte("second\n"))
			}))
			handler.ServeHTTP(recorder, commitTestRequest(test.method, "/stream"))
			if recorder.Body.String() != "first\nsecond\n" || state.commits != 0 {
				t.Fatal(state, recorder)
			}
		})
	}
}

func TestLazyTransactionPostReadsKeepForwardingLargeResponses(t *testing.T) {
	for _, path := range []string{
		"/api/check-table-rights", "/api/check-table-rights-multi",
		"/api/fetch-dynamic-children", "/api/comment-counts", "/api/query-table",
		"/api/count-lang-embeddings", "/api/geocode-address",
		"/api/image-source-picker/resolve", "/api/image-source-picker/file",
		"/api/app/ai-chat/query", "/api/dev-ai-translate-single",
	} {
		t.Run(path, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			configureCommitTestDB(t, &commitTestDriver{recorder: recorder})
			handler := WithLazyTransaction(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				body := bytes.Repeat([]byte("x"), (1<<20)+1)
				if n, err := w.Write(body); n != len(body) || err != nil {
					t.Fatal(n, err)
				}
				if recorder.Body.Len() != len(body) {
					t.Fatal("POST read buffered")
				}
			}))
			handler.ServeHTTP(recorder, commitTestRequest(http.MethodPost, path+"?dataset=plain_rows"))
			if recorder.Code != http.StatusOK {
				t.Fatal(recorder)
			}
		})
	}
}

func TestLazyTransactionDeliversLargeFiniteResponses(t *testing.T) {
	oldStore := esessions.Store
	esessions.Store = sessions.NewCookieStore([]byte("large-response-unit-test"))
	t.Cleanup(func() { esessions.Store = oldStore })
	for _, size := range []int{1 << 20, (1 << 20) + 512*1024} {
		for _, transaction := range []bool{false, true} {
			for _, failure := range []bool{false, true} {
				t.Run(fmt.Sprintf("bytes=%d/transaction=%t/failure=%t", size, transaction, failure), func(t *testing.T) {
					recorder := httptest.NewRecorder()
					state := &commitTestDriver{recorder: recorder, failure: failure}
					configureCommitTestDB(t, state)
					body := bytes.Repeat([]byte("saved"), size/5)
					body = append(body, bytes.Repeat([]byte("x"), size-len(body))...)
					handler := WithLazyTransaction(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						if transaction {
							if _, err := dbutils.RequireTxWithError(r.Context()); err != nil {
								t.Fatal(err)
							}
						}
						w.Header().Set("Location", "/saved")
						w.Header().Set("Content-Length", fmt.Sprint(len(body)))
						http.SetCookie(w, &http.Cookie{Name: "saved", Value: "yes"})
						w.WriteHeader(http.StatusCreated)
						// Cross the former boundary over multiple writes, then flush.
						for _, chunk := range [][]byte{body[:1<<20], body[1<<20:]} {
							if n, err := w.Write(chunk); n != len(chunk) || err != nil {
								t.Fatalf("write: n=%d, error=%v", n, err)
							}
						}
						w.(http.Flusher).Flush()
						if transaction {
							if recorder.Body.Len() != 0 || recorder.Flushed || recorder.Header().Get("Location") != "" {
								t.Fatal("finite response escaped before commit")
							}
						} else if !recorder.Flushed || recorder.Body.Len() != len(body) || recorder.Header().Get("Location") != "/saved" {
							// Nothing awaits a commit, so an explicit flush delivers as before.
							t.Fatal("flush without a request transaction did not deliver")
						}
					}))
					handler.ServeHTTP(recorder, commitTestRequest(http.MethodPost, "/finite"))
					if state.commits != map[bool]int{false: 0, true: 1}[transaction] || state.rollbacks != 0 {
						t.Fatalf("commits=%d rollbacks=%d", state.commits, state.rollbacks)
					}
					if transaction && failure {
						assertNoBufferedSuccess(t, recorder)
						if !strings.Contains(recorder.Body.String(), "transaction commit failed") {
							t.Fatal("missing commit-failure replacement")
						}
					} else if recorder.Code != http.StatusCreated || !bytes.Equal(recorder.Body.Bytes(), body) || recorder.Header().Get("Content-Length") != fmt.Sprint(size) || recorder.Header().Get("Location") != "/saved" || len(recorder.Result().Cookies()) != 1 {
						t.Fatalf("large response not delivered intact: status=%d bytes=%d", recorder.Code, recorder.Body.Len())
					}
				})
			}
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
