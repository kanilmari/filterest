// check_table_right_test.go
// Regression tests for single- and batch-style dataset permission checks.
// Bridges mocked auth sessions, mocked SQL permission rows, and the HTTP handlers.
// Exists to keep the dataset permission batching contract stable while we reduce frontend permission waterfalls.
package auth

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	e_sessions "easelect/backend/core_components/sessions"

	gorillaSessions "github.com/gorilla/sessions"
)

type checkTableRightsMockConfig struct {
	allowedRoutes []string
	tableUID      int64
}

type checkTableRightsMockDriver struct {
	cfg checkTableRightsMockConfig
}

type checkTableRightsMockConn struct {
	cfg checkTableRightsMockConfig
}

type checkTableRightsMockTx struct{}

type checkTableRightsMockRows struct {
	cols []string
	rows [][]driver.Value
	idx  int
}

func (d *checkTableRightsMockDriver) Open(_ string) (driver.Conn, error) {
	return &checkTableRightsMockConn{cfg: d.cfg}, nil
}

func (c *checkTableRightsMockConn) Prepare(_ string) (driver.Stmt, error) {
	return nil, fmt.Errorf("prepare not supported")
}

func (c *checkTableRightsMockConn) Close() error {
	return nil
}

func (c *checkTableRightsMockConn) Begin() (driver.Tx, error) {
	return &checkTableRightsMockTx{}, nil
}

func (t *checkTableRightsMockTx) Commit() error {
	return nil
}

func (t *checkTableRightsMockTx) Rollback() error {
	return nil
}

func (r *checkTableRightsMockRows) Columns() []string {
	return r.cols
}

func (r *checkTableRightsMockRows) Close() error {
	return nil
}

func (r *checkTableRightsMockRows) Next(dest []driver.Value) error {
	if r.idx >= len(r.rows) {
		return io.EOF
	}
	copy(dest, r.rows[r.idx])
	r.idx++
	return nil
}

func (c *checkTableRightsMockConn) Query(query string, args []driver.Value) (driver.Rows, error) {
	named := make([]driver.NamedValue, len(args))
	for i, value := range args {
		named[i] = driver.NamedValue{Ordinal: i + 1, Value: value}
	}
	return c.QueryContext(context.Background(), query, named)
}

func (c *checkTableRightsMockConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	switch {
	case strings.Contains(query, "SELECT table_uid FROM system_db_tables WHERE table_name = $1"):
		return &checkTableRightsMockRows{
			cols: []string{"table_uid"},
			rows: [][]driver.Value{{c.cfg.tableUID}},
		}, nil
	case strings.Contains(query, "SELECT DISTINCT f.url_route_endpoint"):
		rows := make([][]driver.Value, 0, len(c.cfg.allowedRoutes))
		for _, route := range c.cfg.allowedRoutes {
			rows = append(rows, []driver.Value{route})
		}
		return &checkTableRightsMockRows{
			cols: []string{"url_route_endpoint"},
			rows: rows,
		}, nil
	default:
		return nil, fmt.Errorf("unexpected query: %s", query)
	}
}

var checkTableRightsDriverCounter int64

func setupCheckTableRightsMockDB(t *testing.T, cfg checkTableRightsMockConfig) {
	t.Helper()
	orig := backend.Db
	driverName := fmt.Sprintf(
		"check_table_rights_%d_%d",
		time.Now().UnixNano(),
		atomic.AddInt64(&checkTableRightsDriverCounter, 1),
	)
	sql.Register(driverName, &checkTableRightsMockDriver{cfg: cfg})
	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open mock: %v", err)
	}
	backend.Db = db
	t.Cleanup(func() {
		_ = db.Close()
		backend.Db = orig
	})
}

func buildAuthSessionRequest(
	t *testing.T,
	store *gorillaSessions.CookieStore,
	method string,
	target string,
	body io.Reader,
	values map[interface{}]interface{},
) *http.Request {
	t.Helper()
	req := httptest.NewRequest(method, target, body)
	if values == nil {
		return req
	}

	cookieW := httptest.NewRecorder()
	cookieR := httptest.NewRequest(method, target, nil)
	session, err := store.Get(cookieR, e_sessions.SessionName)
	if err != nil {
		t.Fatalf("setup: store.Get: %v", err)
	}
	for key, value := range values {
		session.Values[key] = value
	}
	if saveErr := session.Save(cookieR, cookieW); saveErr != nil {
		t.Fatalf("setup: session.Save: %v", saveErr)
	}
	for _, cookie := range cookieW.Result().Cookies() {
		req.AddCookie(cookie)
	}
	return req
}

