// dataset_ui_read_guard_test.go
// Verifies hidden row reads stop before any dataset data or embedding request.
// Bridges ordinary/vector handlers, test sessions and a metadata-only database.
// Exists to keep alternate search modes and stale browser requests within UI visibility.
package dtt_1_row_read

import (
	"context"
	"database/sql"
	"database/sql/driver"
	backend "easelect/backend/core_components"
	e_sessions "easelect/backend/core_components/sessions"
	"errors"
	"fmt"
	"github.com/gorilla/sessions"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

type uiReadState struct {
	hidden, fail bool
	queries      int
	userID       int
}
type uiReadDriver struct{ state *uiReadState }
type uiReadConn struct{ state *uiReadState }
type uiReadRows struct {
	value bool
	done  bool
}

func (d uiReadDriver) Open(string) (driver.Conn, error) { return uiReadConn{d.state}, nil }
func (c uiReadConn) Close() error                       { return nil }
func (c uiReadConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepare")
}
func (c uiReadConn) Begin() (driver.Tx, error) { return nil, errors.New("unexpected transaction") }
func (r *uiReadRows) Columns() []string        { return []string{"hidden"} }
func (r *uiReadRows) Close() error             { return nil }
func (r *uiReadRows) Next(dest []driver.Value) error {
	if r.done {
		return io.EOF
	}
	r.done = true
	dest[0] = r.value
	return nil
}
func (c uiReadConn) QueryContext(_ context.Context, q string, args []driver.NamedValue) (driver.Rows, error) {
	c.state.queries++
	userID := c.state.userID
	if userID == 0 {
		userID = 42
	}
	if !strings.Contains(q, "dataset.ui_hidden") || args[0].Value != "fixture" || args[1].Value != int64(userID) {
		return nil, fmt.Errorf("unexpected query or scope")
	}
	if c.state.fail {
		return nil, errors.New("metadata failed")
	}
	return &uiReadRows{value: c.state.hidden}, nil
}

var uiReadDriverID atomic.Int64

func setupUIReadDB(t *testing.T, state *uiReadState) {
	t.Helper()
	name := fmt.Sprintf("ui_read_%d", uiReadDriverID.Add(1))
	sql.Register(name, uiReadDriver{state})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	old := backend.Db
	backend.Db = db
	t.Cleanup(func() { db.Close(); backend.Db = old })
}
func TestHiddenDatasetResultHandlersStopBeforeDataRead(t *testing.T) {
	for name, handler := range map[string]http.HandlerFunc{"ordinary": GetResults, "semantic": GetResultsVector} {
		for _, fail := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/error=%t", name, fail), func(t *testing.T) {
				state := &uiReadState{hidden: true, fail: fail}
				setupUIReadDB(t, state)
				oldStore, oldName := e_sessions.Store, e_sessions.SessionName
				e_sessions.Store = sessions.NewCookieStore([]byte("wl74-read-guard-test-key-32-bytes"))
				e_sessions.SessionName = "session"
				t.Cleanup(func() { e_sessions.Store = oldStore; e_sessions.SessionName = oldName })
				req := httptest.NewRequest("GET", "/api/get-results?dataset=fixture", nil)
				session, err := e_sessions.Store.Get(req, e_sessions.SessionName)
				if err != nil {
					t.Fatal(err)
				}
				session.Values["user_id"] = 42
				session.Values["user_role"] = "basic"
				cookieResponse := httptest.NewRecorder()
				if err = session.Save(req, cookieResponse); err != nil {
					t.Fatal(err)
				}
				for _, cookie := range cookieResponse.Result().Cookies() {
					req.AddCookie(cookie)
				}
				rec := httptest.NewRecorder()
				handler(rec, req)
				want := 404
				if fail {
					want = 503
				}
				if rec.Code != want || state.queries != 1 {
					t.Fatalf("status=%d want%d queries=%d body=%s", rec.Code, want, state.queries, rec.Body)
				}
				if strings.Contains(rec.Body.String(), "retained row") {
					t.Fatal("row contents leaked")
				}
			})
		}
	}
}
func TestVisibleDatasetReadContinues(t *testing.T) {
	state := &uiReadState{}
	setupUIReadDB(t, state)
	rec := httptest.NewRecorder()
	if !allowDatasetUIRead(rec, "fixture", 42) {
		t.Fatalf("visible dataset blocked: %s", rec.Body)
	}
	if state.queries != 1 {
		t.Fatalf("queries=%d", state.queries)
	}
}

// Both public intelligent-search modes must stop at visibility metadata before
// full-text/vector fetches. Visible/admin cases use the existing missing-query
// response to prove dispatch continued without requiring any dataset SQL pool.
func TestIntelligentSearchVisibilityBeforeBothResponseModes(t *testing.T) {
	for _, stream := range []string{"0", "1"} {
		for _, tc := range []struct {
			name, role   string
			userID       int
			hidden, fail bool
			want         int
		}{
			{"hidden_basic", "basic", 42, true, false, 404},
			{"hidden_guest", "guest", 1, true, false, 404},
			{"metadata_failure", "basic", 42, true, true, 503},
			{"visible_basic", "basic", 42, false, false, 500},
			{"hidden_admin_is_allowed_by_shared_policy", "admin", 7, false, false, 500},
		} {
			t.Run("stream="+stream+"/"+tc.name, func(t *testing.T) {
				state := &uiReadState{hidden: tc.hidden, fail: tc.fail, userID: tc.userID}
				setupUIReadDB(t, state)
				oldStore, oldName := e_sessions.Store, e_sessions.SessionName
				e_sessions.Store = sessions.NewCookieStore([]byte("wl74-intelligent-guard-test-key-32"))
				e_sessions.SessionName = "session"
				t.Cleanup(func() { e_sessions.Store = oldStore; e_sessions.SessionName = oldName })
				query := "visible"
				if tc.want == 500 {
					query = ""
				}
				req := httptest.NewRequest("GET", "/api/get-intelligent-results?dataset=fixture&query="+query+"&stream="+stream, nil)
				session, err := e_sessions.Store.Get(req, e_sessions.SessionName)
				if err != nil {
					t.Fatal(err)
				}
				session.Values["user_id"] = tc.userID
				session.Values["user_role"] = tc.role
				cookieResponse := httptest.NewRecorder()
				if err = session.Save(req, cookieResponse); err != nil {
					t.Fatal(err)
				}
				for _, cookie := range cookieResponse.Result().Cookies() {
					req.AddCookie(cookie)
				}
				rec := httptest.NewRecorder()
				GetIntelligentResultsHandlerWrapper(rec, req)
				if rec.Code != tc.want || state.queries != 1 || rec.Flushed {
					t.Fatalf("status=%d want=%d metadata queries=%d flushed=%t body=%s", rec.Code, tc.want, state.queries, rec.Flushed, rec.Body.String())
				}
				if tc.want == 500 && !strings.Contains(rec.Body.String(), "internal error") {
					t.Fatalf("visible/admin search did not continue after shared policy: %s", rec.Body.String())
				}
				if tc.want == 404 && rec.Header().Get("Cache-Control") != "no-store" {
					t.Fatal("hidden response could be cached")
				}
				for _, key := range []string{`"stage"`, `"columns"`, `"data"`} {
					if strings.Contains(rec.Body.String(), key) {
						t.Fatalf("search packet leaked: %s", rec.Body.String())
					}
				}
			})
		}
	}
}
