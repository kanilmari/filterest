// commit_response_boundary_test.go
// Covers the edges of commit-confirmed responses beyond the ordinary save path.
// Exercises status writes, cancellation, panics, flush and stream rules, 1xx and a real server.
// Keeps each exception to buffering tied to "no request transaction is open".
package middlewares

import (
	"context"
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
	errorhandling "easelect/backend/pipeline/error_handling"
	"github.com/gorilla/sessions"
)

// statusCountingWriter counts final status lines that actually reach the client.
type statusCountingWriter struct {
	*httptest.ResponseRecorder
	finalWrites int
}

func (w *statusCountingWriter) WriteHeader(status int) {
	if status >= 200 {
		w.finalWrites++
	}
	w.ResponseRecorder.WriteHeader(status)
}
func (w *statusCountingWriter) Write(body []byte) (int, error) {
	if !w.ResponseRecorder.Flushed && w.finalWrites == 0 {
		w.finalWrites++
	}
	return w.ResponseRecorder.Write(body)
}

func useCommitTestSessions(t *testing.T) {
	t.Helper()
	oldStore := esessions.Store
	esessions.Store = sessions.NewCookieStore([]byte("commit-boundary-unit-test"))
	t.Cleanup(func() { esessions.Store = oldStore })
}

func requireRequestTx(t *testing.T, r *http.Request) {
	t.Helper()
	if _, err := dbutils.RequireTxWithError(r.Context()); err != nil {
		t.Fatal(err)
	}
}

func TestLazyTransactionWritesNoStatusBeforeCommit(t *testing.T) {
	useCommitTestSessions(t)
	for name, respond := range map[string]func(http.ResponseWriter, *http.Request){
		"empty 200": func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) },
		"204":       func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) },
		"redirect":  func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, "/saved", http.StatusSeeOther) },
	} {
		for _, failure := range []bool{false, true} {
			t.Run(name+map[bool]string{false: "/committed", true: "/commit failed"}[failure], func(t *testing.T) {
				counter := &statusCountingWriter{ResponseRecorder: httptest.NewRecorder()}
				state := &commitTestDriver{failure: failure}
				state.beforeCommit = func() {
					if counter.finalWrites != 0 {
						t.Error("a status line reached the client before commit")
					}
				}
				configureCommitTestDB(t, state)
				var wantStatus int
				WithLazyTransaction(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					requireRequestTx(t, r)
					respond(w, r)
					wantStatus = w.(*commitResponse).StatusCode()
				})).ServeHTTP(counter, commitTestRequest(http.MethodPost, "/api/save"))
				if state.commits != 1 || counter.finalWrites != 1 {
					t.Fatalf("commits=%d final status writes=%d", state.commits, counter.finalWrites)
				}
				if failure {
					if counter.Code != http.StatusInternalServerError || counter.Header().Get("Location") != "" {
						t.Fatal("uncommitted status escaped", counter.Code, counter.Header())
					}
				} else if counter.Code != wantStatus {
					t.Fatalf("status %d, want %d", counter.Code, wantStatus)
				}
			})
		}
	}
}

func TestLazyTransactionReplacesSuccessWhenRequestIsCancelled(t *testing.T) {
	useCommitTestSessions(t)
	recorder := httptest.NewRecorder()
	state := &commitTestDriver{recorder: recorder}
	configureCommitTestDB(t, state)
	request := commitTestRequest(http.MethodPost, "/api/save")
	ctx, cancel := context.WithCancel(request.Context())
	defer cancel()
	WithLazyTransaction(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requireRequestTx(t, r)
		w.Header().Set("Location", "/saved")
		http.SetCookie(w, &http.Cookie{Name: "saved", Value: "yes"})
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte("saved"))
		// The client leaves after the handler finished but before commit.
		cancel()
	})).ServeHTTP(recorder, request.WithContext(ctx))
	assertNoBufferedSuccess(t, recorder)
}

func TestLazyTransactionPanicAfterBufferedSuccessReleasesNothing(t *testing.T) {
	useCommitTestSessions(t)
	recorder := httptest.NewRecorder()
	state := &commitTestDriver{recorder: recorder}
	configureCommitTestDB(t, state)
	inner := WithLazyTransaction(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requireRequestTx(t, r)
		w.Header().Set("Location", "/saved")
		w.Header().Set("Content-Length", "5")
		http.SetCookie(w, &http.Cookie{Name: "saved", Value: "yes"})
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte("saved"))
		panic("handler failed after writing success")
	}))
	// The per-route recovery stage runs outside the transaction stage.
	errorhandling.WithErrorRecovery("commit.test", inner.ServeHTTP)(recorder, commitTestRequest(http.MethodPost, "/api/save"))
	if state.commits != 0 || state.rollbacks != 1 {
		t.Fatalf("commits=%d rollbacks=%d", state.commits, state.rollbacks)
	}
	assertNoBufferedSuccess(t, recorder)
}

