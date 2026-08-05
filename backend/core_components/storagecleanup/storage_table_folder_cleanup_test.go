// storage_table_folder_cleanup_test.go
// Unit tests for storage-root maintenance helpers used by admin cleanup and dataset deletion.
// Bridges filesystem archiving behavior and the lightweight system_db_tables lookup contract.
// Exists so unknown table_uid folders can be cleaned safely without regressing row-level deleted storage.
package storagecleanup

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"

	backend "easelect/backend/core_components"
)

type mediaTableFolderMockDriver struct {
	knownUIDs []string
}

type mediaTableFolderMockConn struct {
	knownUIDs []string
}

type mediaTableFolderMockRows struct {
	cols []string
	rows [][]driver.Value
	idx  int
}

func (d *mediaTableFolderMockDriver) Open(string) (driver.Conn, error) {
	return &mediaTableFolderMockConn{knownUIDs: append([]string(nil), d.knownUIDs...)}, nil
}

func (c *mediaTableFolderMockConn) Prepare(string) (driver.Stmt, error) {
	return nil, fmt.Errorf("prepare not supported in media folder mock")
}

func (c *mediaTableFolderMockConn) Close() error { return nil }
func (c *mediaTableFolderMockConn) Begin() (driver.Tx, error) {
	return nil, fmt.Errorf("transactions not supported in media folder mock")
}

func (c *mediaTableFolderMockConn) Query(query string, args []driver.Value) (driver.Rows, error) {
	named := make([]driver.NamedValue, len(args))
	for i, arg := range args {
		named[i] = driver.NamedValue{Ordinal: i + 1, Value: arg}
	}
	return c.QueryContext(context.Background(), query, named)
}

func (c *mediaTableFolderMockConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	switch query {
	case `SELECT table_uid FROM system_db_tables`:
		rows := make([][]driver.Value, 0, len(c.knownUIDs))
		for _, uid := range c.knownUIDs {
			rows = append(rows, []driver.Value{uid})
		}
		return &mediaTableFolderMockRows{
			cols: []string{"table_uid"},
			rows: rows,
		}, nil
	case `SELECT table_uid, table_name FROM system_db_tables`:
		rows := make([][]driver.Value, 0, len(c.knownUIDs))
		for _, uid := range c.knownUIDs {
			rows = append(rows, []driver.Value{uid, "table_" + uid})
		}
		return &mediaTableFolderMockRows{
			cols: []string{"table_uid", "table_name"},
			rows: rows,
		}, nil
	default:
		return nil, fmt.Errorf("unexpected query: %s", query)
	}
}

func (r *mediaTableFolderMockRows) Columns() []string { return append([]string(nil), r.cols...) }
func (r *mediaTableFolderMockRows) Close() error      { return nil }

func (r *mediaTableFolderMockRows) Next(dest []driver.Value) error {
	if r.idx >= len(r.rows) {
		return io.EOF
	}
	copy(dest, r.rows[r.idx])
	r.idx++
	return nil
}

func openMediaTableFolderMockDB(t *testing.T, knownUIDs []string) *sql.DB {
	t.Helper()
	driverName := fmt.Sprintf("media_folder_test_%d", time.Now().UnixNano())
	sql.Register(driverName, &mediaTableFolderMockDriver{knownUIDs: knownUIDs})
	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open returned error: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})
	return db
}

func withWorkingDirectory(t *testing.T) string {
	t.Helper()
	oldWD, err := os.Getwd()
	if err != nil {
		t.Fatalf("os.Getwd: %v", err)
	}
	tempDir := t.TempDir()
	if err := os.Chdir(tempDir); err != nil {
		t.Fatalf("os.Chdir: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(oldWD)
	})
	return tempDir
}

