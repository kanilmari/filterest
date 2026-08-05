// delete_row_test.go
// Unit tests for the dtt_1_row_delete package.
// Uses httptest for handler guard branches and a database/sql driver double for the extracted transaction-level helpers.
package dtt_1_row_delete

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"easelect/backend/core_components/dbutils"
	dtt_1_row_read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	dtt_asset_linking "easelect/backend/core_components/dynamic_table_tools/dtt_asset_linking"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// ── driver double ──────────────────────────────────────────────────────

type queuedQuery struct {
	cols []string
	rows [][]driver.Value
	err  error
}

type queuedExec struct {
	err             error
	rowsAffected    int64
	rowsAffectedErr error
	setRowsAffected bool
}

type delRowResult struct {
	rowsAffected    int64
	rowsAffectedErr error
}

type delRowState struct {
	mu sync.Mutex

	queries []queuedQuery
	execs   []queuedExec

	queryCalls []string
	queryArgs  [][]driver.NamedValue
	execCalls  []string
}

type delRowDriver struct{ state *delRowState }
type delRowConn struct{ state *delRowState }
type delRowTx struct{}
type delRowRows struct {
	cols []string
	rows [][]driver.Value
	idx  int
}

var delRowDriverRegisterMu sync.Mutex

func (d *delRowDriver) Open(string) (driver.Conn, error) {
	return &delRowConn{state: d.state}, nil
}

func (c *delRowConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("prepare not supported in delete row test driver")
}

func (c *delRowConn) Close() error              { return nil }
func (c *delRowConn) Begin() (driver.Tx, error) { return &delRowTx{}, nil }
func (c *delRowConn) BeginTx(context.Context, driver.TxOptions) (driver.Tx, error) {
	return &delRowTx{}, nil
}

func (*delRowTx) Commit() error   { return nil }
func (*delRowTx) Rollback() error { return nil }

func (r delRowResult) LastInsertId() (int64, error) { return 0, errors.New("not supported") }
func (r delRowResult) RowsAffected() (int64, error) {
	return r.rowsAffected, r.rowsAffectedErr
}

func (c *delRowConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	c.state.mu.Lock()
	defer c.state.mu.Unlock()

	c.state.queryCalls = append(c.state.queryCalls, query)
	c.state.queryArgs = append(c.state.queryArgs, append([]driver.NamedValue(nil), args...))

	if len(c.state.queries) == 0 {
		return nil, fmt.Errorf("unexpected query: %s", query)
	}

	next := c.state.queries[0]
	c.state.queries = c.state.queries[1:]
	if next.err != nil {
		return nil, next.err
	}
	return &delRowRows{
		cols: append([]string(nil), next.cols...),
		rows: cloneRows(next.rows),
	}, nil
}

func (c *delRowConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	c.state.mu.Lock()
	defer c.state.mu.Unlock()

	c.state.execCalls = append(c.state.execCalls, query)

	if len(c.state.execs) == 0 {
		return nil, fmt.Errorf("unexpected exec: %s", query)
	}

	next := c.state.execs[0]
	c.state.execs = c.state.execs[1:]
	if next.err != nil {
		return nil, next.err
	}
	if next.rowsAffectedErr != nil {
		return delRowResult{
			rowsAffected:    next.rowsAffected,
			rowsAffectedErr: next.rowsAffectedErr,
		}, nil
	}
	if next.setRowsAffected {
		return driver.RowsAffected(next.rowsAffected), nil
	}
	return driver.RowsAffected(1), nil
}

func (r *delRowRows) Columns() []string { return append([]string(nil), r.cols...) }
func (r *delRowRows) Close() error      { return nil }

func (r *delRowRows) Next(dest []driver.Value) error {
	if r.idx >= len(r.rows) {
		return io.EOF
	}
	copy(dest, r.rows[r.idx])
	r.idx++
	return nil
}

func cloneRows(rows [][]driver.Value) [][]driver.Value {
	cloned := make([][]driver.Value, len(rows))
	for i, row := range rows {
		cloned[i] = append([]driver.Value(nil), row...)
	}
	return cloned
}

func openDelRowTx(t *testing.T, queries []queuedQuery, execs []queuedExec) (*sql.DB, *sql.Tx, *delRowState) {
	t.Helper()
	delRowDriverRegisterMu.Lock()
	defer delRowDriverRegisterMu.Unlock()

	state := &delRowState{
		queries: append([]queuedQuery(nil), queries...),
		execs:   append([]queuedExec(nil), execs...),
	}
	driverName := fmt.Sprintf("del_row_test_%d", time.Now().UnixNano())
	sql.Register(driverName, &delRowDriver{state: state})

	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	tx, err := db.Begin()
	if err != nil {
		_ = db.Close()
		t.Fatalf("db.Begin: %v", err)
	}

	t.Cleanup(func() {
		_ = tx.Rollback()
		_ = db.Close()
	})
	return db, tx, state
}

// ── handler guard tests (httptest) ─────────────────────────────────────

