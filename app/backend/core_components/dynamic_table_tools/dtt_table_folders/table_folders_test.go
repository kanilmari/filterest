// table_folders_test.go
// Unit tests for table-folder tree handlers.
// Covers the validation and lightweight database branches around create/delete/update flows plus the request/transaction guard rails for rename handling without requiring a live database.
package dtt_system_table_folders

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
	"easelect/backend/core_components/dbutils"
	"github.com/lib/pq"
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

func TestHandleCreateFolderRejectsMethodJSONAndEmptyName(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/create-folder", nil)
	rec := httptest.NewRecorder()
	HandleCreateFolder(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("wrong-method status = %d, want 405", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/create-folder", strings.NewReader("{"))
	rec = httptest.NewRecorder()
	HandleCreateFolder(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid-json status = %d, want 400", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/create-folder", strings.NewReader(`{"folder_name":"   "}`))
	rec = httptest.NewRecorder()
	HandleCreateFolder(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("empty-name status = %d, want 400", rec.Code)
	}
}

func TestHandleCreateFolderHandlesParentMissingAndSuccess(t *testing.T) {
	t.Run("parent missing", func(t *testing.T) {
		db, _ := openFolderMockDB(t, []folderQueryResponse{
			{
				match: "SELECT EXISTS(SELECT 1 FROM system_table_folders",
				cols:  []string{"exists"},
				rows:  [][]driver.Value{{false}},
			},
		}, nil)
		withFolderDB(t, db)

		req := httptest.NewRequest(http.MethodPost, "/api/create-folder", strings.NewReader(`{"folder_name":"Docs","parent_id":7}`))
		rec := httptest.NewRecorder()
		HandleCreateFolder(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "parent folder 7 not found") {
			t.Fatalf("body = %q, want parent-missing error", rec.Body.String())
		}
	})

	t.Run("root success", func(t *testing.T) {
		db, _ := openFolderMockDB(t, []folderQueryResponse{
			{
				match: "INSERT INTO system_table_folders",
				cols:  []string{"id"},
				rows:  [][]driver.Value{{int64(41)}},
			},
		}, nil)
		withFolderDB(t, db)

		req := httptest.NewRequest(http.MethodPost, "/api/create-folder", strings.NewReader(`{"folder_name":"Docs"}`))
		rec := httptest.NewRecorder()
		HandleCreateFolder(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		body := decodeFolderJSON(t, rec)
		if body["folder_id"] != float64(41) {
			t.Fatalf("folder_id = %#v, want 41", body["folder_id"])
		}
	})
}

func TestEnsureRootFolderByNameReturnsExistingFolderOrCreatesIt(t *testing.T) {
	t.Run("returns existing root folder", func(t *testing.T) {
		db, _ := openFolderMockDB(t, []folderQueryResponse{
			{
				match: "SELECT id",
				args:  []driver.Value{"other_tables"},
				cols:  []string{"id"},
				rows:  [][]driver.Value{{int64(15)}},
			},
		}, nil)

		folderID, err := EnsureRootFolderByName(db, "other_tables")
		if err != nil {
			t.Fatalf("EnsureRootFolderByName returned error: %v", err)
		}
		if folderID != 15 {
			t.Fatalf("folderID = %d, want 15", folderID)
		}
	})

	t.Run("creates missing root folder", func(t *testing.T) {
		db, _ := openFolderMockDB(t, []folderQueryResponse{
			{
				match: "SELECT id",
				args:  []driver.Value{"other_tables"},
				err:   sql.ErrNoRows,
			},
			{
				match: "INSERT INTO system_table_folders",
				args:  []driver.Value{"other_tables"},
				cols:  []string{"id"},
				rows:  [][]driver.Value{{int64(29)}},
			},
		}, nil)

		folderID, err := EnsureRootFolderByName(db, "other_tables")
		if err != nil {
			t.Fatalf("EnsureRootFolderByName returned error: %v", err)
		}
		if folderID != 29 {
			t.Fatalf("folderID = %d, want 29", folderID)
		}
	})
}

func TestEnsureDatabaseOtherTablesFolderReturnsExistingChildOrCreatesIt(t *testing.T) {
	t.Run("returns existing database child folder", func(t *testing.T) {
		db, _ := openFolderMockDB(t, []folderQueryResponse{
			{
				match: "SELECT id",
				args:  []driver.Value{DatabaseFolderName},
				cols:  []string{"id"},
				rows:  [][]driver.Value{{int64(15)}},
			},
			{
				match: "SELECT id",
				args:  []driver.Value{int64(15), OtherTablesFolderName},
				cols:  []string{"id"},
				rows:  [][]driver.Value{{int64(150)}},
			},
		}, nil)

		folderID, err := EnsureDatabaseOtherTablesFolder(db)
		if err != nil {
			t.Fatalf("EnsureDatabaseOtherTablesFolder returned error: %v", err)
		}
		if folderID != 150 {
			t.Fatalf("folderID = %d, want 150", folderID)
		}
	})

	t.Run("creates missing database child folder", func(t *testing.T) {
		db, _ := openFolderMockDB(t, []folderQueryResponse{
			{
				match: "SELECT id",
				args:  []driver.Value{DatabaseFolderName},
				cols:  []string{"id"},
				rows:  [][]driver.Value{{int64(15)}},
			},
			{
				match: "SELECT id",
				args:  []driver.Value{int64(15), OtherTablesFolderName},
				err:   sql.ErrNoRows,
			},
			{
				match: "SELECT EXISTS(SELECT 1 FROM system_table_folders",
				args:  []driver.Value{int64(15)},
				cols:  []string{"exists"},
				rows:  [][]driver.Value{{true}},
			},
			{
				match: "INSERT INTO system_table_folders",
				args:  []driver.Value{OtherTablesFolderName, int64(15)},
				cols:  []string{"id"},
				rows:  [][]driver.Value{{int64(151)}},
			},
		}, nil)

		folderID, err := EnsureDatabaseOtherTablesFolder(db)
		if err != nil {
			t.Fatalf("EnsureDatabaseOtherTablesFolder returned error: %v", err)
		}
		if folderID != 151 {
			t.Fatalf("folderID = %d, want 151", folderID)
		}
	})
}

func TestReconcileLegacyOtherTablesFolder(t *testing.T) {
	t.Run("noops when no legacy root exists", func(t *testing.T) {
		db, state := openFolderMockDB(t, []folderQueryResponse{
			{
				match: "WHERE parent_id IS NULL",
				args:  []driver.Value{OtherTablesFolderName},
				cols:  []string{"id"},
				rows:  nil,
			},
		}, nil)

		result, err := ReconcileLegacyOtherTablesFolder(db)
		if err != nil {
			t.Fatalf("ReconcileLegacyOtherTablesFolder returned error: %v", err)
		}
		if result.CanonicalFolderID != 0 {
			t.Fatalf("CanonicalFolderID = %d, want 0", result.CanonicalFolderID)
		}
		if len(result.LegacyRootFolderIDs) != 0 {
			t.Fatalf("LegacyRootFolderIDs = %#v, want empty", result.LegacyRootFolderIDs)
		}

		state.mu.Lock()
		defer state.mu.Unlock()
		if len(state.calls) != 0 {
			t.Fatalf("exec call count = %d, want 0", len(state.calls))
		}
	})

	t.Run("moves tables to canonical folder and deletes the legacy root", func(t *testing.T) {
		db, state := openFolderMockDB(t, []folderQueryResponse{
			{
				match: "WHERE parent_id IS NULL",
				args:  []driver.Value{OtherTablesFolderName},
				cols:  []string{"id"},
				rows:  [][]driver.Value{{int64(151)}},
			},
			{
				match: "WHERE parent_id IS NULL",
				args:  []driver.Value{DatabaseFolderName},
				cols:  []string{"id"},
				rows:  [][]driver.Value{{int64(15)}},
			},
			{
				match: "WHERE parent_id = $1",
				args:  []driver.Value{int64(15), OtherTablesFolderName},
				cols:  []string{"id"},
				rows:  [][]driver.Value{{int64(150)}},
			},
		}, []folderExecResponse{
			{
				match:        "UPDATE system_table_folders",
				rowsAffected: 0,
			},
			{
				match:        "UPDATE system_db_tables",
				rowsAffected: 2,
			},
			{
				match:        "DELETE FROM system_table_folders WHERE id = $1",
				rowsAffected: 1,
			},
		})

		result, err := ReconcileLegacyOtherTablesFolder(db)
		if err != nil {
			t.Fatalf("ReconcileLegacyOtherTablesFolder returned error: %v", err)
		}
		if result.CanonicalFolderID != 150 {
			t.Fatalf("CanonicalFolderID = %d, want 150", result.CanonicalFolderID)
		}
		if len(result.LegacyRootFolderIDs) != 1 || result.LegacyRootFolderIDs[0] != 151 {
			t.Fatalf("LegacyRootFolderIDs = %#v, want [151]", result.LegacyRootFolderIDs)
		}
		if result.ReparentedChildFolderCount != 0 {
			t.Fatalf("ReparentedChildFolderCount = %d, want 0", result.ReparentedChildFolderCount)
		}
		if result.ReassignedTableCount != 2 {
			t.Fatalf("ReassignedTableCount = %d, want 2", result.ReassignedTableCount)
		}
		if result.DeletedFolderCount != 1 {
			t.Fatalf("DeletedFolderCount = %d, want 1", result.DeletedFolderCount)
		}

		state.mu.Lock()
		defer state.mu.Unlock()
		if len(state.calls) != 3 {
			t.Fatalf("exec call count = %d, want 3", len(state.calls))
		}

		gotReparentArgs := namedArgsToFolderValues(state.calls[0].args)
		if len(gotReparentArgs) != 2 || gotReparentArgs[0] != int64(150) || gotReparentArgs[1] != int64(151) {
			t.Fatalf("reparent args = %#v, want [150 151]", gotReparentArgs)
		}

		gotTableArgs := namedArgsToFolderValues(state.calls[1].args)
		if len(gotTableArgs) != 2 || gotTableArgs[0] != int64(150) || gotTableArgs[1] != int64(151) {
			t.Fatalf("table move args = %#v, want [150 151]", gotTableArgs)
		}

		gotDeleteArgs := namedArgsToFolderValues(state.calls[2].args)
		if len(gotDeleteArgs) != 1 || gotDeleteArgs[0] != int64(151) {
			t.Fatalf("delete args = %#v, want [151]", gotDeleteArgs)
		}
	})
}

func TestCreateFolderWithQuerierValidatesAndCreatesFolders(t *testing.T) {
	t.Run("creates folder under existing parent", func(t *testing.T) {
		db, _ := openFolderMockDB(t, []folderQueryResponse{
			{
				match: "SELECT EXISTS(SELECT 1 FROM system_table_folders",
				cols:  []string{"exists"},
				rows:  [][]driver.Value{{true}},
			},
			{
				match: "INSERT INTO system_table_folders",
				cols:  []string{"id"},
				rows:  [][]driver.Value{{int64(81)}},
			},
		}, nil)

		parentID := 12
		folderID, err := CreateFolderWithQuerier(db, CreateFolderRequest{
			FolderName: "Reports",
			ParentID:   &parentID,
		})
		if err != nil {
			t.Fatalf("CreateFolderWithQuerier returned error: %v", err)
		}
		if folderID != 81 {
			t.Fatalf("folderID = %d, want 81", folderID)
		}
	})

	t.Run("rejects missing name", func(t *testing.T) {
		db, _ := openFolderMockDB(t, nil, nil)
		if _, err := CreateFolderWithQuerier(db, CreateFolderRequest{FolderName: "   "}); err == nil {
			t.Fatalf("expected missing-name validation error")
		}
	})

	t.Run("rejects missing parent", func(t *testing.T) {
		db, _ := openFolderMockDB(t, []folderQueryResponse{
			{
				match: "SELECT EXISTS(SELECT 1 FROM system_table_folders",
				cols:  []string{"exists"},
				rows:  [][]driver.Value{{false}},
			},
		}, nil)

		parentID := 5
		if _, err := CreateFolderWithQuerier(db, CreateFolderRequest{
			FolderName: "Reports",
			ParentID:   &parentID,
		}); err == nil || !strings.Contains(err.Error(), "parent folder 5 not found") {
			t.Fatalf("err = %v, want parent-missing error", err)
		}
	})
}

func TestHandleDeleteFolderRejectsMethodJSONAndInvalidID(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/delete-folder", nil)
	rec := httptest.NewRecorder()
	HandleDeleteFolder(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("wrong-method status = %d, want 405", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/delete-folder", strings.NewReader("{"))
	rec = httptest.NewRecorder()
	HandleDeleteFolder(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid-json status = %d, want 400", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/delete-folder", strings.NewReader(`{"folder_id":0}`))
	rec = httptest.NewRecorder()
	HandleDeleteFolder(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid-id status = %d, want 400", rec.Code)
	}
}

func TestHandleDeleteFolderHandlesNotFoundConflictAndSuccess(t *testing.T) {
	t.Run("folder not found", func(t *testing.T) {
		db, _ := openFolderMockDB(t, []folderQueryResponse{
			{
				match: "SELECT folder_name FROM system_table_folders",
				cols:  []string{"folder_name"},
				rows:  nil,
			},
		}, nil)
		withFolderDB(t, db)

		req := httptest.NewRequest(http.MethodPost, "/api/delete-folder", strings.NewReader(`{"folder_id":5}`))
		rec := httptest.NewRecorder()
		HandleDeleteFolder(rec, req)

		if rec.Code != http.StatusNotFound {
			t.Fatalf("status = %d, want 404", rec.Code)
		}
	})

	t.Run("child folders conflict", func(t *testing.T) {
		db, _ := openFolderMockDB(t, []folderQueryResponse{
			{
				match: "SELECT folder_name FROM system_table_folders",
				cols:  []string{"folder_name"},
				rows:  [][]driver.Value{{"Docs"}},
			},
			{
				match: "SELECT COUNT(*) FROM system_table_folders WHERE parent_id",
				cols:  []string{"count"},
				rows:  [][]driver.Value{{int64(2)}},
			},
		}, nil)
		withFolderDB(t, db)

		req := httptest.NewRequest(http.MethodPost, "/api/delete-folder", strings.NewReader(`{"folder_id":5}`))
		rec := httptest.NewRecorder()
		HandleDeleteFolder(rec, req)

		if rec.Code != http.StatusConflict {
			t.Fatalf("status = %d, want 409", rec.Code)
		}
	})

	t.Run("tables conflict", func(t *testing.T) {
		db, _ := openFolderMockDB(t, []folderQueryResponse{
			{
				match: "SELECT folder_name FROM system_table_folders",
				cols:  []string{"folder_name"},
				rows:  [][]driver.Value{{"Docs"}},
			},
			{
				match: "SELECT COUNT(*) FROM system_table_folders WHERE parent_id",
				cols:  []string{"count"},
				rows:  [][]driver.Value{{int64(0)}},
			},
			{
				match: "SELECT COUNT(*) FROM system_db_tables WHERE folder_id",
				cols:  []string{"count"},
				rows:  [][]driver.Value{{int64(3)}},
			},
		}, nil)
		withFolderDB(t, db)

		req := httptest.NewRequest(http.MethodPost, "/api/delete-folder", strings.NewReader(`{"folder_id":5}`))
		rec := httptest.NewRecorder()
		HandleDeleteFolder(rec, req)

		if rec.Code != http.StatusConflict {
			t.Fatalf("status = %d, want 409", rec.Code)
		}
	})

	t.Run("success", func(t *testing.T) {
		db, state := openFolderMockDB(t, []folderQueryResponse{
			{
				match: "SELECT folder_name FROM system_table_folders",
				cols:  []string{"folder_name"},
				rows:  [][]driver.Value{{"Docs"}},
			},
			{
				match: "SELECT COUNT(*) FROM system_table_folders WHERE parent_id",
				cols:  []string{"count"},
				rows:  [][]driver.Value{{int64(0)}},
			},
			{
				match: "SELECT COUNT(*) FROM system_db_tables WHERE folder_id",
				cols:  []string{"count"},
				rows:  [][]driver.Value{{int64(0)}},
			},
			{
				match: "SELECT DISTINCT lang_key_id",
				cols:  []string{"lang_key_id"},
				rows:  nil,
			},
		}, []folderExecResponse{
			{
				match:        "DELETE FROM system_table_folders WHERE id = $1",
				rowsAffected: 1,
			},
		})
		withFolderDB(t, db)

		req := httptest.NewRequest(http.MethodPost, "/api/delete-folder", strings.NewReader(`{"folder_id":5}`))
		rec := httptest.NewRecorder()
		HandleDeleteFolder(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		body := decodeFolderJSON(t, rec)
		if body["folder_name"] != "Docs" {
			t.Fatalf("folder_name = %#v, want Docs", body["folder_name"])
		}

		state.mu.Lock()
		defer state.mu.Unlock()
		if len(state.calls) != 1 {
			t.Fatalf("exec call count = %d, want 1", len(state.calls))
		}
		got := namedArgsToFolderValues(state.calls[0].args)
		if len(got) != 1 || got[0] != int64(5) {
			t.Fatalf("exec args = %#v, want [5]", got)
		}
	})
}

func TestHandleUpdateFolderRejectsMethodJSONAndNonFolderType(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/update-folder", nil)
	rec := httptest.NewRecorder()
	HandleUpdateFolder(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("wrong-method status = %d, want 405", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/update-folder", strings.NewReader("{"))
	rec = httptest.NewRecorder()
	HandleUpdateFolder(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid-json status = %d, want 400", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/update-folder", strings.NewReader(`{"item_id":1,"item_type":"table","new_folder_id":2,"dataset_uid":99}`))
	rec = httptest.NewRecorder()
	HandleUpdateFolder(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("non-folder type status = %d, want 400", rec.Code)
	}
}

func TestHandleUpdateFolderHandlesFolderSuccess(t *testing.T) {
	db, state := openFolderMockDB(t, []folderQueryResponse{
		{
			match: "WITH RECURSIVE folder_ancestors AS",
			args:  []driver.Value{3},
			cols:  []string{"id", "folder_name"},
			rows:  nil,
		},
		{
			match: "WITH RECURSIVE folder_ancestors AS",
			args:  []driver.Value{9},
			cols:  []string{"id", "folder_name"},
			rows:  nil,
		},
	}, []folderExecResponse{
		{
			match:        "UPDATE system_table_folders",
			rowsAffected: 1,
		},
	})
	withFolderDB(t, db)

	req := httptest.NewRequest(http.MethodPost, "/api/update-folder", strings.NewReader(`{"item_id":3,"item_type":"folder","new_folder_id":9}`))
	rec := httptest.NewRecorder()
	HandleUpdateFolder(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	state.mu.Lock()
	got := namedArgsToFolderValues(state.calls[0].args)
	state.mu.Unlock()
	if len(got) != 2 || got[0] != int64(9) || got[1] != int64(3) {
		t.Fatalf("exec args = %#v, want [9 3]", got)
	}
}

func TestHandleUpdateTableFolderGuardsAndBoundUpdate(t *testing.T) {
	t.Run("rejects missing dataset uid", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/update-table-folder", strings.NewReader(`{"item_id":4,"item_type":"table","new_folder_id":10}`))
		rec := httptest.NewRecorder()
		HandleUpdateTableFolder(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", rec.Code)
		}
	})

	t.Run("success binds item id and dataset uid", func(t *testing.T) {
		db, state := openFolderMockDB(t, []folderQueryResponse{
			{
				match: "SELECT table_name, folder_id",
				args:  []driver.Value{4, 77},
				cols:  []string{"table_name", "folder_id"},
				rows:  [][]driver.Value{{"app_service_catalog", int64(18)}},
			},
			{
				match: "WITH RECURSIVE folder_ancestors AS",
				args:  []driver.Value{18},
				cols:  []string{"id", "folder_name"},
				rows:  [][]driver.Value{{int64(18), "serlog"}},
			},
			{
				match: "WITH RECURSIVE folder_ancestors AS",
				args:  []driver.Value{10},
				cols:  []string{"id", "folder_name"},
				rows:  [][]driver.Value{{int64(18), "serlog"}},
			},
		}, []folderExecResponse{
			{
				match:        "UPDATE system_db_tables",
				rowsAffected: 1,
			},
		})
		withFolderDB(t, db)

		req := httptest.NewRequest(http.MethodPost, "/api/update-table-folder", strings.NewReader(`{"item_id":4,"item_type":"table","new_folder_id":10,"dataset_uid":77,"confirm_tab_visibility_change":true}`))
		rec := httptest.NewRecorder()
		HandleUpdateTableFolder(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		state.mu.Lock()
		got := namedArgsToFolderValues(state.calls[0].args)
		state.mu.Unlock()
		if len(got) != 3 || got[0] != int64(10) || got[1] != int64(4) || got[2] != int64(77) {
			t.Fatalf("exec args = %#v, want [10 4 77]", got)
		}
	})

	t.Run("dataset uid mismatch returns not found", func(t *testing.T) {
		db, _ := openFolderMockDB(t, []folderQueryResponse{
			{
				match: "SELECT table_name, folder_id",
				args:  []driver.Value{4, 77},
				cols:  []string{"table_name", "folder_id"},
				rows:  [][]driver.Value{{"app_service_catalog", int64(18)}},
			},
			{
				match: "WITH RECURSIVE folder_ancestors AS",
				args:  []driver.Value{18},
				cols:  []string{"id", "folder_name"},
				rows:  [][]driver.Value{{int64(18), "serlog"}},
			},
			{
				match: "WITH RECURSIVE folder_ancestors AS",
				args:  []driver.Value{10},
				cols:  []string{"id", "folder_name"},
				rows:  [][]driver.Value{{int64(18), "serlog"}},
			},
		}, []folderExecResponse{
			{
				match:        "UPDATE system_db_tables",
				rowsAffected: 0,
			},
		})
		withFolderDB(t, db)

		req := httptest.NewRequest(http.MethodPost, "/api/update-table-folder", strings.NewReader(`{"item_id":4,"item_type":"table","new_folder_id":10,"dataset_uid":77,"confirm_tab_visibility_change":true}`))
		rec := httptest.NewRecorder()
		HandleUpdateTableFolder(rec, req)

		if rec.Code != http.StatusNotFound {
			t.Fatalf("status = %d, want 404", rec.Code)
		}
	})

	t.Run("cross-project move requires confirmation", func(t *testing.T) {
		db, _ := openFolderMockDB(t, []folderQueryResponse{
			{
				match: "SELECT table_name, folder_id",
				args:  []driver.Value{4, 77},
				cols:  []string{"table_name", "folder_id"},
				rows:  [][]driver.Value{{"app_service_catalog", int64(18)}},
			},
			{
				match: "WITH RECURSIVE folder_ancestors AS",
				args:  []driver.Value{18},
				cols:  []string{"id", "folder_name"},
				rows:  [][]driver.Value{{int64(18), "serlog"}},
			},
			{
				match: "WITH RECURSIVE folder_ancestors AS",
				args:  []driver.Value{21},
				cols:  []string{"id", "folder_name"},
				rows:  [][]driver.Value{{int64(21), "another_project"}},
			},
		}, nil)
		withFolderDB(t, db)

		req := httptest.NewRequest(http.MethodPost, "/api/update-table-folder", strings.NewReader(`{"item_id":4,"item_type":"table","new_folder_id":21,"dataset_uid":77}`))
		rec := httptest.NewRecorder()
		HandleUpdateTableFolder(rec, req)

		if rec.Code != http.StatusConflict {
			t.Fatalf("status = %d, want 409", rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "Confirm moving table") {
			t.Fatalf("body = %q, want confirmation error", rec.Body.String())
		}
	})

	t.Run("top-tab visibility change requires confirmation", func(t *testing.T) {
		db, _ := openFolderMockDB(t, []folderQueryResponse{
			{
				match: "SELECT table_name, folder_id",
				args:  []driver.Value{4, 77},
				cols:  []string{"table_name", "folder_id"},
				rows:  [][]driver.Value{{"app_service_catalog", int64(18)}},
			},
			{
				match: "WITH RECURSIVE folder_ancestors AS",
				args:  []driver.Value{18},
				cols:  []string{"id", "folder_name"},
				rows:  [][]driver.Value{{int64(18), "serlog"}},
			},
			{
				match: "WITH RECURSIVE folder_ancestors AS",
				args:  []driver.Value{19},
				cols:  []string{"id", "folder_name"},
				rows:  [][]driver.Value{{int64(18), "serlog"}},
			},
		}, nil)
		withFolderDB(t, db)

		req := httptest.NewRequest(http.MethodPost, "/api/update-table-folder", strings.NewReader(`{"item_id":4,"item_type":"table","new_folder_id":19,"dataset_uid":77}`))
		rec := httptest.NewRecorder()
		HandleUpdateTableFolder(rec, req)

		if rec.Code != http.StatusConflict {
			t.Fatalf("status = %d, want 409", rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "main SVG tabs") {
			t.Fatalf("body = %q, want tab-visibility warning", rec.Body.String())
		}
	})

	t.Run("confirmed cross-project move succeeds", func(t *testing.T) {
		db, _ := openFolderMockDB(t, []folderQueryResponse{
			{
				match: "SELECT table_name, folder_id",
				args:  []driver.Value{4, 77},
				cols:  []string{"table_name", "folder_id"},
				rows:  [][]driver.Value{{"app_service_catalog", int64(18)}},
			},
			{
				match: "WITH RECURSIVE folder_ancestors AS",
				args:  []driver.Value{18},
				cols:  []string{"id", "folder_name"},
				rows:  [][]driver.Value{{int64(18), "serlog"}},
			},
			{
				match: "WITH RECURSIVE folder_ancestors AS",
				args:  []driver.Value{21},
				cols:  []string{"id", "folder_name"},
				rows:  [][]driver.Value{{int64(21), "another_project"}},
			},
		}, []folderExecResponse{
			{
				match:        "UPDATE system_db_tables",
				rowsAffected: 1,
			},
		})
		withFolderDB(t, db)

		req := httptest.NewRequest(http.MethodPost, "/api/update-table-folder", strings.NewReader(`{"item_id":4,"item_type":"table","new_folder_id":21,"dataset_uid":77,"confirm_cross_project_move":true}`))
		rec := httptest.NewRecorder()
		HandleUpdateTableFolder(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
	})
}

func TestHandleUpdateFolderRequiresCrossProjectConfirmation(t *testing.T) {
	db, _ := openFolderMockDB(t, []folderQueryResponse{
		{
			match: "WITH RECURSIVE folder_ancestors AS",
			args:  []driver.Value{3},
			cols:  []string{"id", "folder_name"},
			rows:  [][]driver.Value{{int64(18), "serlog"}},
		},
		{
			match: "WITH RECURSIVE folder_ancestors AS",
			args:  []driver.Value{9},
			cols:  []string{"id", "folder_name"},
			rows:  [][]driver.Value{{int64(21), "another_project"}},
		},
	}, nil)
	withFolderDB(t, db)

	req := httptest.NewRequest(http.MethodPost, "/api/update-folder", strings.NewReader(`{"item_id":3,"item_type":"folder","new_folder_id":9}`))
	rec := httptest.NewRecorder()
	HandleUpdateFolder(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "Confirm moving folder") {
		t.Fatalf("body = %q, want confirmation error", rec.Body.String())
	}
}

func TestHandleSetCurrentProjectFolder(t *testing.T) {
	t.Run("rejects method and invalid JSON", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/set-current-project-folder", nil)
		rec := httptest.NewRecorder()
		HandleSetCurrentProjectFolder(rec, req)
		if rec.Code != http.StatusMethodNotAllowed {
			t.Fatalf("status = %d, want 405", rec.Code)
		}

		req = httptest.NewRequest(http.MethodPost, "/api/set-current-project-folder", strings.NewReader("{"))
		rec = httptest.NewRecorder()
		HandleSetCurrentProjectFolder(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", rec.Code)
		}
	})

	t.Run("rejects non-project-root folders", func(t *testing.T) {
		db, _ := openFolderMockDB(t, []folderQueryResponse{
			{
				match: "WITH RECURSIVE folder_ancestors AS",
				args:  []driver.Value{19},
				cols:  []string{"id", "folder_name"},
				rows:  [][]driver.Value{{int64(18), "serlog"}},
			},
		}, nil)
		withFolderDB(t, db)

		req := httptest.NewRequest(http.MethodPost, "/api/set-current-project-folder", strings.NewReader(`{"folder_id":19}`))
		rec := httptest.NewRecorder()
		HandleSetCurrentProjectFolder(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "project root folder") {
			t.Fatalf("body = %q, want project-root validation error", rec.Body.String())
		}
	})

	t.Run("marks selected project root as current", func(t *testing.T) {
		db, state := openFolderMockDB(t, []folderQueryResponse{
			{
				match: "WITH RECURSIVE folder_ancestors AS",
				args:  []driver.Value{18},
				cols:  []string{"id", "folder_name"},
				rows:  [][]driver.Value{{int64(18), "serlog"}},
			},
		}, []folderExecResponse{
			{
				match:        "SET is_current_project = false",
				rowsAffected: 1,
			},
			{
				match:        "SET is_current_project = true",
				rowsAffected: 2,
			},
		})
		withFolderDB(t, db)

		req := httptest.NewRequest(http.MethodPost, "/api/set-current-project-folder", strings.NewReader(`{"folder_id":18}`))
		rec := httptest.NewRecorder()
		HandleSetCurrentProjectFolder(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}

		body := decodeFolderJSON(t, rec)
		if got := body["project_name"]; got != "serlog" {
			t.Fatalf("project_name = %v, want serlog", got)
		}
		if len(state.calls) != 2 {
			t.Fatalf("exec call count = %d, want 2", len(state.calls))
		}
	})
}

func TestHandleRenameTreeNodeRejectsGuardBranches(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/rename-tree-node", nil)
	rec := httptest.NewRecorder()
	HandleRenameTreeNode(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("wrong-method status = %d, want 405", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/rename-tree-node", strings.NewReader("{"))
	rec = httptest.NewRecorder()
	HandleRenameTreeNode(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid-json status = %d, want 400", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/rename-tree-node", strings.NewReader(`{"item_id":1,"item_type":"folder","new_name":"   "}`))
	rec = httptest.NewRecorder()
	HandleRenameTreeNode(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("empty-name status = %d, want 400", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/rename-tree-node", strings.NewReader(`{"item_id":0,"item_type":"folder","new_name":"Docs"}`))
	rec = httptest.NewRecorder()
	HandleRenameTreeNode(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid-id status = %d, want 400", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/rename-tree-node", strings.NewReader(`{"item_id":1,"item_type":"folder","new_name":"Docs"}`))
	rec = httptest.NewRecorder()
	HandleRenameTreeNode(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("missing-tx status = %d, want 500", rec.Code)
	}
}

func TestHandleRenameTreeNodeRejectsUnknownTypeWithTransaction(t *testing.T) {
	db, _ := openFolderMockDB(t, nil, nil)
	req := httptest.NewRequest(http.MethodPost, "/api/rename-tree-node", strings.NewReader(`{"item_id":1,"item_type":"weird","new_name":"Docs"}`))
	req = withFolderTx(req, db)
	rec := httptest.NewRecorder()

	HandleRenameTreeNode(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "item_type must be 'folder' or 'table'") {
		t.Fatalf("body = %q, want unknown item_type error", rec.Body.String())
	}
}

func TestHandleRenameTreeNodeRejectsDatasetRouteConflictBeforeAlterTable(t *testing.T) {
	db, state := openFolderMockDB(t, []folderQueryResponse{
		{
			match: "FROM system_db_table_aliases",
			err:   &pq.Error{Code: "42P01"},
		},
		{
			match: "SELECT table_uid, table_name",
			cols:  []string{"table_uid", "table_name"},
			rows:  [][]driver.Value{},
		},
		{
			match: "SELECT table_name FROM system_db_tables WHERE id = $1",
			args:  []driver.Value{int64(5)},
			cols:  []string{"table_name"},
			rows:  [][]driver.Value{{"app_demo"}},
		},
	}, nil)
	req := httptest.NewRequest(http.MethodPost, "/api/rename-tree-node", strings.NewReader(`{"item_id":5,"item_type":"table","new_name":"service_catalog"}`))
	req = withFolderTx(req, db)
	rec := httptest.NewRecorder()

	HandleRenameTreeNode(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `dataset route segment \"service_catalog\" is already in use`) {
		t.Fatalf("body = %q, want route-conflict message", rec.Body.String())
	}
	if len(state.calls) != 0 {
		t.Fatalf("exec call count = %d, want 0", len(state.calls))
	}
}