func TestArchiveTableStorageFolderMovesContentsIntoStorageDeleted(t *testing.T) {
	withWorkingDirectory(t)

	srcOriginal := filepath.Join(StorageRootDir, "2868", "1", "original")
	dstOriginal := filepath.Join(StorageDeletedRootDir, "2868", "9", "original")
	if err := os.MkdirAll(srcOriginal, 0755); err != nil {
		t.Fatalf("os.MkdirAll src: %v", err)
	}
	if err := os.MkdirAll(dstOriginal, 0755); err != nil {
		t.Fatalf("os.MkdirAll dst: %v", err)
	}
	if err := os.WriteFile(filepath.Join(srcOriginal, "new.png"), []byte("new"), 0644); err != nil {
		t.Fatalf("os.WriteFile src: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dstOriginal, "old.png"), []byte("old"), 0644); err != nil {
		t.Fatalf("os.WriteFile dst: %v", err)
	}

	if err := ArchiveTableStorageFolder("2868"); err != nil {
		t.Fatalf("ArchiveTableStorageFolder returned error: %v", err)
	}

	if _, err := os.Stat(filepath.Join(StorageRootDir, "2868")); !os.IsNotExist(err) {
		t.Fatalf("storage root still exists after archive: %v", err)
	}
	if _, err := os.Stat(filepath.Join(StorageDeletedRootDir, "2868", "1", "original", "new.png")); err != nil {
		t.Fatalf("archived file missing: %v", err)
	}
	if _, err := os.Stat(filepath.Join(StorageDeletedRootDir, "2868", "9", "original", "old.png")); err != nil {
		t.Fatalf("existing deleted-storage file missing after archive: %v", err)
	}
}

func TestArchiveUnknownStorageTableFoldersMovesOnlyUnknownRoots(t *testing.T) {
	withWorkingDirectory(t)

	originalDB := backend.Db
	backend.Db = openMediaTableFolderMockDB(t, []string{"141", "104"})
	t.Cleanup(func() {
		backend.Db = originalDB
	})

	for _, folderName := range []string{"141", "2868", "2916"} {
		if err := os.MkdirAll(filepath.Join(StorageRootDir, folderName, "1"), 0755); err != nil {
			t.Fatalf("os.MkdirAll(%s): %v", folderName, err)
		}
	}

	archived, err := ArchiveUnknownStorageTableFolders()
	if err != nil {
		t.Fatalf("ArchiveUnknownStorageTableFolders returned error: %v", err)
	}
	sort.Strings(archived)
	wantArchived := []string{"2868", "2916"}
	if len(archived) != len(wantArchived) {
		t.Fatalf("archived len = %d, want %d (%v)", len(archived), len(wantArchived), archived)
	}
	for i := range wantArchived {
		if archived[i] != wantArchived[i] {
			t.Fatalf("archived[%d] = %q, want %q", i, archived[i], wantArchived[i])
		}
	}

	if _, err := os.Stat(filepath.Join(StorageRootDir, "141")); err != nil {
		t.Fatalf("known folder should remain in storage/: %v", err)
	}
	if _, err := os.Stat(filepath.Join(StorageDeletedRootDir, "2868", "1")); err != nil {
		t.Fatalf("unknown folder 2868 not archived: %v", err)
	}
	if _, err := os.Stat(filepath.Join(StorageDeletedRootDir, "2916", "1")); err != nil {
		t.Fatalf("unknown folder 2916 not archived: %v", err)
	}
}

func TestListArchivedStorageTableFoldersMarksOnlyMissingRootsPrunable(t *testing.T) {
	withWorkingDirectory(t)

	originalDB := backend.Db
	backend.Db = openMediaTableFolderMockDB(t, []string{"141", "104"})
	t.Cleanup(func() {
		backend.Db = originalDB
	})

	for _, folderName := range []string{"141", "2868", "2916"} {
		if err := os.MkdirAll(filepath.Join(StorageDeletedRootDir, folderName, "1"), 0755); err != nil {
			t.Fatalf("os.MkdirAll(%s): %v", folderName, err)
		}
	}

	archived, err := ListArchivedStorageTableFolders()
	if err != nil {
		t.Fatalf("ListArchivedStorageTableFolders returned error: %v", err)
	}

	if len(archived) != 3 {
		t.Fatalf("len(archived) = %d, want 3", len(archived))
	}
	if archived[0].FolderName != "141" || !archived[0].IsLive || archived[0].Prunable {
		t.Fatalf("archived[0] = %#v, want live kept folder", archived[0])
	}
	if archived[1].FolderName != "2868" || archived[1].IsLive || !archived[1].Prunable {
		t.Fatalf("archived[1] = %#v, want missing prunable folder", archived[1])
	}
	if archived[2].FolderName != "2916" || archived[2].IsLive || !archived[2].Prunable {
		t.Fatalf("archived[2] = %#v, want missing prunable folder", archived[2])
	}
}

func TestPruneArchivedStorageTableFoldersRemovesOnlyMissingRoots(t *testing.T) {
	withWorkingDirectory(t)

	originalDB := backend.Db
	backend.Db = openMediaTableFolderMockDB(t, []string{"141"})
	t.Cleanup(func() {
		backend.Db = originalDB
	})

	for _, folderName := range []string{"141", "2868", "2916"} {
		if err := os.MkdirAll(filepath.Join(StorageDeletedRootDir, folderName, "1"), 0755); err != nil {
			t.Fatalf("os.MkdirAll(%s): %v", folderName, err)
		}
	}

	pruned, err := PruneArchivedStorageTableFolders([]string{"141", "2868", "2916"})
	if err != nil {
		t.Fatalf("PruneArchivedStorageTableFolders returned error: %v", err)
	}
	sort.Strings(pruned)
	wantPruned := []string{"2868", "2916"}
	if len(pruned) != len(wantPruned) {
		t.Fatalf("len(pruned) = %d, want %d (%v)", len(pruned), len(wantPruned), pruned)
	}
	for i := range wantPruned {
		if pruned[i] != wantPruned[i] {
			t.Fatalf("pruned[%d] = %q, want %q", i, pruned[i], wantPruned[i])
		}
	}

	if _, err := os.Stat(filepath.Join(StorageDeletedRootDir, "141", "1")); err != nil {
		t.Fatalf("live archived folder should remain: %v", err)
	}
	if _, err := os.Stat(filepath.Join(StorageDeletedRootDir, "2868")); !os.IsNotExist(err) {
		t.Fatalf("pruned archived folder 2868 should be removed, got: %v", err)
	}
	if _, err := os.Stat(filepath.Join(StorageDeletedRootDir, "2916")); !os.IsNotExist(err) {
		t.Fatalf("pruned archived folder 2916 should be removed, got: %v", err)
	}
}
