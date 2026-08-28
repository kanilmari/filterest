// foreign_keys_test.go
// Unit tests for foreign-key handlers and lightweight sync/helper logic.
// Uses a local database/sql driver double so we can cover validation, query/exec, and limited sync branches without touching production code or requiring a live PostgreSQL instance.
package dtt_foreign_keys

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
	"sync"
	"sync/atomic"
	"testing"

	backend "easelect/backend/core_components"
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

	queryCalls []foreignKeyQueryCall
	execCalls  []foreignKeyExecCall
}

type foreignKeyMockDriver struct{ state *foreignKeyMockState }
type foreignKeyMockConn struct{ state *foreignKeyMockState }
type foreignKeyMockTx struct{}

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
	return &foreignKeyMockTx{}, nil
}

func (c *foreignKeyMockConn) BeginTx(context.Context, driver.TxOptions) (driver.Tx, error) {
	return &foreignKeyMockTx{}, nil
}

func (*foreignKeyMockTx) Commit() error   { return nil }
func (*foreignKeyMockTx) Rollback() error { return nil }

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
	c.state.mu.Lock()
	defer c.state.mu.Unlock()

	c.state.queryCalls = append(c.state.queryCalls, foreignKeyQueryCall{
		query: query,
		args:  append([]driver.NamedValue(nil), args...),
	})

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
	c.state.mu.Lock()
	defer c.state.mu.Unlock()

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

