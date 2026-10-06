// table_folders_driver_test.go
// Provides the shared database driver for this package’s tests.
// Reuses existing package fixtures for offline regression checks.
// Keeps the request and permission contracts covered without a live site.
package dtt_system_table_folders

import (
	"context"
	"database/sql"
	"database/sql/driver"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/runtime_grants/granttest"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

type folderQueryResponse struct {
	match string
	args  []driver.Value
	cols  []string
	rows  [][]driver.Value
	err   error
}

type folderExecResponse struct {
	match        string
	rowsAffected int64
	err          error
}

type folderExecCall struct {
	query string
	args  []driver.NamedValue
}

type folderMockState struct {
	mu sync.Mutex

	queries []folderQueryResponse
	execs   []folderExecResponse
	calls   []folderExecCall
}

type folderMockDriver struct{ state *folderMockState }
type folderMockConn struct{ state *folderMockState }
type folderMockTx struct{}

type folderMockRows struct {
	cols []string
	rows [][]driver.Value
	idx  int
}

var folderDriverCounter int64

func (d *folderMockDriver) Open(string) (driver.Conn, error) {
	return &folderMockConn{state: d.state}, nil
}

func (c *folderMockConn) Prepare(string) (driver.Stmt, error) {
	return nil, fmt.Errorf("prepare not implemented in table-folders mock")
}

func (c *folderMockConn) Close() error { return nil }

func (c *folderMockConn) Begin() (driver.Tx, error) {
	return &folderMockTx{}, nil
}

func (c *folderMockConn) BeginTx(context.Context, driver.TxOptions) (driver.Tx, error) {
	return &folderMockTx{}, nil
}

func (*folderMockTx) Commit() error   { return nil }
func (*folderMockTx) Rollback() error { return nil }

func (r *folderMockRows) Columns() []string { return append([]string(nil), r.cols...) }
func (r *folderMockRows) Close() error      { return nil }

func (r *folderMockRows) Next(dest []driver.Value) error {
	if r.idx >= len(r.rows) {
		return io.EOF
	}
	copy(dest, r.rows[r.idx])
	r.idx++
	return nil
}

func (c *folderMockConn) Query(query string, args []driver.Value) (driver.Rows, error) {
	named := make([]driver.NamedValue, len(args))
	for i, arg := range args {
		named[i] = driver.NamedValue{Ordinal: i + 1, Value: arg}
	}
	return c.QueryContext(context.Background(), query, named)
}

func folderValuesEqual(got []driver.Value, want []driver.Value) bool {
	if want == nil {
		return true
	}
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if fmt.Sprint(got[i]) != fmt.Sprint(want[i]) {
			return false
		}
	}
	return true
}

func (c *folderMockConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if strings.Contains(query, `SELECT "table_uid" FROM "public"."system_db_tables"`) {
		return &folderMockRows{cols: []string{"table_uid"}, rows: [][]driver.Value{{int64(77)}}}, nil
	}
	if strings.HasPrefix(query, "SELECT r.id,r.target_insert_specs,COALESCE(") {
		return &folderMockRows{cols: []string{"id", "specs", "destination"}}, nil
	}
	if rows, ok := granttest.BoundaryQuery(query, args); ok {
		return rows, nil
	}
	c.state.mu.Lock()
	defer c.state.mu.Unlock()

	for _, resp := range c.state.queries {
		if strings.Contains(query, resp.match) && folderValuesEqual(namedArgsToFolderValues(args), resp.args) {
			if resp.err != nil {
				return nil, resp.err
			}
			return &folderMockRows{
				cols: append([]string(nil), resp.cols...),
				rows: cloneFolderRows(resp.rows),
			}, nil
		}
	}

	return nil, fmt.Errorf("unexpected query: %s", query)
}

func (c *folderMockConn) Exec(query string, args []driver.Value) (driver.Result, error) {
	named := make([]driver.NamedValue, len(args))
	for i, arg := range args {
		named[i] = driver.NamedValue{Ordinal: i + 1, Value: arg}
	}
	return c.ExecContext(context.Background(), query, named)
}

func (c *folderMockConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	if granttest.IsPolicyLock(query) {
		return driver.RowsAffected(0), nil
	}
	c.state.mu.Lock()
	defer c.state.mu.Unlock()

	c.state.calls = append(c.state.calls, folderExecCall{
		query: query,
		args:  append([]driver.NamedValue(nil), args...),
	})

	for _, resp := range c.state.execs {
		if strings.Contains(query, resp.match) {
			if resp.err != nil {
				return nil, resp.err
			}
			return driver.RowsAffected(resp.rowsAffected), nil
		}
	}

	return nil, fmt.Errorf("unexpected exec: %s", query)
}

func cloneFolderRows(rows [][]driver.Value) [][]driver.Value {
	cloned := make([][]driver.Value, len(rows))
	for i, row := range rows {
		cloned[i] = append([]driver.Value(nil), row...)
	}
	return cloned
}

func openFolderMockDB(t *testing.T, queries []folderQueryResponse, execs []folderExecResponse) (*sql.DB, *folderMockState) {
	granttest.ConfigureRoles(t)
	t.Helper()
	state := &folderMockState{
		queries: append([]folderQueryResponse(nil), queries...),
		execs:   append([]folderExecResponse(nil), execs...),
	}
	driverName := fmt.Sprintf("table_folders_%d", atomic.AddInt64(&folderDriverCounter, 1))
	sql.Register(driverName, &folderMockDriver{state: state})

	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open returned error: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})
	return db, state
}

func withFolderDB(t *testing.T, db *sql.DB) {
	t.Helper()
	orig := backend.Db
	backend.Db = db
	t.Cleanup(func() {
		backend.Db = orig
	})
}

func withFolderTx(req *http.Request, db *sql.DB) *http.Request {
	lt := dbutils.NewLazyTx(db)
	return req.WithContext(dbutils.SetLazyTx(req.Context(), lt))
}

func decodeFolderJSON(t *testing.T, rec *httptest.ResponseRecorder) map[string]interface{} {
	t.Helper()
	var body map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("json.Unmarshal(%q) returned error: %v", rec.Body.String(), err)
	}
	return body
}

func namedArgsToFolderValues(args []driver.NamedValue) []driver.Value {
	values := make([]driver.Value, len(args))
	for i, arg := range args {
		values[i] = arg.Value
	}
	return values
}