func TestWrapperMissingDataset(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/delete-rows", nil)
	rec := httptest.NewRecorder()
	DeleteRowsHandlerWrapper(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestHandlerWrongMethod(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/delete-rows?dataset=users", nil)
	rec := httptest.NewRecorder()
	DeleteRowsHandler(rec, req, "users")
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", rec.Code)
	}
}

func TestHandlerBadJSON(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader("{bad"))
	rec := httptest.NewRecorder()
	DeleteRowsHandler(rec, req, "users")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestHandlerMissingTx(t *testing.T) {
	body := `{"ids": [1]}`
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
	rec := httptest.NewRecorder()
	DeleteRowsHandler(rec, req, "users")
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
}

func TestHandlerEmptyIDsAndRows(t *testing.T) {
	_, tx, _ := openDelRowTx(t, nil, nil)
	body := `{"ids": [], "rows": []}`
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
	req = req.WithContext(dbutils.SetTx(req.Context(), tx))
	rec := httptest.NewRecorder()
	DeleteRowsHandler(rec, req, "users")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestHandlerRejectsPilotNonOwnerBeforeDeleteOrStorageWork(t *testing.T) {
	_, tx, state := openDelRowTx(t, []queuedQuery{
		{cols: []string{"id"}, rows: nil},
	}, nil)
	tempDir := t.TempDir()
	oldWD, err := os.Getwd()
	if err != nil {
		t.Fatalf("os.Getwd: %v", err)
	}
	if err := os.Chdir(tempDir); err != nil {
		t.Fatalf("os.Chdir(%q): %v", tempDir, err)
	}
	t.Cleanup(func() { _ = os.Chdir(oldWD) })
	liveStorage := filepath.Join("storage", "pilot-table", "41")
	if err := os.MkdirAll(liveStorage, 0755); err != nil {
		t.Fatalf("os.MkdirAll(%q): %v", liveStorage, err)
	}

	body := `{"ids": [41]}`
	req := httptest.NewRequest(http.MethodPost, "/api/delete-rows?dataset=app_service_catalog", strings.NewReader(body))
	ctx := dbutils.SetTx(req.Context(), tx)
	ctx = dbutils.SetRequestActorContext(ctx, dbutils.NewRequestActorContext(7, "basic"))
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	DeleteRowsHandler(rec, req, deleteRLSPilotTableName)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
	if len(state.execCalls) != 0 {
		t.Fatalf("exec calls = %#v, want none before rejected delete", state.execCalls)
	}
	if len(state.queryCalls) != 1 {
		t.Fatalf("query calls = %#v, want only mutation visibility lock", state.queryCalls)
	}
	if !strings.Contains(state.queryCalls[0], `"app_service_catalog"."user_id" = $2`) ||
		!strings.Contains(state.queryCalls[0], `ORDER BY "app_service_catalog"."id"`) {
		t.Fatalf("visibility query = %q, want owner predicate and deterministic ordering", state.queryCalls[0])
	}
	if strings.Contains(state.queryCalls[0], "FOR UPDATE") {
		t.Fatalf("delete visibility query unexpectedly requires UPDATE row locking: %q", state.queryCalls[0])
	}
	if _, err := os.Stat(liveStorage); err != nil {
		t.Fatalf("blocked delete moved or removed live storage: %v", err)
	}
	if _, err := os.Stat(filepath.Join("storage_deleted", "pilot-table", "41")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("blocked delete created deleted storage, err=%v", err)
	}
}

func TestLockRowsVisibleForMutationUsesLegacyReadPolicy(t *testing.T) {
	_, tx, state := openDelRowTx(t, []queuedQuery{
		{cols: []string{"column_name"}, rows: [][]driver.Value{{"published"}}},
		{cols: []string{"exists"}, rows: [][]driver.Value{{true}}},
		{cols: []string{"row_policy_owner_column"}, rows: [][]driver.Value{{"user_id"}}},
		{cols: []string{"column_name"}, rows: [][]driver.Value{{"id"}, {"user_id"}, {"published"}}},
		{cols: []string{"id"}, rows: [][]driver.Value{{int64(7)}}},
	}, nil)

	visible, err := dtt_1_row_read.LockRowsVisibleForMutation(tx, "articles", "basic", 42, []int64{7})
	if err != nil {
		t.Fatalf("LockRowsVisibleForMutation returned error: %v", err)
	}
	if !visible {
		t.Fatal("visible = false, want true")
	}
	if len(state.queryCalls) != 5 {
		t.Fatalf("query calls = %d, want 5", len(state.queryCalls))
	}
	lockQuery := state.queryCalls[4]
	if !strings.Contains(lockQuery, `("articles"."published" = TRUE OR "articles"."user_id" = $2)`) {
		t.Fatalf("lock query = %q, want legacy flag-or-owner policy", lockQuery)
	}
	if !strings.Contains(lockQuery, "FOR UPDATE") {
		t.Fatalf("lock query = %q, want FOR UPDATE", lockQuery)
	}
	if !strings.Contains(lockQuery, `ORDER BY "articles"."id"`) {
		t.Fatalf("lock query = %q, want deterministic lock order", lockQuery)
	}
}

func TestLockRowsVisibleForMutationRejectsPartialRowSet(t *testing.T) {
	_, tx, _ := openDelRowTx(t, []queuedQuery{
		{cols: []string{"column_name"}, rows: nil},
		{cols: []string{"id"}, rows: [][]driver.Value{{int64(7)}}},
	}, nil)

	visible, err := dtt_1_row_read.LockRowsVisibleForMutation(tx, "articles", "basic", 42, []int64{7, 8})
	if err != nil {
		t.Fatalf("LockRowsVisibleForMutation returned error: %v", err)
	}
	if visible {
		t.Fatal("visible = true, want false when one requested row is missing or hidden")
	}
}

func TestLockRowsVisibleForMutationPilotActorRules(t *testing.T) {
	t.Run("owner", func(t *testing.T) {
		_, tx, state := openDelRowTx(t, []queuedQuery{
			{cols: []string{"id"}, rows: [][]driver.Value{{int64(41)}}},
		}, nil)
		visible, err := dtt_1_row_read.LockRowsVisibleForMutation(tx, deleteRLSPilotTableName, "basic", 7, []int64{41})
		if err != nil || !visible {
			t.Fatalf("owner visibility = (%v, %v), want (true, nil)", visible, err)
		}
		if len(state.queryCalls) != 1 || !strings.Contains(state.queryCalls[0], `"app_service_catalog"."user_id" = $2`) {
			t.Fatalf("owner query = %#v, want explicit owner predicate", state.queryCalls)
		}
	})

	t.Run("admin", func(t *testing.T) {
		_, tx, state := openDelRowTx(t, []queuedQuery{
			{cols: []string{"id"}, rows: [][]driver.Value{{int64(41)}}},
		}, nil)
		visible, err := dtt_1_row_read.LockRowsVisibleForMutation(tx, deleteRLSPilotTableName, "admin", 2, []int64{41})
		if err != nil || !visible {
			t.Fatalf("admin visibility = (%v, %v), want (true, nil)", visible, err)
		}
		if len(state.queryCalls) != 1 || strings.Contains(state.queryCalls[0], `."user_id" =`) {
			t.Fatalf("admin query = %#v, want no Go-side owner predicate", state.queryCalls)
		}
	})

	t.Run("guest", func(t *testing.T) {
		_, tx, state := openDelRowTx(t, nil, nil)
		visible, err := dtt_1_row_read.LockRowsVisibleForMutation(tx, deleteRLSPilotTableName, "guest", 1, []int64{41})
		if err != nil {
			t.Fatalf("guest check returned error: %v", err)
		}
		if visible {
			t.Fatal("guest visibility = true, want fail-closed false")
		}
		if len(state.queryCalls) != 0 {
			t.Fatalf("guest query calls = %#v, want none", state.queryCalls)
		}
	})
}

// ── logDeletionsToLog tests ────────────────────────────────────────────

func TestLogDeletionsNoOpsForEmptyIDs(t *testing.T) {
	_, tx, state := openDelRowTx(t, nil, nil)
	logDeletionsToLog(tx, "users", nil, "system")
	if len(state.execCalls) != 0 {
		t.Fatalf("exec calls = %d, want 0", len(state.execCalls))
	}
}

func TestLogDeletionsSkipsSystemTables(t *testing.T) {
	skipTables := []string{
		"system_db_tables",
		"system_column_details",
		"systemview_role_column_privileges",
		"systemview_role_table_privileges",
		"deletion_log",
	}
	for _, tbl := range skipTables {
		_, tx, state := openDelRowTx(t, nil, nil)
		logDeletionsToLog(tx, tbl, []int{1}, "system")
		if len(state.execCalls) != 0 {
			t.Fatalf("exec calls for %s = %d, want 0", tbl, len(state.execCalls))
		}
	}
}

func TestLogDeletionsBuildsBatchInsert(t *testing.T) {
	_, tx, state := openDelRowTx(t, nil, []queuedExec{{}, {}, {}})
	logDeletionsToLog(tx, "users", []int{10, 20}, "42")
	if len(state.execCalls) != 3 {
		t.Fatalf("exec calls = %d, want 3", len(state.execCalls))
	}
	if state.execCalls[0] != "SAVEPOINT deletion_log_insert" {
		t.Fatalf("exec[0] = %q, want SAVEPOINT", state.execCalls[0])
	}
	if !strings.Contains(state.execCalls[1], "INSERT INTO deletion_log") {
		t.Fatalf("exec[1] = %q, want INSERT INTO deletion_log", state.execCalls[1])
	}
	if !strings.Contains(state.execCalls[1], "ON CONFLICT") {
		t.Fatalf("exec[1] = %q, want ON CONFLICT clause", state.execCalls[1])
	}
	if state.execCalls[2] != "RELEASE SAVEPOINT deletion_log_insert" {
		t.Fatalf("exec[2] = %q, want RELEASE SAVEPOINT", state.execCalls[2])
	}
}

func TestMoveChildAssetStorageToDeletedHandlesLegacyChildMediaTables(t *testing.T) {
	_, tx, state := openDelRowTx(t, []queuedQuery{
		{
			cols: []string{"table_name", "source_column_name"},
			rows: [][]driver.Value{
				{"services_gallery", "services_id"},
			},
		},
		{
			cols: []string{"id"},
			rows: [][]driver.Value{
				{int64(9)},
			},
		},
		{
			cols: []string{"table_uid"},
			rows: [][]driver.Value{
				{"assetuid"},
			},
		},
	}, nil)

	tempDir := t.TempDir()
	oldWD, err := os.Getwd()
	if err != nil {
		t.Fatalf("os.Getwd: %v", err)
	}
	if err := os.Chdir(tempDir); err != nil {
		t.Fatalf("os.Chdir(%q): %v", tempDir, err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(oldWD)
	})

	src := filepath.Join("storage", "assetuid", "9")
	if err := os.MkdirAll(src, 0755); err != nil {
		t.Fatalf("os.MkdirAll(%q): %v", src, err)
	}

	storageMoves := collectChildAssetStorageMoves(tx, "services", []int{5})
	if _, err := os.Stat(src); err != nil {
		t.Fatalf("collect phase moved live storage before delete success: %v", err)
	}
	if _, err := os.Stat(filepath.Join("storage_deleted", "assetuid", "9")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("collect phase created deleted storage, err=%v", err)
	}
	moveRowStoragePlansToDeleted(storageMoves)

	if _, err := os.Stat(filepath.Join("storage_deleted", "assetuid", "9")); err != nil {
		t.Fatalf("expected moved legacy child storage, got stat error: %v", err)
	}
	if len(state.queryCalls) < 2 {
		t.Fatalf("query calls = %#v, want child relation lookup and child id lookup", state.queryCalls)
	}
	if !strings.Contains(state.queryCalls[0], "target_insert_specs->'file_upload' IS NOT NULL") {
		t.Fatalf("expected first query to prefer file_upload metadata lookup, got %q", state.queryCalls[0])
	}
	if !strings.Contains(state.queryCalls[0], "profile_key") {
		t.Fatalf("expected first query to exclude shared asset profile rows, got %q", state.queryCalls[0])
	}
	if !strings.Contains(state.queryCalls[1], `FROM "services_gallery"`) {
		t.Fatalf("expected second query to target services_gallery, got %q", state.queryCalls[1])
	}
}

func TestMoveSharedAssetFilesToDeletedUsesParentStorageLayout(t *testing.T) {
	tempDir := t.TempDir()
	oldWD, err := os.Getwd()
	if err != nil {
		t.Fatalf("os.Getwd: %v", err)
	}
	if err := os.Chdir(tempDir); err != nil {
		t.Fatalf("os.Chdir(%q): %v", tempDir, err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(oldWD)
	})

	originalPath := filepath.Join("storage", "104", "41", "original", "104_41_9.pdf")
	thumbPath := filepath.Join("storage", "104", "41", "300", "104_41_9.pdf")
	if err := os.MkdirAll(filepath.Dir(originalPath), 0755); err != nil {
		t.Fatalf("os.MkdirAll(original): %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(thumbPath), 0755); err != nil {
		t.Fatalf("os.MkdirAll(thumb): %v", err)
	}
	if err := os.WriteFile(originalPath, []byte("attachment"), 0644); err != nil {
		t.Fatalf("os.WriteFile(original): %v", err)
	}
	if err := os.WriteFile(thumbPath, []byte("thumb"), 0644); err != nil {
		t.Fatalf("os.WriteFile(thumb): %v", err)
	}

	moveSharedAssetFilesToDeleted([]dtt_asset_linking.SharedAssetFileMove{
		{
			StorageTableUID: "104",
			StorageRowID:    41,
			Filename:        "104_41_9.pdf",
		},
	})

	if _, err := os.Stat(filepath.Join("storage_deleted", "104", "41", "original", "104_41_9.pdf")); err != nil {
		t.Fatalf("expected moved original file, got stat error: %v", err)
	}
	if _, err := os.Stat(filepath.Join("storage_deleted", "104", "41", "300", "104_41_9.pdf")); err != nil {
		t.Fatalf("expected moved thumbnail file, got stat error: %v", err)
	}
	if _, err := os.Stat(originalPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expected original file to be gone from live storage, got err=%v", err)
	}
}

func TestLogDeletionsExecErrorIsNonFatal(t *testing.T) {
	_, tx, state := openDelRowTx(t, nil, []queuedExec{
		{},
		{err: errors.New("log boom")},
		{},
		{},
	})
	logDeletionsToLog(tx, "users", []int{1}, "system")
	if len(state.execCalls) != 4 {
		t.Fatalf("exec calls = %d, want 4", len(state.execCalls))
	}
	if state.execCalls[0] != "SAVEPOINT deletion_log_insert" {
		t.Fatalf("exec[0] = %q, want SAVEPOINT", state.execCalls[0])
	}
	if !strings.Contains(state.execCalls[1], "INSERT INTO deletion_log") {
		t.Fatalf("exec[1] = %q, want INSERT INTO deletion_log", state.execCalls[1])
	}
	if state.execCalls[2] != "ROLLBACK TO SAVEPOINT deletion_log_insert" {
		t.Fatalf("exec[2] = %q, want ROLLBACK TO SAVEPOINT", state.execCalls[2])
	}
	if state.execCalls[3] != "RELEASE SAVEPOINT deletion_log_insert" {
		t.Fatalf("exec[3] = %q, want RELEASE SAVEPOINT", state.execCalls[3])
	}
}

// ── deleteGenericRows tests ────────────────────────────────────────────

func TestDeleteGenericRowsHappyPath(t *testing.T) {
	_, tx, state := openDelRowTx(t, nil, []queuedExec{
		{},                                       // generic delete SAVEPOINT
		{rowsAffected: 2, setRowsAffected: true}, // DELETE FROM table
		{},                                       // generic delete RELEASE SAVEPOINT
		{},                                       // deletion log SAVEPOINT
		{},                                       // logDeletionsToLog INSERT
		{},                                       // deletion log RELEASE SAVEPOINT
	})

	err := deleteGenericRows(tx, "users", []int{10, 20}, "42", "admin", 42)
	if err != nil {
		t.Fatalf("deleteGenericRows returned error: %v", err)
	}
	if len(state.execCalls) != 6 {
		t.Fatalf("exec calls = %d, want 6", len(state.execCalls))
	}
	if state.execCalls[0] != "SAVEPOINT generic_row_delete" {
		t.Fatalf("exec[0] = %q, want generic delete SAVEPOINT", state.execCalls[0])
	}
	if !strings.Contains(state.execCalls[1], `DELETE FROM "users" WHERE "users"."id" IN`) {
		t.Fatalf("exec[1] = %q, want DELETE statement", state.execCalls[1])
	}
	if state.execCalls[2] != "RELEASE SAVEPOINT generic_row_delete" {
		t.Fatalf("exec[2] = %q, want generic delete RELEASE before logging", state.execCalls[2])
	}
	if state.execCalls[3] != "SAVEPOINT deletion_log_insert" {
		t.Fatalf("exec[3] = %q, want deletion log SAVEPOINT", state.execCalls[3])
	}
	if !strings.Contains(state.execCalls[4], "INSERT INTO deletion_log") {
		t.Fatalf("exec[4] = %q, want deletion log INSERT", state.execCalls[4])
	}
}

func TestDeleteGenericRowsRepeatsLegacyMutationPolicyInDelete(t *testing.T) {
	_, tx, state := openDelRowTx(t, []queuedQuery{
		{cols: []string{"column_name"}, rows: [][]driver.Value{{"published"}}},
		{cols: []string{"exists"}, rows: [][]driver.Value{{true}}},
		{cols: []string{"row_policy_owner_column"}, rows: [][]driver.Value{{"user_id"}}},
		{cols: []string{"column_name"}, rows: [][]driver.Value{{"id"}, {"user_id"}, {"published"}}},
	}, []queuedExec{
		{}, // generic delete SAVEPOINT
		{}, // DELETE
		{}, // generic delete RELEASE SAVEPOINT
		{}, // deletion log SAVEPOINT
		{}, // deletion log INSERT
		{}, // deletion log RELEASE SAVEPOINT
	})

	err := deleteGenericRows(tx, "articles", []int{7}, "42", "basic", 42)
	if err != nil {
		t.Fatalf("deleteGenericRows returned error: %v", err)
	}
	if len(state.execCalls) < 2 {
		t.Fatalf("exec calls = %#v, want guarded DELETE", state.execCalls)
	}
	deleteQuery := state.execCalls[1]
	if !strings.Contains(deleteQuery, `("articles"."published" = TRUE OR "articles"."user_id" = $2)`) {
		t.Fatalf("delete query = %q, want legacy flag-or-owner predicate", deleteQuery)
	}
}

func TestDeleteGenericRowsPropagatesExecError(t *testing.T) {
	wantErr := errors.New("delete boom")
	_, tx, state := openDelRowTx(t, nil, []queuedExec{
		{},             // SAVEPOINT
		{err: wantErr}, // DELETE fails
		{},             // ROLLBACK TO SAVEPOINT
		{},             // RELEASE SAVEPOINT
	})

	err := deleteGenericRows(tx, "users", []int{1}, "system", "admin", 2)
	if err == nil || !strings.Contains(err.Error(), "error deleting rows") {
		t.Fatalf("err = %v, want wrapped delete error", err)
	}
	if len(state.execCalls) != 4 || state.execCalls[2] != "ROLLBACK TO SAVEPOINT generic_row_delete" || state.execCalls[3] != "RELEASE SAVEPOINT generic_row_delete" {
		t.Fatalf("exec calls = %#v, want failed DELETE rolled back and savepoint released", state.execCalls)
	}
	for _, call := range state.execCalls {
		if strings.Contains(call, "deletion_log") {
			t.Fatalf("deletion log call after failed DELETE: %q", call)
		}
	}
}

func TestDeleteGenericRowsRollsBackWhenRowsAffectedFails(t *testing.T) {
	wantErr := errors.New("rows affected unavailable")
	_, tx, state := openDelRowTx(t, nil, []queuedExec{
		{},                         // SAVEPOINT
		{rowsAffectedErr: wantErr}, // DELETE result cannot be verified
		{},                         // ROLLBACK TO SAVEPOINT
		{},                         // RELEASE SAVEPOINT
	})

	err := deleteGenericRows(tx, "users", []int{1}, "system", "admin", 2)
	if err == nil || !strings.Contains(err.Error(), "error verifying deleted rows") {
		t.Fatalf("err = %v, want wrapped RowsAffected error", err)
	}
	if len(state.execCalls) != 4 || state.execCalls[2] != "ROLLBACK TO SAVEPOINT generic_row_delete" || state.execCalls[3] != "RELEASE SAVEPOINT generic_row_delete" {
		t.Fatalf("exec calls = %#v, want unverifiable DELETE rolled back and savepoint released", state.execCalls)
	}
	for _, call := range state.execCalls {
		if strings.Contains(call, "deletion_log") {
			t.Fatalf("deletion log call after unverifiable DELETE: %q", call)
		}
	}
}

func TestDeleteGenericRowsContinuesWhenDeletionLogInsertFails(t *testing.T) {
	_, tx, state := openDelRowTx(t, nil, []queuedExec{
		{},                        // generic delete SAVEPOINT
		{},                        // DELETE FROM table
		{},                        // generic delete RELEASE SAVEPOINT
		{},                        // deletion log SAVEPOINT
		{err: errors.New("boom")}, // deletion log INSERT
		{},                        // deletion log ROLLBACK TO SAVEPOINT
		{},                        // deletion log RELEASE SAVEPOINT
	})

	err := deleteGenericRows(tx, "users", []int{10}, "42", "admin", 42)
	if err != nil {
		t.Fatalf("deleteGenericRows returned error: %v", err)
	}
	if len(state.execCalls) != 7 {
		t.Fatalf("exec calls = %d, want 7", len(state.execCalls))
	}
	if state.execCalls[2] != "RELEASE SAVEPOINT generic_row_delete" {
		t.Fatalf("exec[2] = %q, want generic delete RELEASE", state.execCalls[2])
	}
	if state.execCalls[3] != "SAVEPOINT deletion_log_insert" {
		t.Fatalf("exec[3] = %q, want deletion log SAVEPOINT", state.execCalls[3])
	}
	if state.execCalls[5] != "ROLLBACK TO SAVEPOINT deletion_log_insert" {
		t.Fatalf("exec[5] = %q, want deletion log ROLLBACK TO SAVEPOINT", state.execCalls[5])
	}
}

func TestDeleteGenericRowsSkipsDeletionLogForSystemTable(t *testing.T) {
	// When tableName is a system table, logDeletionsToLog skips after the guarded DELETE.
	_, tx, state := openDelRowTx(t, nil, []queuedExec{
		{}, // SAVEPOINT
		{}, // DELETE
		{}, // RELEASE SAVEPOINT
	})

	err := deleteGenericRows(tx, "system_db_tables", []int{1}, "system", "admin", 2)
	if err != nil {
		t.Fatalf("deleteGenericRows returned error: %v", err)
	}
	if len(state.execCalls) != 3 {
		t.Fatalf("exec calls = %d, want 3 (guarded DELETE only)", len(state.execCalls))
	}
}

func TestDeleteGenericRowsRlsPilotRejectsPartialDelete(t *testing.T) {
	_, tx, state := openDelRowTx(t, nil, []queuedExec{
		{},                                       // SAVEPOINT
		{rowsAffected: 1, setRowsAffected: true}, // partial DELETE
		{},                                       // ROLLBACK TO SAVEPOINT
		{},                                       // RELEASE SAVEPOINT
	})

	err := deleteGenericRows(tx, deleteRLSPilotTableName, []int{10, 20}, "42", "basic", 42)
	if err == nil {
		t.Fatalf("deleteGenericRows returned nil, want forbidden error")
	}
	var fe *forbiddenError
	if !errors.As(err, &fe) {
		t.Fatalf("err = %v, want forbiddenError", err)
	}
	if len(state.execCalls) != 4 {
		t.Fatalf("exec calls = %d, want SAVEPOINT, DELETE, ROLLBACK TO, RELEASE", len(state.execCalls))
	}
	if state.execCalls[0] != "SAVEPOINT generic_row_delete" ||
		!strings.Contains(state.execCalls[1], `DELETE FROM "app_service_catalog" WHERE "app_service_catalog"."id" IN`) ||
		!strings.Contains(state.execCalls[1], `"app_service_catalog"."user_id" = $3`) ||
		state.execCalls[2] != "ROLLBACK TO SAVEPOINT generic_row_delete" ||
		state.execCalls[3] != "RELEASE SAVEPOINT generic_row_delete" {
		t.Fatalf("exec calls = %#v, want partial DELETE fully rolled back", state.execCalls)
	}
	for _, call := range state.execCalls {
		if strings.Contains(call, "deletion_log") {
			t.Fatalf("deletion log call after partial DELETE: %q", call)
		}
	}
}

func TestDeleteGenericRowsRlsPilotAllowsExactDeleteAndLogsAfterward(t *testing.T) {
	_, tx, state := openDelRowTx(t, nil, []queuedExec{
		{},                                       // generic delete SAVEPOINT
		{rowsAffected: 2, setRowsAffected: true}, // DELETE
		{},                                       // generic delete RELEASE SAVEPOINT
		{},                                       // deletion log SAVEPOINT
		{},                                       // deletion log INSERT
		{},                                       // deletion log RELEASE SAVEPOINT
	})

	err := deleteGenericRows(tx, deleteRLSPilotTableName, []int{10, 20}, "42", "basic", 42)
	if err != nil {
		t.Fatalf("deleteGenericRows returned error: %v", err)
	}
	if len(state.execCalls) != 6 {
		t.Fatalf("exec calls = %d, want 6", len(state.execCalls))
	}
	if state.execCalls[0] != "SAVEPOINT generic_row_delete" {
		t.Fatalf("exec[0] = %q, want generic delete SAVEPOINT", state.execCalls[0])
	}
	if !strings.Contains(state.execCalls[1], `DELETE FROM "app_service_catalog" WHERE "app_service_catalog"."id" IN`) ||
		!strings.Contains(state.execCalls[1], `"app_service_catalog"."user_id" = $3`) {
		t.Fatalf("exec[1] = %q, want DELETE statement", state.execCalls[1])
	}
	if state.execCalls[2] != "RELEASE SAVEPOINT generic_row_delete" {
		t.Fatalf("exec[2] = %q, want generic delete RELEASE", state.execCalls[2])
	}
	if state.execCalls[3] != "SAVEPOINT deletion_log_insert" || !strings.Contains(state.execCalls[4], "INSERT INTO deletion_log") {
		t.Fatalf("exec calls = %#v, want deletion log only after generic delete RELEASE", state.execCalls)
	}
}

// ── revokeColumnPrivileges tests ───────────────────────────────────────

func TestCanonicalizeRevokePrivilegeAcceptsSupportedPrivileges(t *testing.T) {
	testCases := []struct {
		name  string
		raw   string
		scope revokePrivilegeScope
		want  string
	}{
		{name: "column select", raw: " select ", scope: revokeColumnPrivilegeScope, want: "SELECT"},
		{name: "column references", raw: "references", scope: revokeColumnPrivilegeScope, want: "REFERENCES"},
		{name: "table delete", raw: "delete", scope: revokeTablePrivilegeScope, want: "DELETE"},
		{name: "table trigger", raw: "TRIGGER", scope: revokeTablePrivilegeScope, want: "TRIGGER"},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			got, err := canonicalizeRevokePrivilege(testCase.raw, testCase.scope)
			if err != nil {
				t.Fatalf("canonicalizeRevokePrivilege returned error: %v", err)
			}
			if got != testCase.want {
				t.Fatalf("canonicalizeRevokePrivilege(%q) = %q, want %q", testCase.raw, got, testCase.want)
			}
		})
	}
}

func TestRevokePrivilegesRejectInvalidValuesBeforeExec(t *testing.T) {
	testCases := []struct {
		name        string
		column      bool
		byID        bool
		privilege   string
		wantErrText string
	}{
		{
			name:        "column ID rejects injected statement",
			column:      true,
			byID:        true,
			privilege:   "SELECT; DROP TABLE public.users; --",
			wantErrText: "invalid column privilege",
		},
		{
			name:        "column row rejects unknown privilege",
			column:      true,
			privilege:   "EXECUTE",
			wantErrText: "unsupported column privilege",
		},
		{
			name:        "table ID rejects multi-token privilege",
			byID:        true,
			privilege:   "ALL PRIVILEGES",
			wantErrText: "invalid table privilege",
		},
		{
			name:        "table row rejects blank privilege",
			privilege:   "   ",
			wantErrText: "invalid table privilege",
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			var queries []queuedQuery
			if testCase.byID {
				columns := []string{"role_name", "table_schema", "table_name", "privilege"}
				values := []driver.Value{"admin", "public", "users", testCase.privilege}
				if testCase.column {
					columns = []string{"role_name", "table_schema", "table_name", "column_name", "privilege"}
					values = []driver.Value{"admin", "public", "users", "email", testCase.privilege}
				}
				queries = []queuedQuery{{cols: columns, rows: [][]driver.Value{values}}}
			}

			_, tx, state := openDelRowTx(t, queries, nil)
			rows := []map[string]string{{
				"role_name":    "admin",
				"table_schema": "public",
				"table_name":   "users",
				"column_name":  "email",
				"privilege":    testCase.privilege,
			}}

			var err error
			switch {
			case testCase.column && testCase.byID:
				err = revokeColumnPrivileges(tx, []int{1}, nil)
			case testCase.column:
				err = revokeColumnPrivileges(tx, nil, rows)
			case testCase.byID:
				err = revokeTablePrivileges(tx, []int{1}, nil)
			default:
				err = revokeTablePrivileges(tx, nil, rows)
			}

			if err == nil || !strings.Contains(err.Error(), testCase.wantErrText) {
				t.Fatalf("err = %v, want error containing %q", err, testCase.wantErrText)
			}
			if len(state.execCalls) != 0 {
				t.Fatalf("exec calls = %v, want none for rejected privilege", state.execCalls)
			}
		})
	}
}

