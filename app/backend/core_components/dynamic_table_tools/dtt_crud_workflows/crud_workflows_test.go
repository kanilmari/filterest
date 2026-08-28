// crud_workflows_test.go
// Regression tests for table/column CRUD validation helpers inside dtt_crud_workflows.
// Covers the create-table data type allowlist used by createDataset and modify-columns.
// Exists to keep admin table creation working while rejecting unsafe inline SQL fragments.

package dtt_crud_workflows

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"easelect/backend/core_components/dbutils"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/lib/pq"
)

func TestIsAllowedDataType_AllowsCreateTableAutoTimestampColumns(t *testing.T) {
	testCases := []string{
		"TIMESTAMPTZ NOT NULL DEFAULT NOW()",
		"TIMESTAMPTZ DEFAULT NOW()",
		"TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP",
		"INTEGER NOT NULL",
		"VARCHAR(255)",
	}

	for _, testCase := range testCases {
		if !isAllowedDataType(testCase) {
			t.Fatalf("expected data type %q to be allowed", testCase)
		}
	}
}

func TestIsAllowedDataType_RejectsUnsafeOrMalformedSuffixes(t *testing.T) {
	testCases := []string{
		"TIMESTAMPTZ NOT NULL DEFAULT NOW(); DROP TABLE system_users; --",
		"TEXT DEFAULT 'x'); DROP TABLE system_users; --",
		"TIMESTAMPTZ DEFAULT clock_timestamp()",
		"VARCHAR()",
		"INTEGER CHECK (id > 0)",
	}

	for _, testCase := range testCases {
		if isAllowedDataType(testCase) {
			t.Fatalf("expected data type %q to be rejected", testCase)
		}
	}
}

type queuedWorkflowQuery struct {
	cols []string
	rows [][]driver.Value
	err  error
}

type queuedWorkflowExec struct {
	err          error
	rowsAffected int64
}

type workflowQueueDriver struct{}
type workflowQueueConn struct{}
type workflowQueueStmt struct{}
type workflowQueueRows struct {
	cols []string
	data [][]driver.Value
	idx  int
}
type workflowQueueTx struct{}
type workflowQueueResult struct{ rowsAffected int64 }

var (
	workflowQueueMu sync.Mutex
	workflowQueries []queuedWorkflowQuery
	workflowExecs   []queuedWorkflowExec
	registerOnce    sync.Once
)

func TestEnsureRegisteredTableUID_ReturnsExistingUID(t *testing.T) {
	db := newWorkflowQueueTestDB(t)
	defer db.Close()
	pushWorkflowQuery(queuedWorkflowQuery{cols: []string{"table_uid"}, rows: [][]driver.Value{{int64(42)}}})

	uid, err := ensureRegisteredTableUID(db, "testipk")
	if err != nil {
		t.Fatalf("ensureRegisteredTableUID returned error: %v", err)
	}
	if uid != 42 {
		t.Fatalf("expected uid 42, got %d", uid)
	}
}

func TestResolveCreateTableFolderID_UsesDatabaseOtherTablesFolderByDefault(t *testing.T) {
	db := newWorkflowQueueTestDB(t)
	defer db.Close()
	pushWorkflowQuery(queuedWorkflowQuery{cols: []string{"id"}, rows: [][]driver.Value{{int64(15)}}})
	pushWorkflowQuery(queuedWorkflowQuery{cols: []string{"id"}, rows: [][]driver.Value{{int64(150)}}})

	folderID, err := resolveCreateTableFolderID(db, CreateTableRequest{})
	if err != nil {
		t.Fatalf("resolveCreateTableFolderID returned error: %v", err)
	}
	if folderID != 150 {
		t.Fatalf("expected folder id 150, got %d", folderID)
	}
}

func TestEnsureRegisteredTableUID_RegistersMissingMetadataRow(t *testing.T) {
	db := newWorkflowQueueTestDB(t)
	defer db.Close()
	pushWorkflowQuery(queuedWorkflowQuery{err: sql.ErrNoRows})
	pushWorkflowQuery(queuedWorkflowQuery{cols: []string{"id"}, rows: [][]driver.Value{{int64(15)}}})
	pushWorkflowQuery(queuedWorkflowQuery{cols: []string{"id"}, rows: [][]driver.Value{{int64(150)}}})
	pushWorkflowExec(queuedWorkflowExec{rowsAffected: 1})
	pushWorkflowQuery(queuedWorkflowQuery{cols: []string{"table_uid"}, rows: [][]driver.Value{{int64(77)}}})

	uid, err := ensureRegisteredTableUID(db, "testipk")
	if err != nil {
		t.Fatalf("ensureRegisteredTableUID returned error: %v", err)
	}
	if uid != 77 {
		t.Fatalf("expected uid 77, got %d", uid)
	}
}

func TestEnsureRegisteredTableUID_ReturnsHelpfulErrorWhenStillMissing(t *testing.T) {
	db := newWorkflowQueueTestDB(t)
	defer db.Close()
	pushWorkflowQuery(queuedWorkflowQuery{err: sql.ErrNoRows})
	pushWorkflowQuery(queuedWorkflowQuery{cols: []string{"id"}, rows: [][]driver.Value{{int64(15)}}})
	pushWorkflowQuery(queuedWorkflowQuery{cols: []string{"id"}, rows: [][]driver.Value{{int64(150)}}})
	pushWorkflowExec(queuedWorkflowExec{rowsAffected: 0})
	pushWorkflowQuery(queuedWorkflowQuery{err: sql.ErrNoRows})

	_, err := ensureRegisteredTableUID(db, "testipk")
	if err == nil || err.Error() != "table_uid not found for testipk: sql: no rows in result set" {
		t.Fatalf("expected final no-rows error, got %v", err)
	}
}