func TestAddForeignKeyHandlerRejectsMethodJSONAndMissingFields(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/add-foreign-key", nil)
	rec := httptest.NewRecorder()
	AddForeignKeyHandler(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("wrong-method status = %d, want 405", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/add-foreign-key", strings.NewReader("{"))
	rec = httptest.NewRecorder()
	AddForeignKeyHandler(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid-json status = %d, want 400", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/add-foreign-key", strings.NewReader(`{"referencing_dataset":"posts"}`))
	rec = httptest.NewRecorder()
	AddForeignKeyHandler(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("missing-fields status = %d, want 400", rec.Code)
	}
}

func TestAddForeignKeyHandlerHandlesTableColumnAndSuccessBranches(t *testing.T) {
	t.Run("missing table", func(t *testing.T) {
		db, _ := openForeignKeyMockDB(t, []foreignKeyQueryResponse{
			{
				match: "FROM information_schema.tables",
				args:  []driver.Value{"posts"},
				cols:  []string{"exists"},
				rows:  [][]driver.Value{{false}},
			},
		}, nil)
		withForeignKeyDB(t, db)

		req := httptest.NewRequest(http.MethodPost, "/api/add-foreign-key", strings.NewReader(`{
			"referencing_dataset":"posts",
			"referencing_column":"author_id",
			"referenced_dataset":"users",
			"referenced_column":"id"
		}`))
		rec := httptest.NewRecorder()
		AddForeignKeyHandler(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "does not exist") {
			t.Fatalf("body = %q, want missing-table error", rec.Body.String())
		}
	})

	t.Run("missing column", func(t *testing.T) {
		db, _ := openForeignKeyMockDB(t, []foreignKeyQueryResponse{
			{
				match: "FROM information_schema.tables",
				args:  []driver.Value{"posts"},
				cols:  []string{"exists"},
				rows:  [][]driver.Value{{true}},
			},
			{
				match: "FROM information_schema.tables",
				args:  []driver.Value{"users"},
				cols:  []string{"exists"},
				rows:  [][]driver.Value{{true}},
			},
			{
				match: "FROM information_schema.columns",
				args:  []driver.Value{"posts", "author_id"},
				cols:  []string{"exists"},
				rows:  [][]driver.Value{{false}},
			},
		}, nil)
		withForeignKeyDB(t, db)

		req := httptest.NewRequest(http.MethodPost, "/api/add-foreign-key", strings.NewReader(`{
			"referencing_dataset":"posts",
			"referencing_column":"author_id",
			"referenced_dataset":"users",
			"referenced_column":"id"
		}`))
		rec := httptest.NewRecorder()
		AddForeignKeyHandler(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "columns does not exist") &&
			!strings.Contains(rec.Body.String(), "columns do not exist") &&
			!strings.Contains(rec.Body.String(), "columns") {
			t.Fatalf("body = %q, want missing-column error", rec.Body.String())
		}
	})

	t.Run("success", func(t *testing.T) {
		db, state := openForeignKeyMockDB(t, []foreignKeyQueryResponse{
			{
				match: "FROM information_schema.tables",
				args:  []driver.Value{"posts"},
				cols:  []string{"exists"},
				rows:  [][]driver.Value{{true}},
			},
			{
				match: "FROM information_schema.tables",
				args:  []driver.Value{"users"},
				cols:  []string{"exists"},
				rows:  [][]driver.Value{{true}},
			},
			{
				match: "FROM information_schema.columns",
				args:  []driver.Value{"posts", "author_id"},
				cols:  []string{"exists"},
				rows:  [][]driver.Value{{true}},
			},
			{
				match: "FROM information_schema.columns",
				args:  []driver.Value{"users", "id"},
				cols:  []string{"exists"},
				rows:  [][]driver.Value{{true}},
			},
		}, []foreignKeyExecResponse{
			{
				match:        "ALTER TABLE",
				rowsAffected: 1,
			},
		})
		withForeignKeyDB(t, db)

		req := httptest.NewRequest(http.MethodPost, "/api/add-foreign-key", strings.NewReader(`{
			"referencing_dataset":"posts",
			"referencing_column":"author_id",
			"referenced_dataset":"users",
			"referenced_column":"id"
		}`))
		rec := httptest.NewRecorder()
		AddForeignKeyHandler(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		body := decodeForeignKeyJSONMap(t, rec)
		if body["message"] != "Foreign key added successfully" {
			t.Fatalf("message = %#v, want success text", body["message"])
		}
		if len(state.execCalls) != 1 {
			t.Fatalf("exec calls = %d, want 1", len(state.execCalls))
		}
		query := state.execCalls[0].query
		for _, want := range []string{`"posts"`, `"fk_posts_author_id"`, `"author_id"`, `"users"`, `"id"`} {
			if !strings.Contains(query, want) {
				t.Fatalf("exec query = %q, want substring %q", query, want)
			}
		}
	})
}

func TestGetTableNamesHandlerHandlesQueryErrorAndSuccess(t *testing.T) {
	t.Run("query error", func(t *testing.T) {
		db, _ := openForeignKeyMockDB(t, []foreignKeyQueryResponse{
			{
				match: "FROM information_schema.tables",
				err:   fmt.Errorf("boom"),
			},
		}, nil)
		withForeignKeyDB(t, db)

		req := httptest.NewRequest(http.MethodGet, "/api/table-names", nil)
		rec := httptest.NewRecorder()
		GetTableNamesHandler(rec, req)

		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", rec.Code)
		}
	})

	t.Run("success", func(t *testing.T) {
		db, _ := openForeignKeyMockDB(t, []foreignKeyQueryResponse{
			{
				match: "FROM information_schema.tables",
				cols:  []string{"table_name"},
				rows:  [][]driver.Value{{"posts"}, {"users"}},
			},
		}, nil)
		withForeignKeyDB(t, db)

		req := httptest.NewRequest(http.MethodGet, "/api/table-names", nil)
		rec := httptest.NewRecorder()
		GetTableNamesHandler(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		tableNames := decodeForeignKeyJSONArray(t, rec)
		if len(tableNames) != 2 || tableNames[0] != "posts" || tableNames[1] != "users" {
			t.Fatalf("tableNames = %#v, want [posts users]", tableNames)
		}
	})

	t.Run("success with aliases", func(t *testing.T) {
		db, _ := openForeignKeyMockDB(t, []foreignKeyQueryResponse{
			{
				match: "FROM information_schema.tables",
				cols:  []string{"table_name"},
				rows:  [][]driver.Value{{"app_service_catalog"}, {"system_users"}},
			},
			{
				match: "FROM system_db_table_aliases",
				cols:  []string{"table_name", "alias_slug"},
				rows:  [][]driver.Value{{"app_service_catalog", "service_directory"}},
			},
		}, nil)
		withForeignKeyDB(t, db)

		req := httptest.NewRequest(http.MethodGet, "/api/table-names?with_aliases=1", nil)
		rec := httptest.NewRecorder()
		GetTableNamesHandler(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}

		var payload struct {
			Names       []string          `json:"names"`
			RawToPublic map[string]string `json:"raw_to_public"`
			PublicToRaw map[string]string `json:"public_to_raw"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
			t.Fatalf("unmarshal alias payload: %v", err)
		}
		if len(payload.Names) != 2 || payload.Names[0] != "app_service_catalog" || payload.Names[1] != "system_users" {
			t.Fatalf("payload.Names = %#v, want [app_service_catalog system_users]", payload.Names)
		}
		if got := payload.RawToPublic["app_service_catalog"]; got != "service_directory" {
			t.Fatalf("payload.RawToPublic[app_service_catalog] = %q, want service_directory", got)
		}
		if got := payload.PublicToRaw["service_directory"]; got != "app_service_catalog" {
			t.Fatalf("payload.PublicToRaw[service_directory] = %q, want app_service_catalog", got)
		}
	})
}

func TestGetForeignKeysHandlesQueryErrorAndDatasetFilterSuccess(t *testing.T) {
	t.Run("query error", func(t *testing.T) {
		db, _ := openForeignKeyMockDB(t, []foreignKeyQueryResponse{
			{
				match: "tc.constraint_type = 'FOREIGN KEY'",
				err:   fmt.Errorf("boom"),
			},
		}, nil)
		withForeignKeyDB(t, db)

		req := httptest.NewRequest(http.MethodGet, "/api/foreign-keys", nil)
		rec := httptest.NewRecorder()
		GetForeignKeys(rec, req)

		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", rec.Code)
		}
	})

	t.Run("dataset filter success", func(t *testing.T) {
		db, state := openForeignKeyMockDB(t, []foreignKeyQueryResponse{
			{
				match: "FROM information_schema.tables",
				args:  []driver.Value{"posts"},
				cols:  []string{"exists"},
				rows:  [][]driver.Value{{true}},
			},
			{
				match: "FROM information_schema.tables",
				args:  []driver.Value{"ghosts"},
				cols:  []string{"exists"},
				rows:  [][]driver.Value{{false}},
			},
			{
				match: "tc.constraint_type = 'FOREIGN KEY'",
				cols: []string{
					"constraint_name",
					"referencing_table",
					"referencing_column",
					"referenced_table",
					"referenced_column",
				},
				rows: [][]driver.Value{{"fk_posts_author_id", "posts", "author_id", "users", "id"}},
			},
		}, nil)
		withForeignKeyDB(t, db)

		req := httptest.NewRequest(http.MethodGet, "/api/foreign-keys?datasets=posts,ghosts", nil)
		rec := httptest.NewRecorder()
		GetForeignKeys(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		body := decodeForeignKeyJSONMap(t, rec)
		columns, ok := body["columns"].([]interface{})
		if !ok || len(columns) != 4 {
			t.Fatalf("columns = %#v, want 4 response columns", body["columns"])
		}
		data, ok := body["data"].([]interface{})
		if !ok || len(data) != 1 {
			t.Fatalf("data = %#v, want one row", body["data"])
		}
		if len(state.queryCalls) != 3 {
			t.Fatalf("query calls = %d, want 3", len(state.queryCalls))
		}
		if !strings.Contains(state.queryCalls[2].query, "ANY($1)") {
			t.Fatalf("final query = %q, want dataset filter clause", state.queryCalls[2].query)
		}
	})
}

func TestDeleteForeignKeyHandlerRejectsMethodAndHandlesExecBranches(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/delete-foreign-key", nil)
	rec := httptest.NewRecorder()
	DeleteForeignKeyHandler(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("wrong-method status = %d, want 405", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/delete-foreign-key", strings.NewReader("{"))
	rec = httptest.NewRecorder()
	DeleteForeignKeyHandler(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid-json status = %d, want 400", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/delete-foreign-key", strings.NewReader(`{"constraint_name":"fk_posts_author_id"}`))
	rec = httptest.NewRecorder()
	DeleteForeignKeyHandler(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("missing-fields status = %d, want 400", rec.Code)
	}

	t.Run("exec error", func(t *testing.T) {
		db, _ := openForeignKeyMockDB(t, nil, []foreignKeyExecResponse{
			{
				match: "ALTER TABLE",
				err:   fmt.Errorf("boom"),
			},
		})
		withForeignKeyDB(t, db)

		req := httptest.NewRequest(http.MethodPost, "/api/delete-foreign-key", strings.NewReader(`{
			"constraint_name":"fk_posts_author_id",
			"referencing_dataset":"posts"
		}`))
		rec := httptest.NewRecorder()
		DeleteForeignKeyHandler(rec, req)

		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", rec.Code)
		}
	})

	t.Run("success", func(t *testing.T) {
		db, state := openForeignKeyMockDB(t, nil, []foreignKeyExecResponse{
			{
				match:        "ALTER TABLE",
				rowsAffected: 1,
			},
		})
		withForeignKeyDB(t, db)

		req := httptest.NewRequest(http.MethodPost, "/api/delete-foreign-key", strings.NewReader(`{
			"constraint_name":"fk_posts_author_id",
			"referencing_dataset":"posts"
		}`))
		rec := httptest.NewRecorder()
		DeleteForeignKeyHandler(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		body := decodeForeignKeyJSONMap(t, rec)
		if body["message"] != "Vierasavain poistettu onnistuneesti" {
			t.Fatalf("message = %#v, want delete success text", body["message"])
		}
		if len(state.execCalls) != 1 {
			t.Fatalf("exec calls = %d, want 1", len(state.execCalls))
		}
		query := state.execCalls[0].query
		for _, want := range []string{`"posts"`, `"fk_posts_author_id"`} {
			if !strings.Contains(query, want) {
				t.Fatalf("exec query = %q, want substring %q", query, want)
			}
		}
	})
}