func TestRevokeColumnPrivilegesByIDs(t *testing.T) {
	_, tx, state := openDelRowTx(t, []queuedQuery{
		{
			cols: []string{"role_name", "table_schema", "table_name", "column_name", "privilege"},
			rows: [][]driver.Value{{"admin", "public", "users", "email", "SELECT"}},
		},
	}, []queuedExec{
		{}, // REVOKE
	})

	err := revokeColumnPrivileges(tx, []int{1}, nil)
	if err != nil {
		t.Fatalf("revokeColumnPrivileges returned error: %v", err)
	}
	if len(state.execCalls) != 1 || !strings.Contains(state.execCalls[0], "REVOKE") {
		t.Fatalf("exec calls = %v, want REVOKE", state.execCalls)
	}
}

func TestRevokeColumnPrivilegesByRows(t *testing.T) {
	_, tx, state := openDelRowTx(t, nil, []queuedExec{
		{}, // REVOKE
	})

	rows := []map[string]string{{
		"role_name":    "admin",
		"table_schema": "public",
		"table_name":   "users",
		"column_name":  "email",
		"privilege":    " select ",
	}}
	err := revokeColumnPrivileges(tx, nil, rows)
	if err != nil {
		t.Fatalf("revokeColumnPrivileges returned error: %v", err)
	}
	wantQuery := `REVOKE SELECT ("email") ON "public"."users" FROM "admin"`
	if len(state.execCalls) != 1 || state.execCalls[0] != wantQuery {
		t.Fatalf("exec calls = %v, want %q", state.execCalls, wantQuery)
	}
}