func TestCreateTableHandlerRejectsDatasetRouteConflictBeforeFolderResolution(t *testing.T) {
	db := newWorkflowQueueTestDB(t)
	defer db.Close()
	pushWorkflowQuery(queuedWorkflowQuery{err: &pq.Error{Code: "42P01"}})
	pushWorkflowQuery(queuedWorkflowQuery{cols: []string{"table_uid", "table_name"}, rows: [][]driver.Value{}})

	req := httptest.NewRequest(http.MethodPost, "/api/create_dataset", strings.NewReader(`{
		"dataset_name":"service_catalog",
		"columns":{"id":"SERIAL"}
	}`))
	req = withWorkflowTx(req, db)
	rec := httptest.NewRecorder()

	CreateTableHandler(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `dataset route segment \"service_catalog\" is already in use`) {
		t.Fatalf("body = %q, want route-conflict message", rec.Body.String())
	}
}

func initWorkflowQueueDriver() {
	registerOnce.Do(func() {
		sql.Register("easelect-workflow-test", &workflowQueueDriver{})
	})
}

func withWorkflowTx(req *http.Request, db *sql.DB) *http.Request {
	lt := dbutils.NewLazyTx(db)
	return req.WithContext(dbutils.SetLazyTx(req.Context(), lt))
}

func newWorkflowQueueTestDB(t *testing.T) *sql.DB {
	t.Helper()
	initWorkflowQueueDriver()
	resetWorkflowQueue()
	name := fmt.Sprintf("easelect-workflow-test-%d", time.Now().UnixNano())
	db, err := sql.Open("easelect-workflow-test", name)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	return db
}

func pushWorkflowQuery(q queuedWorkflowQuery) {
	workflowQueueMu.Lock()
	defer workflowQueueMu.Unlock()
	workflowQueries = append(workflowQueries, q)
}

func pushWorkflowExec(e queuedWorkflowExec) {
	workflowQueueMu.Lock()
	defer workflowQueueMu.Unlock()
	workflowExecs = append(workflowExecs, e)
}

func resetWorkflowQueue() {
	workflowQueueMu.Lock()
	defer workflowQueueMu.Unlock()
	workflowQueries = nil
	workflowExecs = nil
}

func popWorkflowQuery() (queuedWorkflowQuery, bool) {
	workflowQueueMu.Lock()
	defer workflowQueueMu.Unlock()
	if len(workflowQueries) == 0 {
		return queuedWorkflowQuery{}, false
	}
	q := workflowQueries[0]
	workflowQueries = workflowQueries[1:]
	return q, true
}

func popWorkflowExec() (queuedWorkflowExec, bool) {
	workflowQueueMu.Lock()
	defer workflowQueueMu.Unlock()
	if len(workflowExecs) == 0 {
		return queuedWorkflowExec{}, false
	}
	e := workflowExecs[0]
	workflowExecs = workflowExecs[1:]
	return e, true
}

func (d *workflowQueueDriver) Open(_ string) (driver.Conn, error)  { return &workflowQueueConn{}, nil }
func (c *workflowQueueConn) Prepare(_ string) (driver.Stmt, error) { return &workflowQueueStmt{}, nil }
func (c *workflowQueueConn) Close() error                          { return nil }
func (c *workflowQueueConn) Begin() (driver.Tx, error)             { return &workflowQueueTx{}, nil }
func (tx *workflowQueueTx) Commit() error                          { return nil }
func (tx *workflowQueueTx) Rollback() error                        { return nil }

func (c *workflowQueueConn) QueryContext(_ context.Context, _ string, _ []driver.NamedValue) (driver.Rows, error) {
	q, ok := popWorkflowQuery()
	if !ok {
		return nil, errors.New("mock: unexpected Query call")
	}
	if q.err != nil {
		return nil, q.err
	}
	return &workflowQueueRows{cols: q.cols, data: q.rows}, nil
}

func (c *workflowQueueConn) ExecContext(_ context.Context, _ string, _ []driver.NamedValue) (driver.Result, error) {
	e, ok := popWorkflowExec()
	if !ok {
		return nil, errors.New("mock: unexpected Exec call")
	}
	if e.err != nil {
		return nil, e.err
	}
	return &workflowQueueResult{rowsAffected: e.rowsAffected}, nil
}

func (s *workflowQueueStmt) Close() error  { return nil }
func (s *workflowQueueStmt) NumInput() int { return -1 }
func (s *workflowQueueStmt) Exec(_ []driver.Value) (driver.Result, error) {
	e, ok := popWorkflowExec()
	if !ok {
		return nil, errors.New("mock: unexpected Exec call")
	}
	if e.err != nil {
		return nil, e.err
	}
	return &workflowQueueResult{rowsAffected: e.rowsAffected}, nil
}
func (s *workflowQueueStmt) Query(_ []driver.Value) (driver.Rows, error) {
	q, ok := popWorkflowQuery()
	if !ok {
		return nil, errors.New("mock: unexpected Query call")
	}
	if q.err != nil {
		return nil, q.err
	}
	return &workflowQueueRows{cols: q.cols, data: q.rows}, nil
}

func (r *workflowQueueRows) Columns() []string { return r.cols }
func (r *workflowQueueRows) Close() error      { return nil }
func (r *workflowQueueRows) Next(dest []driver.Value) error {
	if r.idx >= len(r.data) {
		return io.EOF
	}
	copy(dest, r.data[r.idx])
	r.idx++
	return nil
}

func (r *workflowQueueResult) LastInsertId() (int64, error) { return 0, nil }
func (r *workflowQueueResult) RowsAffected() (int64, error) { return r.rowsAffected, nil }
