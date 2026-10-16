// db.go
// Supplies a read-only in-memory SQL driver for security boundary tests.
// Connects real handlers to explicit test query responses without external services.
// Unexpected writes fail, making read-route side effects visible.
package queryfixture

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"easelect/backend/core_components/dbutils"
	e_sessions "easelect/backend/core_components/sessions"
	"errors"
	"github.com/gorilla/sessions"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type Query func(string, []driver.NamedValue) (driver.Rows, error)
type connector struct{ query Query }
type conn struct{ query Query }
type tx struct{}
type rows struct {
	columns []string
	values  [][]driver.Value
}

func Open(t *testing.T, query Query) *sql.DB {
	t.Helper()
	db := sql.OpenDB(connector{query})
	t.Cleanup(func() { db.Close() })
	return db
}
func Rows(columns []string, values ...[]driver.Value) driver.Rows { return &rows{columns, values} }
func (c connector) Connect(context.Context) (driver.Conn, error)  { return conn{c.query}, nil }
func (c connector) Driver() driver.Driver                         { return c }
func (c connector) Open(string) (driver.Conn, error)              { return conn{c.query}, nil }
func (c conn) Prepare(string) (driver.Stmt, error)                { return nil, errors.New("unexpected prepare") }
func (c conn) Close() error                                       { return nil }
func (c conn) Begin() (driver.Tx, error)                          { return tx{}, nil }
func (tx) Commit() error                                          { return nil }
func (tx) Rollback() error                                        { return nil }
func (c conn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	return c.query(query, args)
}
func (c conn) ExecContext(context.Context, string, []driver.NamedValue) (driver.Result, error) {
	return nil, errors.New("unexpected write")
}
func (r *rows) Columns() []string { return r.columns }
func (r *rows) Close() error      { return nil }
func (r *rows) Next(dest []driver.Value) error {
	if len(r.values) == 0 {
		return io.EOF
	}
	copy(dest, r.values[0])
	r.values = r.values[1:]
	return nil
}

// Request supplies a signed test session and the actor attached by authentication.
func Request(t *testing.T, method, path, body string, id int, role string) *http.Request {
	t.Helper()
	oldStore, oldName := e_sessions.Store, e_sessions.SessionName
	store := sessions.NewCookieStore([]byte("security-fixture-cookie-signing-material"))
	e_sessions.Store, e_sessions.SessionName = store, "sec4-fixture"
	t.Cleanup(func() { e_sessions.Store, e_sessions.SessionName = oldStore, oldName })
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	session, err := e_sessions.Load(req)
	if err != nil {
		t.Fatal(err)
	}
	if id > 0 {
		session.Values["user_id"] = id
		session.Values["user_role"] = role
	}
	rec := httptest.NewRecorder()
	if err := e_sessions.Save(rec, req, session); err != nil {
		t.Fatal(err)
	}
	for _, cookie := range rec.Result().Cookies() {
		req.AddCookie(cookie)
	}
	return req.WithContext(dbutils.SetRequestActorContext(req.Context(), dbutils.NewRequestActorContext(id, role)))
}
