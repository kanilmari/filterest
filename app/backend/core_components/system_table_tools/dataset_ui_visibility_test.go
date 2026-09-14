// dataset_ui_visibility_test.go
// Verifies typed hide/restore requests and the administrator API.
// Bridges HTTP validation, transaction requirements and current readback.
// Exists to prevent accidental restore defaults and unrelated writes.
package system_table_tools

import (
	"context"
	"database/sql"
	"database/sql/driver"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"errors"
	"fmt"
	"io"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

type uiVisibilityState struct {
	hidden   bool
	writes   int
	queryErr error
}
type uiVisibilityDriver struct{ state *uiVisibilityState }
type uiVisibilityConn struct{ state *uiVisibilityState }
type uiVisibilityRows struct {
	values []driver.Value
	done   bool
}
type uiVisibilityTx struct{}

func (d uiVisibilityDriver) Open(string) (driver.Conn, error) { return uiVisibilityConn{d.state}, nil }
func (c uiVisibilityConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepare")
}
func (c uiVisibilityConn) Close() error              { return nil }
func (c uiVisibilityConn) Begin() (driver.Tx, error) { return uiVisibilityTx{}, nil }
func (uiVisibilityTx) Commit() error                 { return nil }
func (uiVisibilityTx) Rollback() error               { return nil }
func (r *uiVisibilityRows) Columns() []string        { return []string{"table_name", "ui_hidden"} }
func (r *uiVisibilityRows) Close() error             { return nil }
func (r *uiVisibilityRows) Next(dest []driver.Value) error {
	if r.done || r.values == nil {
		return io.EOF
	}
	r.done = true
	copy(dest, r.values)
	return nil
}
func (c uiVisibilityConn) QueryContext(_ context.Context, q string, args []driver.NamedValue) (driver.Rows, error) {
	if c.state.queryErr != nil {
		return nil, c.state.queryErr
	}
	if len(args) < 1 || args[0].Value != "fixture" {
		return &uiVisibilityRows{}, nil
	}
	if q == updateDatasetUIVisibilityQuery {
		c.state.writes++
		c.state.hidden = args[1].Value.(bool)
	} else if q != readDatasetUIVisibilityQuery {
		return nil, fmt.Errorf("unexpected query: %s", q)
	}
	return &uiVisibilityRows{values: []driver.Value{"fixture", c.state.hidden}}, nil
}

var uiVisibilityDriverID atomic.Int64

func setupUIVisibilityDB(t *testing.T, state *uiVisibilityState) *sql.DB {
	t.Helper()
	name := fmt.Sprintf("ui_visibility_%d", uiVisibilityDriverID.Add(1))
	sql.Register(name, uiVisibilityDriver{state})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	old := backend.Db
	backend.Db = db
	t.Cleanup(func() { db.Close(); backend.Db = old })
	return db
}
func TestDatasetUIVisibilityHideReadRestore(t *testing.T) {
	state := &uiVisibilityState{}
	db := setupUIVisibilityDB(t, state)
	for _, hidden := range []bool{true, false} {
		body := fmt.Sprintf(`{"dataset_name":"fixture","ui_hidden":%t}`, hidden)
		req := httptest.NewRequest("POST", "/api/admin/dataset-ui-visibility", strings.NewReader(body))
		lazy := dbutils.NewLazyTx(db)
		req = req.WithContext(dbutils.SetLazyTx(req.Context(), lazy))
		rec := httptest.NewRecorder()
		AdminDatasetUIVisibilityHandler(rec, req)
		if rec.Code != 200 || state.hidden != hidden {
			t.Fatalf("POST %t: %d %s", hidden, rec.Code, rec.Body)
		}
		if err := lazy.Commit(); err != nil {
			t.Fatal(err)
		}
		read := httptest.NewRecorder()
		AdminDatasetUIVisibilityHandler(read, httptest.NewRequest("GET", "/api/admin/dataset-ui-visibility?dataset_name=fixture", nil))
		if read.Code != 200 || !strings.Contains(read.Body.String(), fmt.Sprintf(`"ui_hidden":%t`, hidden)) {
			t.Fatalf("GET: %d %s", read.Code, read.Body)
		}
		if read.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("mutable setting must not be cached")
		}
	}
	if state.writes != 2 {
		t.Fatalf("writes=%d; GET must not write", state.writes)
	}
}
func TestDatasetUIVisibilityRejectsUnsafePayloadWithoutWrites(t *testing.T) {
	state := &uiVisibilityState{}
	setupUIVisibilityDB(t, state)
	for _, tc := range []struct {
		method, url, body string
		status            int
	}{
		{"DELETE", "/api/admin/dataset-ui-visibility", "", 405},
		{"GET", "/api/admin/dataset-ui-visibility", "", 400},
		{"POST", "/api/admin/dataset-ui-visibility", `{"dataset_name":"fixture"}`, 400},
		{"POST", "/api/admin/dataset-ui-visibility", `{"dataset_name":"fixture","ui_hidden":null}`, 400},
		{"POST", "/api/admin/dataset-ui-visibility", `{"dataset_name":"fixture","ui_hidden":"false"}`, 400},
		{"POST", "/api/admin/dataset-ui-visibility", `{"dataset_name":"fixture","ui_hidden":false,"extra":1}`, 400},
		{"POST", "/api/admin/dataset-ui-visibility", `{"dataset_name":"fixture","ui_hidden":false} {}`, 400},
		{"POST", "/api/admin/dataset-ui-visibility", `{"dataset_name":"bad-name","ui_hidden":false}`, 400},
		{"POST", "/api/admin/dataset-ui-visibility", `{"dataset_name":"fixture","ui_hidden":false}`, 500},
		{"GET", "/api/admin/dataset-ui-visibility?dataset_name=missing", "", 404},
	} {
		rec := httptest.NewRecorder()
		AdminDatasetUIVisibilityHandler(rec, httptest.NewRequest(tc.method, tc.url, strings.NewReader(tc.body)))
		if rec.Code != tc.status {
			t.Errorf("%s %s: got %d want%d; %s", tc.method, tc.body, rec.Code, tc.status, rec.Body)
		}
	}
	if state.writes != 0 {
		t.Fatalf("invalid requests wrote %d times", state.writes)
	}
}
func TestDatasetUIVisibilityDoesNotDiscloseDatabaseErrors(t *testing.T) {
	setupUIVisibilityDB(t, &uiVisibilityState{queryErr: errors.New("sensitive database detail")})
	rec := httptest.NewRecorder()
	AdminDatasetUIVisibilityHandler(rec, httptest.NewRequest("GET", "/api/admin/dataset-ui-visibility?dataset_name=fixture", nil))
	if rec.Code != 500 || strings.Contains(rec.Body.String(), "sensitive") {
		t.Fatalf("unsafe error: %d %s", rec.Code, rec.Body)
	}
}