func TestCheckTableRightsHandlerReturnsAllowedMapForRequestedRoutes(t *testing.T) {
	store := setupAuthModesTestStore(t)
	setupCheckTableRightsMockDB(t, checkTableRightsMockConfig{
		allowedRoutes: []string{
			"/api/update-row",
			"/api/delete-rows",
		},
		tableUID: 42,
	})

	body := strings.NewReader(`{
		"dataset": "dev_agent_tasks",
		"routes": ["/api/update-row", "/api/delete-rows", "/api/modify-columns"]
	}`)
	req := buildAuthSessionRequest(t, store, http.MethodPost, "/api/check-table-rights", body, map[interface{}]interface{}{
		"user_id": 77,
	})
	rr := httptest.NewRecorder()

	CheckTableRightsHandler(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d, want %d", rr.Code, http.StatusOK)
	}

	var resp CheckTableRightsResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode body: %v", err)
	}

	expected := map[string]bool{
		"/api/update-row":     true,
		"/api/delete-rows":    true,
		"/api/modify-columns": false,
	}
	if len(resp.AllowedByRoute) != len(expected) {
		t.Fatalf("allowed_by_route length = %d, want %d", len(resp.AllowedByRoute), len(expected))
	}
	for route, want := range expected {
		if got := resp.AllowedByRoute[route]; got != want {
			t.Fatalf("allowed_by_route[%q] = %v, want %v", route, got, want)
		}
	}
}

func TestUserPermissionsHandlerReturnsEmptyArrayWhenNoRoutes(t *testing.T) {
	store := setupAuthModesTestStore(t)
	setupCheckTableRightsMockDB(t, checkTableRightsMockConfig{})
	req := buildAuthSessionRequest(t, store, http.MethodGet, "/api/user-permissions", nil, map[interface{}]interface{}{
		"user_id": 77,
	})
	rr := httptest.NewRecorder()

	UserPermissionsHandler(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d, want %d", rr.Code, http.StatusOK)
	}
	body := strings.TrimSpace(rr.Body.String())
	if body != `{"endpoints":[]}` {
		t.Fatalf("body = %s, want endpoints empty array", body)
	}
}

func TestCheckTableRightsMultiHandlerReturnsScopedResults(t *testing.T) {
	store := setupAuthModesTestStore(t)
	setupCheckTableRightsMockDB(t, checkTableRightsMockConfig{
		allowedRoutes: []string{
			"/api/update-row",
			"/api/delete-rows",
		},
		tableUID: 42,
	})

	body := strings.NewReader(`{
		"items": [
			{
				"dataset": "dev_agent_tasks",
				"routes": ["/api/update-row", "/api/modify-columns"]
			},
			{
				"dataset": "dev_agent_task_comments",
				"routes": ["/api/delete-rows"]
			}
		]
	}`)
	req := buildAuthSessionRequest(t, store, http.MethodPost, "/api/check-table-rights-multi", body, map[interface{}]interface{}{
		"user_id": 77,
	})
	rr := httptest.NewRecorder()

	CheckTableRightsMultiHandler(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d, want %d", rr.Code, http.StatusOK)
	}

	var resp CheckTableRightsMultiResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if len(resp.Results) != 2 {
		t.Fatalf("results length = %d, want 2", len(resp.Results))
	}

	first := resp.Results[0]
	if first.Dataset != "dev_agent_tasks" {
		t.Fatalf("first dataset = %q, want dev_agent_tasks", first.Dataset)
	}
	if got := first.AllowedByRoute["/api/update-row"]; got != true {
		t.Fatalf("first update-row = %v, want true", got)
	}
	if got := first.AllowedByRoute["/api/modify-columns"]; got != false {
		t.Fatalf("first modify-columns = %v, want false", got)
	}

	second := resp.Results[1]
	if second.Dataset != "dev_agent_task_comments" {
		t.Fatalf("second dataset = %q, want dev_agent_task_comments", second.Dataset)
	}
	if got := second.AllowedByRoute["/api/delete-rows"]; got != true {
		t.Fatalf("second delete-rows = %v, want true", got)
	}
}