func TestRevokeColumnPrivilegesQueryError(t *testing.T) {
	_, tx, _ := openDelRowTx(t, []queuedQuery{
		{err: errors.New("query boom")},
	}, nil)

	err := revokeColumnPrivileges(tx, []int{1}, nil)
	if err == nil || !strings.Contains(err.Error(), "error fetching row") {
		t.Fatalf("err = %v, want wrapped query error", err)
	}
}

func TestRevokeColumnPrivilegesExecError(t *testing.T) {
	_, tx, _ := openDelRowTx(t, []queuedQuery{
		{
			cols: []string{"role_name", "table_schema", "table_name", "column_name", "privilege"},
			rows: [][]driver.Value{{"admin", "public", "users", "email", "SELECT"}},
		},
	}, []queuedExec{
		{err: errors.New("revoke boom")},
	})

	err := revokeColumnPrivileges(tx, []int{1}, nil)
	if err == nil || !strings.Contains(err.Error(), "error revoking privilege") {
		t.Fatalf("err = %v, want wrapped revoke error", err)
	}
}

// ── revokeTablePrivileges tests ────────────────────────────────────────

func TestRevokeTablePrivilegesByIDs(t *testing.T) {
	_, tx, state := openDelRowTx(t, []queuedQuery{
		{
			cols: []string{"role_name", "table_schema", "table_name", "privilege"},
			rows: [][]driver.Value{{"admin", "public", "users", "SELECT"}},
		},
	}, []queuedExec{
		{}, // REVOKE
	})

	err := revokeTablePrivileges(tx, []int{1}, nil)
	if err != nil {
		t.Fatalf("revokeTablePrivileges returned error: %v", err)
	}
	if len(state.execCalls) != 1 || !strings.Contains(state.execCalls[0], "REVOKE") {
		t.Fatalf("exec calls = %v, want REVOKE", state.execCalls)
	}
}

