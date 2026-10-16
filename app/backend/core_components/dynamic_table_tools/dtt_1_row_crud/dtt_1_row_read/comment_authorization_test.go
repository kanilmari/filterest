// comment_authorization_test.go
// Tests comment reads and writes against dataset rights and row visibility.
// Connects real HTTP handlers to scripted permission, policy and comment storage.
// Prevents cross-dataset disclosure, orphan comments and shared-guest deletion.
package dtt_1_row_read

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	e_sessions "easelect/backend/core_components/sessions"
	"github.com/gorilla/sessions"
)

type commentTestDriver struct{ reads *scriptedReads }
type commentTestConn struct{ scriptedConn }

func (d commentTestDriver) Open(string) (driver.Conn, error) {
	return commentTestConn{scriptedConn{reads: d.reads, connection: "comments"}}, nil
}
func (c commentTestConn) ExecContext(_ context.Context, statement string, args []driver.NamedValue) (driver.Result, error) {
	values := make([]driver.Value, len(args))
	for i, arg := range args {
		values[i] = arg.Value
	}
	c.reads.record(scriptedStep{statement: statement, args: values})
	if !strings.HasPrefix(statement, "DELETE FROM system_comments") {
		return nil, fmt.Errorf("unexpected write: %s", statement)
	}
	return driver.RowsAffected(1), nil
}

func commentTestDB(t *testing.T, readable, visible bool, owner int) *scriptedReads {
	t.Helper()
	var granted [][]driver.Value
	if readable {
		granted = [][]driver.Value{{int64(1)}}
	}
	var storedOwner driver.Value = int64(owner)
	if owner == 0 {
		storedOwner = nil // Account deletion leaves an authorless comment.
	}
	reads := &scriptedReads{rules: []scriptedRule{
		{fragment: "FROM system_group_table_func_rights", columns: []string{"allowed"}, rows: granted,
			matches: func(args []driver.Value) bool {
				return len(args) == 3 && args[0] == "/api/get-results" && args[1] == int64(42) && args[2] == "parent_rows"
			}},
		{fragment: "must_be_true_unless_own", columns: []string{"column_name"}, rows: [][]driver.Value{{"published"}}},
		{fragment: "information_schema.columns", columns: []string{"exists"}, rows: [][]driver.Value{{false}}},
		{fragment: `SELECT EXISTS (SELECT 1 FROM "parent_rows"`, columns: []string{"visible"}, rows: [][]driver.Value{{visible}},
			matches: func(args []driver.Value) bool {
				return len(args) == 3 && args[0] == int64(7) && args[1] == "parent_rows" && args[2] == int64(42)
			}},
		{fragment: "SELECT COUNT(*) FROM system_comments", columns: []string{"count"}, rows: [][]driver.Value{{int64(1)}}},
		{fragment: "SELECT sc.id", columns: []string{"id", "text", "created_by", "username", "created"}},
		{fragment: "SELECT row_id, COUNT(*)", columns: []string{"row_id", "count"}, rows: [][]driver.Value{{int64(7), int64(1)}}},
		{fragment: "INSERT INTO system_comments", columns: []string{"id"}, rows: [][]driver.Value{{int64(99)}}},
		{fragment: "SELECT created_by FROM system_comments", columns: []string{"created_by"}, rows: [][]driver.Value{{storedOwner}}},
	}}
	name := fmt.Sprintf("comment_authorization_%d", scriptedDriverCounter.Add(1))
	sql.Register(name, commentTestDriver{reads})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	oldDB, oldBasic := backend.Db, backend.DbBasic
	backend.Db, backend.DbBasic = db, db
	t.Cleanup(func() { backend.Db, backend.DbBasic = oldDB, oldBasic; db.Close() })
	return reads
}

