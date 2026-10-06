// foreign_keys_driver_test.go
// Provides the shared database driver for this package’s tests.
// Reuses existing package fixtures for offline regression checks.
// Keeps the request and permission contracts covered without a live site.
package dtt_foreign_keys

import (
	"context"
	"database/sql"
	"database/sql/driver"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/runtime_grants/granttest"
	"encoding/json"
	"fmt"
	"io"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

type foreignKeyQueryResponse struct {
	match string
	args  []driver.Value
	cols  []string
	rows  [][]driver.Value
	err   error
}

type foreignKeyExecResponse struct {
	match        string
	args         []driver.Value
	rowsAffected int64
	err          error
}

type foreignKeyQueryCall struct {
	query string
	args  []driver.NamedValue
}

type foreignKeyExecCall struct {
	query string
	args  []driver.NamedValue
}

type foreignKeyMockState struct {
	mu sync.Mutex

	queries []foreignKeyQueryResponse
	execs   []foreignKeyExecResponse

	actorRows         [][]driver.Value
	constraintColumns string
	queryCalls        []foreignKeyQueryCall
	execCalls         []foreignKeyExecCall
}

type foreignKeyMockDriver struct{ state *foreignKeyMockState }
type foreignKeyMockConn struct {
	state *foreignKeyMockState
	inTx  bool
}
type foreignKeyMockTx struct{ conn *foreignKeyMockConn }

type foreignKeyMockRows struct {
	cols []string
	rows [][]driver.Value
	idx  int
}

var foreignKeyDriverCounter int64

func (d *foreignKeyMockDriver) Open(string) (driver.Conn, error) {
	return &foreignKeyMockConn{state: d.state}, nil
}

func (c *foreignKeyMockConn) Prepare(string) (driver.Stmt, error) {
	return nil, fmt.Errorf("prepare not implemented in foreign-key mock")
}

func (c *foreignKeyMockConn) Close() error { return nil }

func (c *foreignKeyMockConn) Begin() (driver.Tx, error) {
	c.inTx = true
	return &foreignKeyMockTx{conn: c}, nil
}

func (c *foreignKeyMockConn) BeginTx(context.Context, driver.TxOptions) (driver.Tx, error) {
	c.inTx = true
	return &foreignKeyMockTx{conn: c}, nil
}

func (tx *foreignKeyMockTx) Commit() error   { tx.conn.inTx = false; return nil }
func (tx *foreignKeyMockTx) Rollback() error { tx.conn.inTx = false; return nil }

func (r *foreignKeyMockRows) Columns() []string { return append([]string(nil), r.cols...) }
func (r *foreignKeyMockRows) Close() error      { return nil }

func (r *foreignKeyMockRows) Next(dest []driver.Value) error {
	if r.idx >= len(r.rows) {
		return io.EOF
	}
	copy(dest, r.rows[r.idx])
	r.idx++
	return nil
}

func (c *foreignKeyMockConn) Query(query string, args []driver.Value) (driver.Rows, error) {
	named := make([]driver.NamedValue, len(args))
	for i, arg := range args {
		named[i] = driver.NamedValue{Ordinal: i + 1, Value: arg}
	}
	return c.QueryContext(context.Background(), query, named)
}

func (c *foreignKeyMockConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if rows, ok := granttest.BoundaryQuery(query, args); ok {
		return rows, nil
	}
	c.state.mu.Lock()
	defer c.state.mu.Unlock()

	c.state.queryCalls = append(c.state.queryCalls, foreignKeyQueryCall{
		query: query,
		args:  append([]driver.NamedValue(nil), args...),
	})

	if strings.Contains(query, "AS roles(actor_role)") {
		if !c.inTx {
			return nil, fmt.Errorf("actor read escaped request transaction")
		}
		return &foreignKeyMockRows{cols: []string{"column_name", "actor_role"}, rows: c.state.actorRows}, nil
	}
	if strings.Contains(query, "constraint_info.conname = $2") {
		if !c.inTx {
			return nil, fmt.Errorf("constraint read escaped request transaction")
		}
		columns := c.state.constraintColumns
		if columns == "" {
			columns = "{author_id}"
		}
		return &foreignKeyMockRows{cols: []string{"columns"}, rows: [][]driver.Value{{columns}}}, nil
	}
	if len(c.state.queries) == 0 {
		return nil, fmt.Errorf("unexpected query: %s", query)
	}

	resp := c.state.queries[0]
	c.state.queries = c.state.queries[1:]

	if resp.match != "" && !strings.Contains(query, resp.match) {
		return nil, fmt.Errorf("query %q does not contain expected marker %q", query, resp.match)
	}
	if resp.args != nil && !equalDriverValues(namedArgsToForeignKeyValues(args), resp.args) {
		return nil, fmt.Errorf("query args = %#v, want %#v", namedArgsToForeignKeyValues(args), resp.args)
	}
	if resp.err != nil {
		return nil, resp.err
	}

	return &foreignKeyMockRows{
		cols: append([]string(nil), resp.cols...),
		rows: cloneForeignKeyRows(resp.rows),
	}, nil
}

func (c *foreignKeyMockConn) Exec(query string, args []driver.Value) (driver.Result, error) {
	named := make([]driver.NamedValue, len(args))
	for i, arg := range args {
		named[i] = driver.NamedValue{Ordinal: i + 1, Value: arg}
	}
	return c.ExecContext(context.Background(), query, named)
}

func (c *foreignKeyMockConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	if granttest.IsPolicyLock(query) {
		return driver.RowsAffected(0), nil
	}
	c.state.mu.Lock()
	defer c.state.mu.Unlock()

	if strings.HasPrefix(query, "ALTER TABLE ") && !c.inTx {
		return nil, fmt.Errorf("DDL escaped request transaction")
	}
	c.state.execCalls = append(c.state.execCalls, foreignKeyExecCall{
		query: query,
		args:  append([]driver.NamedValue(nil), args...),
	})

	if len(c.state.execs) == 0 {
		return nil, fmt.Errorf("unexpected exec: %s", query)
	}

	resp := c.state.execs[0]
	c.state.execs = c.state.execs[1:]

	if resp.match != "" && !strings.Contains(query, resp.match) {
		return nil, fmt.Errorf("exec %q does not contain expected marker %q", query, resp.match)
	}
	if resp.args != nil && !equalDriverValues(namedArgsToForeignKeyValues(args), resp.args) {
		return nil, fmt.Errorf("exec args = %#v, want %#v", namedArgsToForeignKeyValues(args), resp.args)
	}
	if resp.err != nil {
		return nil, resp.err
	}

	return driver.RowsAffected(resp.rowsAffected), nil
}

func cloneForeignKeyRows(rows [][]driver.Value) [][]driver.Value {
	cloned := make([][]driver.Value, len(rows))
	for i, row := range rows {
		cloned[i] = append([]driver.Value(nil), row...)
	}
	return cloned
}

func openForeignKeyMockDB(t *testing.T, queries []foreignKeyQueryResponse, execs []foreignKeyExecResponse) (*sql.DB, *foreignKeyMockState) {
	granttest.ConfigureRoles(t)
	t.Helper()
	state := &foreignKeyMockState{
		queries: append([]foreignKeyQueryResponse(nil), queries...),
		execs:   append([]foreignKeyExecResponse(nil), execs...),
	}
	driverName := fmt.Sprintf("foreign_keys_%d", atomic.AddInt64(&foreignKeyDriverCounter, 1))
	sql.Register(driverName, &foreignKeyMockDriver{state: state})

	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open returned error: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})
	return db, state
}

func withForeignKeyDB(t *testing.T, db *sql.DB) {
	t.Helper()
	orig := backend.Db
	backend.Db = db
	t.Cleanup(func() {
		backend.Db = orig
	})
}

func namedArgsToForeignKeyValues(args []driver.NamedValue) []driver.Value {
	values := make([]driver.Value, len(args))
	for i, arg := range args {
		values[i] = arg.Value
	}
	return values
}

func equalDriverValues(got, want []driver.Value) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if fmt.Sprintf("%v", got[i]) != fmt.Sprintf("%v", want[i]) {
			return false
		}
	}
	return true
}

func decodeForeignKeyJSONMap(t *testing.T, rec *httptest.ResponseRecorder) map[string]interface{} {
	t.Helper()
	var body map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("json.Unmarshal(%q) returned error: %v", rec.Body.String(), err)
	}
	return body
}

func decodeForeignKeyJSONArray(t *testing.T, rec *httptest.ResponseRecorder) []string {
	t.Helper()
	var body []string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("json.Unmarshal(%q) returned error: %v", rec.Body.String(), err)
	}
	return body
}