func TestRevokeTablePrivilegesQueryError(t *testing.T) {
	_, tx, _ := openDelRowTx(t, []queuedQuery{
		{err: errors.New("query boom")},
	}, nil)

	err := revokeTablePrivileges(tx, []int{1}, nil)
	if err == nil || !strings.Contains(err.Error(), "error fetching row") {
		t.Fatalf("err = %v, want wrapped query error", err)
	}
}

func TestRevokeTablePrivilegesByRows(t *testing.T) {
	_, tx, state := openDelRowTx(t, nil, []queuedExec{
		{}, // REVOKE
	})

	rows := []map[string]string{{
		"role_name":    "admin",
		"table_schema": "public",
		"table_name":   "users",
		"privilege":    " delete ",
	}}
	err := revokeTablePrivileges(tx, nil, rows)
	if err != nil {
		t.Fatalf("revokeTablePrivileges returned error: %v", err)
	}
	wantQuery := `REVOKE DELETE ON "public"."users" FROM "admin"`
	if len(state.execCalls) != 1 || state.execCalls[0] != wantQuery {
		t.Fatalf("exec calls = %v, want %q", state.execCalls, wantQuery)
	}
}

// ── deleteSystemTables tests ───────────────────────────────────────────

func TestDeleteSystemTablesQueryError(t *testing.T) {
	_, tx, _ := openDelRowTx(t, []queuedQuery{
		{err: errors.New("fetch boom")},
	}, nil)

	err := deleteSystemTables(context.Background(), tx, []int{1})
	if err == nil || !strings.Contains(err.Error(), "error fetching table name") {
		t.Fatalf("err = %v, want wrapped fetch error", err)
	}
}

