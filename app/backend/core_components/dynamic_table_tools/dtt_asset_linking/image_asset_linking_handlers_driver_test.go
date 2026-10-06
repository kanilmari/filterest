// image_asset_linking_handlers_driver_test.go
// Provides the shared database driver for this package’s tests.
// Reuses existing package fixtures for offline regression checks.
// Keeps the request and permission contracts covered without a live site.
package dtt_asset_linking

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

type imageAssetLinkingQueryResponse struct {
	match string
	cols  []string
	rows  [][]driver.Value
	err   error
}

type imageAssetLinkingExecResponse struct {
	match        string
	rowsAffected int64
	err          error
}

type imageAssetLinkingExecCall struct {
	query string
	args  []driver.NamedValue
}

type imageAssetLinkingMockState struct {
	mu sync.Mutex

	queries []imageAssetLinkingQueryResponse
	execs   []imageAssetLinkingExecResponse
	calls   []imageAssetLinkingExecCall
}

type imageAssetLinkingMockDriver struct{ state *imageAssetLinkingMockState }
type imageAssetLinkingMockConn struct{ state *imageAssetLinkingMockState }
type imageAssetLinkingMockTx struct{}

type imageAssetLinkingMockRows struct {
	cols []string
	rows [][]driver.Value
	idx  int
}

var imageAssetLinkingDriverCounter int64

func (d *imageAssetLinkingMockDriver) Open(string) (driver.Conn, error) {
	return &imageAssetLinkingMockConn{state: d.state}, nil
}

func (c *imageAssetLinkingMockConn) Prepare(string) (driver.Stmt, error) {
	return nil, fmt.Errorf("prepare not implemented in image-asset-linking mock")
}

func (c *imageAssetLinkingMockConn) Close() error { return nil }

func (c *imageAssetLinkingMockConn) Begin() (driver.Tx, error) {
	return &imageAssetLinkingMockTx{}, nil
}

func (c *imageAssetLinkingMockConn) BeginTx(context.Context, driver.TxOptions) (driver.Tx, error) {
	return &imageAssetLinkingMockTx{}, nil
}

func (*imageAssetLinkingMockTx) Commit() error   { return nil }
func (*imageAssetLinkingMockTx) Rollback() error { return nil }

func (r *imageAssetLinkingMockRows) Columns() []string { return append([]string(nil), r.cols...) }
func (r *imageAssetLinkingMockRows) Close() error      { return nil }

func (r *imageAssetLinkingMockRows) Next(dest []driver.Value) error {
	if r.idx >= len(r.rows) {
		return io.EOF
	}
	copy(dest, r.rows[r.idx])
	r.idx++
	return nil
}

func (c *imageAssetLinkingMockConn) Query(query string, args []driver.Value) (driver.Rows, error) {
	named := make([]driver.NamedValue, len(args))
	for i, arg := range args {
		named[i] = driver.NamedValue{Ordinal: i + 1, Value: arg}
	}
	return c.QueryContext(context.Background(), query, named)
}

func (c *imageAssetLinkingMockConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if rows, ok := granttest.BoundaryQuery(query, args); ok {
		return rows, nil
	}
	c.state.mu.Lock()
	defer c.state.mu.Unlock()

	for _, resp := range c.state.queries {
		if strings.Contains(query, resp.match) {
			if resp.err != nil {
				return nil, resp.err
			}
			return &imageAssetLinkingMockRows{
				cols: append([]string(nil), resp.cols...),
				rows: cloneImageLinkingRows(resp.rows),
			}, nil
		}
	}

	return nil, fmt.Errorf("unexpected query: %s", query)
}

func (c *imageAssetLinkingMockConn) Exec(query string, args []driver.Value) (driver.Result, error) {
	named := make([]driver.NamedValue, len(args))
	for i, arg := range args {
		named[i] = driver.NamedValue{Ordinal: i + 1, Value: arg}
	}
	return c.ExecContext(context.Background(), query, named)
}

func (c *imageAssetLinkingMockConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	if granttest.IsPolicyLock(query) {
		return driver.RowsAffected(0), nil
	}
	c.state.mu.Lock()
	defer c.state.mu.Unlock()

	c.state.calls = append(c.state.calls, imageAssetLinkingExecCall{
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

func cloneImageLinkingRows(rows [][]driver.Value) [][]driver.Value {
	cloned := make([][]driver.Value, len(rows))
	for i, row := range rows {
		cloned[i] = append([]driver.Value(nil), row...)
	}
	return cloned
}

func openImageLinkingMockDB(t *testing.T, queries []imageAssetLinkingQueryResponse, execs []imageAssetLinkingExecResponse) (*sql.DB, *imageAssetLinkingMockState) {
	granttest.ConfigureRoles(t)
	t.Helper()
	state := &imageAssetLinkingMockState{
		queries: append([]imageAssetLinkingQueryResponse(nil), queries...),
		execs:   append([]imageAssetLinkingExecResponse(nil), execs...),
	}
	driverName := fmt.Sprintf("image_asset_linking_%d_%d", atomic.AddInt64(&imageAssetLinkingDriverCounter, 1), len(queries)+len(execs))
	sql.Register(driverName, &imageAssetLinkingMockDriver{state: state})

	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open returned error: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})
	return db, state
}

func withImageLinkingDB(t *testing.T, db *sql.DB) {
	t.Helper()
	orig := backend.Db
	backend.Db = db
	t.Cleanup(func() {
		backend.Db = orig
	})
}

func withImageLinkingTx(req *http.Request, db *sql.DB) *http.Request {
	lt := dbutils.NewLazyTx(db)
	return req.WithContext(dbutils.SetLazyTx(req.Context(), lt))
}

func decodeJSONBody(t *testing.T, rec *httptest.ResponseRecorder) map[string]interface{} {
	t.Helper()
	var body map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("json.Unmarshal(%q) returned error: %v", rec.Body.String(), err)
	}
	return body
}

func namedArgsToValues(args []driver.NamedValue) []driver.Value {
	values := make([]driver.Value, len(args))
	for i, arg := range args {
		values[i] = arg.Value
	}
	return values
}

type imageAssetLinkingExecStub struct {
	query string
	args  []interface{}
	err   error
}

func (s *imageAssetLinkingExecStub) Query(string, ...interface{}) (*sql.Rows, error) { return nil, nil }
func (s *imageAssetLinkingExecStub) QueryRow(string, ...interface{}) *sql.Row        { return nil }

func (s *imageAssetLinkingExecStub) Exec(query string, args ...interface{}) (sql.Result, error) {
	s.query = query
	s.args = append([]interface{}(nil), args...)
	if s.err != nil {
		return nil, s.err
	}
	return driver.RowsAffected(1), nil
}
