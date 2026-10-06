// delete_row_test.go
// Unit tests for the dtt_1_row_delete package.
// Uses httptest for handler guard branches and a database/sql driver double for the extracted transaction-level helpers.
// Keeps request guards and storage cleanup separate from row and privilege deletion checks.
package dtt_1_row_delete

import (
	"database/sql/driver"
	"easelect/backend/core_components/dbutils"
	dtt_1_row_read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	dtt_asset_linking "easelect/backend/core_components/dynamic_table_tools/dtt_asset_linking"
	"easelect/backend/core_components/runtimepaths"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/lib/pq"
)

func TestWrapperMissingDataset(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/delete-rows", nil)
	rec := httptest.NewRecorder()
	DeleteRowsHandlerWrapper(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
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

func TestRespondWithDeleteRowsErrorReturnsSafeConflictForReferencedRows(t *testing.T) {
	databaseErr := &pq.Error{
		Code:       "23503",
		Constraint: "private_child_parent_id_fkey",
		Detail:     "Sensitive row details",
	}
	rec := httptest.NewRecorder()

	respondWithDeleteRowsError(rec, fmt.Errorf("delete failed: %w", databaseErr))

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), referencedRowsDeleteConflictMessage) {
		t.Fatalf("body = %q, want safe conflict message", rec.Body.String())
	}
	for _, leaked := range []string{"23503", databaseErr.Constraint, databaseErr.Detail} {
		if strings.Contains(rec.Body.String(), leaked) {
			t.Fatalf("body = %q, leaked database detail %q", rec.Body.String(), leaked)
		}
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

	paths := configureNestedRuntimePaths(t)

	src := filepath.Join(paths.StorageRoot, "assetuid", "9")
	if err := os.MkdirAll(src, 0755); err != nil {
		t.Fatalf("os.MkdirAll(%q): %v", src, err)
	}

	storageMoves := collectChildAssetStorageMoves(tx, "services", []int{5})
	if _, err := os.Stat(src); err != nil {
		t.Fatalf("collect phase moved live storage before delete success: %v", err)
	}
	if _, err := os.Stat(filepath.Join(paths.StorageDeletedRoot, "assetuid", "9")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("collect phase created deleted storage, err=%v", err)
	}
	moveRowStoragePlansToDeleted(storageMoves)

	if _, err := os.Stat(filepath.Join(paths.StorageDeletedRoot, "assetuid", "9")); err != nil {
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
	paths := configureNestedRuntimePaths(t)

	originalPath := filepath.Join(paths.StorageRoot, "104", "41", "original", "104_41_9.pdf")
	thumbPath := filepath.Join(paths.StorageRoot, "104", "41", "300", "104_41_9.pdf")
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

	if _, err := os.Stat(filepath.Join(paths.StorageDeletedRoot, "104", "41", "original", "104_41_9.pdf")); err != nil {
		t.Fatalf("expected moved original file, got stat error: %v", err)
	}
	if _, err := os.Stat(filepath.Join(paths.StorageDeletedRoot, "104", "41", "300", "104_41_9.pdf")); err != nil {
		t.Fatalf("expected moved thumbnail file, got stat error: %v", err)
	}
	if _, err := os.Stat(originalPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expected original file to be gone from live storage, got err=%v", err)
	}
}

func configureNestedRuntimePaths(t *testing.T) runtimepaths.Paths {
	t.Helper()
	originalPaths := runtimepaths.Current()
	workingDirectory, err := os.Getwd()
	if err != nil {
		t.Fatalf("os.Getwd() error = %v", err)
	}
	t.Cleanup(func() {
		if err := runtimepaths.Configure(originalPaths); err == nil {
			return
		}
		legacyPaths, resolveErr := runtimepaths.Resolve(workingDirectory, workingDirectory, false)
		if resolveErr == nil {
			_ = runtimepaths.Configure(legacyPaths)
		}
	})

	installationRoot := t.TempDir()
	paths, err := runtimepaths.Resolve(filepath.Join(installationRoot, "app"), installationRoot, true)
	if err != nil {
		t.Fatalf("runtimepaths.Resolve() error = %v", err)
	}
	if err := runtimepaths.Configure(paths); err != nil {
		t.Fatalf("runtimepaths.Configure() error = %v", err)
	}
	return paths
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