func TestDeleteSystemTablesDropError(t *testing.T) {
	_, tx, _ := openDelRowTx(t, []queuedQuery{
		{
			cols: []string{"table_name", "table_uid", "schema_name"},
			rows: [][]driver.Value{{"test_table", int64(1), "public"}},
		},
	}, []queuedExec{
		{err: errors.New("drop boom")},
	})

	err := deleteSystemTables(context.Background(), tx, []int{1})
	if err == nil || !strings.Contains(err.Error(), "error dropping table") {
		t.Fatalf("err = %v, want wrapped drop error", err)
	}
}

func TestDeleteSystemTablesNullUIDFallback(t *testing.T) {
	// When table_uid IS NULL, it skips CleanupTableMetadata and deletes the row directly
	_, tx, state := openDelRowTx(t, []queuedQuery{
		{
			cols: []string{"table_name", "table_uid", "schema_name"},
			rows: [][]driver.Value{{"orphan_table", nil, nil}},
		},
	}, []queuedExec{
		{}, // DROP TABLE
		{}, // DELETE FROM system_db_tables (fallback)
	})

	err := deleteSystemTables(context.Background(), tx, []int{99})
	if err != nil {
		t.Fatalf("deleteSystemTables returned error: %v", err)
	}
	if len(state.execCalls) != 2 {
		t.Fatalf("exec calls = %d, want 2 (DROP + fallback DELETE)", len(state.execCalls))
	}
	if !strings.Contains(state.execCalls[0], "DROP TABLE") {
		t.Fatalf("exec[0] = %q, want DROP TABLE", state.execCalls[0])
	}
	if !strings.Contains(state.execCalls[1], "DELETE FROM system_db_tables") {
		t.Fatalf("exec[1] = %q, want fallback DELETE", state.execCalls[1])
	}
}