func commentTestRequest(t *testing.T, method, target, body string, user int, role string) *http.Request {
	t.Helper()
	oldStore, oldName := e_sessions.Store, e_sessions.SessionName
	store := sessions.NewCookieStore([]byte("comment-test-signing-key-32-bytes!"))
	e_sessions.Store, e_sessions.SessionName = store, "comment-test"
	t.Cleanup(func() { e_sessions.Store, e_sessions.SessionName = oldStore, oldName })
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	rec := httptest.NewRecorder()
	session, _ := store.Get(req, e_sessions.SessionName)
	session.Values["user_id"], session.Values["user_role"] = user, role
	if err := session.Save(req, rec); err != nil {
		t.Fatal(err)
	}
	for _, cookie := range rec.Result().Cookies() {
		req.AddCookie(cookie)
	}
	return req.WithContext(dbutils.SetRequestActorContext(req.Context(), dbutils.NewRequestActorContext(user, role)))
}

func TestCommentsRequireReadableDatasetAndVisibleRow(t *testing.T) {
	for _, operation := range []struct {
		name, method, target, body string
		handler                    http.HandlerFunc
	}{
		{"list", "GET", "/api/comments?dataset=parent_rows&row_id=7", "", CommentListHandler},
		{"count", "POST", "/api/comment-counts", `{"dataset":"parent_rows","row_ids":[7]}`, CommentCountHandler},
		{"create", "POST", "/api/comments/create", `{"dataset":"parent_rows","row_id":7,"comment_text":"hello"}`, CommentCreateHandler},
	} {
		for _, visibility := range []struct {
			name              string
			readable, visible bool
			status            int
		}{
			{"unreadable dataset", false, true, 403},
			{"hidden row", true, false, 404},
			{"nonexistent row", true, false, 404},
			{"visible row", true, true, 200},
		} {
			t.Run(operation.name+"/"+visibility.name, func(t *testing.T) {
				reads := commentTestDB(t, visibility.readable, visibility.visible, 42)
				req := commentTestRequest(t, operation.method, operation.target, operation.body, 42, "basic")
				rec := httptest.NewRecorder()
				operation.handler(rec, req)
				if rec.Code != visibility.status {
					t.Fatalf("status=%d want=%d: %s", rec.Code, visibility.status, rec.Body.String())
				}
				steps, unexpected := reads.recorded()
				if len(unexpected) > 0 {
					t.Fatalf("unexpected queries: %v", unexpected)
				}
				for _, step := range steps {
					if visibility.status != 200 && strings.Contains(step.statement, "system_comments") {
						t.Fatal("denied request touched comment storage")
					}
					if strings.HasPrefix(step.statement, `SELECT EXISTS (SELECT 1 FROM "parent_rows"`) && (!strings.Contains(step.statement, `"published" = TRUE`) || !strings.Contains(step.statement, "resolve_effective_row_access")) {
						t.Fatal("row visibility omitted mandatory flags or exact-row rules")
					}
				}
			})
		}
	}
}

func TestCommentDeleteGuestOwnerAndAdmin(t *testing.T) {
	for _, test := range []struct {
		name        string
		user, owner int
		role        string
		status      int
	}{
		{"guest own", 1, 1, "guest", 403},
		{"guest with admin role", 1, 1, "admin", 403},
		{"owner", 42, 42, "basic", 200},
		{"other user", 42, 43, "basic", 403},
		{"admin any", 42, 43, "admin", 200},
		{"admin removed author", 42, 0, "admin", 200},
		{"nonadmin removed author", 42, 0, "basic", 403},
	} {
		t.Run(test.name, func(t *testing.T) {
			reads := commentTestDB(t, false, false, test.owner)
			rec := httptest.NewRecorder()
			CommentDeleteHandler(rec, commentTestRequest(t, "DELETE", "/api/comments/delete?id=99", "", test.user, test.role))
			if rec.Code != test.status {
				t.Fatalf("status=%d want=%d: %s", rec.Code, test.status, rec.Body.String())
			}
			steps, unexpected := reads.recorded()
			if len(unexpected) > 0 {
				t.Fatalf("unexpected queries: %v", unexpected)
			}
			deleted := false
			for _, step := range steps {
				if strings.HasPrefix(step.statement, "DELETE FROM system_comments") {
					deleted = true
				}
			}
			if deleted != (test.status == 200) {
				t.Fatalf("delete=%t status=%d", deleted, test.status)
			}
			if test.user == 1 && len(steps) > 0 {
				t.Fatal("guest reached comment storage")
			}
		})
	}
}