func TestLazyTransactionResponseControllerCannotBypassBuffer(t *testing.T) {
	useCommitTestSessions(t)
	recorder := httptest.NewRecorder()
	state := &commitTestDriver{recorder: recorder, failure: true}
	configureCommitTestDB(t, state)
	WithLazyTransaction(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requireRequestTx(t, r)
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte("saved"))
		controller := http.NewResponseController(w)
		if err := controller.Flush(); err != nil {
			t.Fatal(err)
		}
		if _, _, err := controller.Hijack(); !errors.Is(err, http.ErrNotSupported) {
			t.Fatalf("hijack while buffered: %v", err)
		}
		if recorder.Body.Len() != 0 || recorder.Flushed {
			t.Fatal("ResponseController released output before commit")
		}
	})).ServeHTTP(recorder, commitTestRequest(http.MethodPost, "/api/save"))
	assertNoBufferedSuccess(t, recorder)
}

func TestLazyTransactionStreamWithOpenTransactionStaysCommitConfirmed(t *testing.T) {
	useCommitTestSessions(t)
	for _, test := range []struct {
		name     string
		explicit bool
		openTx   bool
	}{
		{name: "automatic, transaction open", openTx: true},
		{name: "explicit opt-in, no transaction yet", explicit: true},
		{name: "explicit opt-in, transaction open", explicit: true, openTx: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			state := &commitTestDriver{recorder: recorder, failure: true}
			configureCommitTestDB(t, state)
			WithLazyTransaction(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if test.explicit {
					if err := httpresponse.EnableCommitBuffer(w); err != nil {
						t.Fatal(err)
					}
				}
				if test.openTx {
					requireRequestTx(t, r)
				}
				w.Header().Set("Content-Type", "text/event-stream")
				_, _ = w.Write([]byte("data: saved\n\n"))
				w.(http.Flusher).Flush()
				if recorder.Body.Len() != 0 || recorder.Flushed {
					t.Fatal("stream bypassed commit confirmation")
				}
				if !test.openTx {
					requireRequestTx(t, r)
				}
			})).ServeHTTP(recorder, commitTestRequest(http.MethodPost, "/api/save"))
			if recorder.Code != http.StatusInternalServerError || strings.Contains(recorder.Body.String(), "saved") {
				t.Fatal("failed commit did not replace the held stream", recorder.Code, recorder.Body.String())
			}
		})
	}
}

func TestLazyTransactionAutomaticStreamKeepsForwarding(t *testing.T) {
	useCommitTestSessions(t)
	recorder := httptest.NewRecorder()
	configureCommitTestDB(t, &commitTestDriver{recorder: recorder})
	WithLazyTransaction(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		// An informational prelude must not lock the stream into buffering.
		w.WriteHeader(http.StatusEarlyHints)
		w.Header().Set("Content-Type", "text/event-stream")
		for _, frame := range []string{"data: one\n\n", "data: two\n\n"} {
			_, _ = w.Write([]byte(frame))
			w.(http.Flusher).Flush()
			if !strings.HasSuffix(recorder.Body.String(), frame) || !recorder.Flushed {
				t.Fatalf("frame %q was held", frame)
			}
		}
	})).ServeHTTP(recorder, commitTestRequest(http.MethodPost, "/api/embedding_stream_handler"))
	if recorder.Code != http.StatusOK || recorder.Header().Get("Content-Type") != "text/event-stream" {
		t.Fatal(recorder.Code, recorder.Header())
	}
}

func TestLazyTransactionInformationalStatusThenFailedCommit(t *testing.T) {
	useCommitTestSessions(t)
	recorder := httptest.NewRecorder()
	configureCommitTestDB(t, &commitTestDriver{recorder: recorder, failure: true})
	WithLazyTransaction(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requireRequestTx(t, r)
		w.Header().Set("Link", "</app.css>; rel=preload")
		w.WriteHeader(http.StatusEarlyHints)
		w.Header().Set("Location", "/saved")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte("saved"))
	})).ServeHTTP(recorder, commitTestRequest(http.MethodPost, "/api/save"))
	assertNoBufferedSuccess(t, recorder)
}

// Pool-only handlers such as password reset acknowledge before starting
// background work. Without a request transaction there is no commit to await.
func TestLazyTransactionFlushWithoutTransactionAcknowledgesBeforeBackgroundWork(t *testing.T) {
	useCommitTestSessions(t)
	recorder := httptest.NewRecorder()
	state := &commitTestDriver{recorder: recorder}
	configureCommitTestDB(t, state)
	acknowledged := make(chan bool, 1)
	WithLazyTransaction(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		httpresponse.RespondWithJSON(w, http.StatusOK, map[string]bool{"requested": true})
		w.(http.Flusher).Flush()
		// Where the real handler starts its background delivery.
		acknowledged <- recorder.Flushed && strings.Contains(recorder.Body.String(), "requested")
		w.Header().Set("X-Late", "ignored after delivery")
	})).ServeHTTP(recorder, commitTestRequest(http.MethodPost, "/api/request-password-reset-otp"))
	if !<-acknowledged || state.commits != 0 || recorder.Code != http.StatusOK {
		t.Fatal("acknowledgement waited for handler completion", recorder)
	}
}