func TestDeleteSystemTablesNullUIDFallbackExecError(t *testing.T) {
	_, tx, _ := openDelRowTx(t, []queuedQuery{
		{
			cols: []string{"table_name", "table_uid", "schema_name"},
			rows: [][]driver.Value{{"orphan_table", nil, nil}},
		},
	}, []queuedExec{
		{},                                 // DROP TABLE succeeds
		{err: errors.New("fallback boom")}, // fallback DELETE fails
	})

	err := deleteSystemTables(context.Background(), tx, []int{99})
	if err == nil || !strings.Contains(err.Error(), "error deleting row from system_db_tables") {
		t.Fatalf("err = %v, want wrapped fallback error", err)
	}
}

// ── preprocessColumnDetailsDeletion tests ──────────────────────────────

func TestPreprocessColumnDetailsFirstQueryError(t *testing.T) {
	_, tx, _ := openDelRowTx(t, []queuedQuery{
		{err: errors.New("col fetch boom")},
	}, nil)

	err := preprocessColumnDetailsDeletion(tx, []int{1})
	if err == nil || !strings.Contains(err.Error(), "error fetching row") {
		t.Fatalf("err = %v, want wrapped fetch error", err)
	}
}

func TestPreprocessColumnDetailsTableNameQueryError(t *testing.T) {
	_, tx, _ := openDelRowTx(t, []queuedQuery{
		{
			cols: []string{"column_name", "table_uid"},
			rows: [][]driver.Value{{"col_a", int64(5)}},
		},
		{err: errors.New("table fetch boom")},
	}, nil)

	err := preprocessColumnDetailsDeletion(tx, []int{1})
	if err == nil || !strings.Contains(err.Error(), "error fetching table name") {
		t.Fatalf("err = %v, want wrapped table name error", err)
	}
}

func TestPreprocessColumnDetailsInvalidTableName(t *testing.T) {
	_, tx, _ := openDelRowTx(t, []queuedQuery{
		{
			cols: []string{"column_name", "table_uid"},
			rows: [][]driver.Value{{"col_a", int64(5)}},
		},
		{
			cols: []string{"table_name"},
			rows: [][]driver.Value{{"bad-table-name!"}},
		},
	}, nil)

	err := preprocessColumnDetailsDeletion(tx, []int{1})
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	var bre *badRequestError
	if !errors.As(err, &bre) {
		t.Fatalf("err = %v (type %T), want *badRequestError", err, err)
	}
	if bre.msg != "invalid table name" {
		t.Fatalf("badRequestError.msg = %q, want 'invalid table name'", bre.msg)
	}
}

func TestPreprocessColumnDetailsInvalidColumnName(t *testing.T) {
	_, tx, _ := openDelRowTx(t, []queuedQuery{
		{
			cols: []string{"column_name", "table_uid"},
			rows: [][]driver.Value{{"bad-col-name!", int64(5)}},
		},
		{
			cols: []string{"table_name"},
			rows: [][]driver.Value{{"valid_table"}},
		},
	}, nil)

	err := preprocessColumnDetailsDeletion(tx, []int{1})
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	var bre *badRequestError
	if !errors.As(err, &bre) {
		t.Fatalf("err = %v (type %T), want *badRequestError", err, err)
	}
	if bre.msg != "invalid column name" {
		t.Fatalf("badRequestError.msg = %q, want 'invalid column name'", bre.msg)
	}
}

// ── respondOK test ─────────────────────────────────────────────────────

func TestRespondOKWritesJSON(t *testing.T) {
	rec := httptest.NewRecorder()
	respondOK(rec, "test message")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "test message") {
		t.Fatalf("body = %q, want 'test message'", rec.Body.String())
	}
}