func TestLazyTransactionKeepsSuccessWhenCleanupFailsAfterCommit(t *testing.T) {
	useCommitTestSessions(t)
	recorder := httptest.NewRecorder()
	state := &commitTestDriver{recorder: recorder, cleanupErr: errors.New("barrier release failed")}
	configureCommitTestDB(t, state)
	WithLazyTransaction(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requireRequestTx(t, r)
		w.Header().Set("Location", "/saved")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte("saved"))
	})).ServeHTTP(recorder, commitTestRequest(http.MethodPost, "/api/save"))
	if state.commits != 1 || state.rollbacks != 0 {
		t.Fatalf("commits=%d rollbacks=%d", state.commits, state.rollbacks)
	}
	if recorder.Code != http.StatusCreated || recorder.Body.String() != "saved" || recorder.Header().Get("Location") != "/saved" {
		t.Fatal("a committed save was reported as failed", recorder.Code, recorder.Body.String())
	}
}

func TestLazyTransactionWithoutDatabasePoolPassesWriterThrough(t *testing.T) {
	oldAdmin, oldDB := backend.DbAdmin, backend.Db
	backend.DbAdmin, backend.Db = nil, nil
	t.Cleanup(func() { backend.DbAdmin, backend.Db = oldAdmin, oldDB })
	recorder := httptest.NewRecorder()
	WithLazyTransaction(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if w != http.ResponseWriter(recorder) {
			t.Fatal("writer was wrapped without a database pool")
		}
		_, _ = w.Write([]byte("forwarded"))
	})).ServeHTTP(recorder, commitTestRequest(http.MethodPost, "/api/save"))
	if recorder.Body.String() != "forwarded" {
		t.Fatal(recorder.Body.String())
	}
}

// A real server proves what reaches the wire, including HEAD body suppression.
func TestLazyTransactionCommitFailureOverRealHTTPServer(t *testing.T) {
	useCommitTestSessions(t)
	state := &commitTestDriver{}
	configureCommitTestDB(t, state)
	handler := WithLazyTransaction(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requireRequestTx(t, r)
		w.Header().Set("Location", "/saved")
		http.SetCookie(w, &http.Cookie{Name: "saved", Value: "yes"})
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte("saved"))
	}))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handler.ServeHTTP(w, r.WithContext(dbutils.SetRequestActorContext(r.Context(), dbutils.NewRequestActorContext(2, "admin"))))
	}))
	defer server.Close()
	client := server.Client()
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	for _, test := range []struct {
		method          string
		failure         bool
		wantStatus      int
		wantBodyPresent bool
	}{
		{http.MethodPost, false, http.StatusCreated, true},
		{http.MethodPost, true, http.StatusInternalServerError, false},
		{http.MethodHead, false, http.StatusCreated, false},
	} {
		state.failure = test.failure
		request, err := http.NewRequest(test.method, server.URL+"/api/save", nil)
		if err != nil {
			t.Fatal(err)
		}
		response, err := client.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(response.Body)
		response.Body.Close()
		if response.StatusCode != test.wantStatus || strings.Contains(string(body), "saved") != test.wantBodyPresent {
			t.Fatalf("%s failure=%t: status %d body %q", test.method, test.failure, response.StatusCode, body)
		}
		if test.failure && (response.Header.Get("Location") != "" || len(response.Cookies()) != 0) {
			t.Fatal("uncommitted headers reached the wire", response.Header)
		}
	}
}

// Once output was forwarded, a failed commit could no longer replace it, so the
// request transaction must stay closed for the rest of the request.
func TestLazyTransactionRefusesTransactionAfterForwarding(t *testing.T) {
	useCommitTestSessions(t)
	for name, forward := range map[string]func(http.ResponseWriter){
		"stream first": func(w http.ResponseWriter) {
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = w.Write([]byte("data: working\n\n"))
		},
		"flush first": func(w http.ResponseWriter) {
			_, _ = w.Write([]byte("accepted"))
			w.(http.Flusher).Flush()
		},
	} {
		t.Run(name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			state := &commitTestDriver{failure: true}
			configureCommitTestDB(t, state)
			WithLazyTransaction(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				forward(w)
				if recorder.Body.Len() == 0 {
					t.Fatal("output was not forwarded")
				}
				if _, err := dbutils.RequireTxWithError(r.Context()); !errors.Is(err, errResponseAlreadyForwarded) {
					t.Fatalf("request transaction opened after forwarding: %v", err)
				}
				_, _ = w.Write([]byte(" not saved"))
			})).ServeHTTP(recorder, commitTestRequest(http.MethodPost, "/api/save"))
			if state.commits != 0 || state.rollbacks != 0 {
				t.Fatalf("a transaction ran after forwarding: commits=%d rollbacks=%d", state.commits, state.rollbacks)
			}
		})
	}
}
