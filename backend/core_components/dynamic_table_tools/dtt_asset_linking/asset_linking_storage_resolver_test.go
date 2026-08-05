// asset_linking_storage_resolver_test.go
// Unit tests for shared asset storage resolution helpers.
// Bridges a database/sql driver double and canonical parent-based `_assets` storage semantics.
// Exists to keep shared upload/delete path calculations stable while historical media roots still exist.
package dtt_asset_linking

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sync"
	"testing"
	"time"
)

type storageQueuedQuery struct {
	cols []string
	rows [][]driver.Value
	err  error
}

type storageState struct {
	mu sync.Mutex

	queries []storageQueuedQuery
}

type storageDriver struct{ state *storageState }
type storageConn struct{ state *storageState }
type storageRows struct {
	cols []string
	rows [][]driver.Value
	idx  int
}

var storageDriverRegisterMu sync.Mutex

func (d *storageDriver) Open(string) (driver.Conn, error) {
	return &storageConn{state: d.state}, nil
}

func (c *storageConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("prepare not supported in storage resolver test driver")
}

func (c *storageConn) Close() error              { return nil }
func (c *storageConn) Begin() (driver.Tx, error) { return nil, errors.New("transactions not used") }

func (c *storageConn) QueryContext(_ context.Context, _ string, _ []driver.NamedValue) (driver.Rows, error) {
	c.state.mu.Lock()
	defer c.state.mu.Unlock()

	if len(c.state.queries) == 0 {
		return nil, errors.New("unexpected query")
	}

	next := c.state.queries[0]
	c.state.queries = c.state.queries[1:]
	if next.err != nil {
		return nil, next.err
	}

	rows := make([][]driver.Value, len(next.rows))
	for i, row := range next.rows {
		rows[i] = append([]driver.Value(nil), row...)
	}

	return &storageRows{
		cols: append([]string(nil), next.cols...),
		rows: rows,
	}, nil
}

func (r *storageRows) Columns() []string { return append([]string(nil), r.cols...) }
func (r *storageRows) Close() error      { return nil }

func (r *storageRows) Next(dest []driver.Value) error {
	if r.idx >= len(r.rows) {
		return io.EOF
	}
	copy(dest, r.rows[r.idx])
	r.idx++
	return nil
}

func openStorageResolverDB(t *testing.T, queries []storageQueuedQuery) *sql.DB {
	t.Helper()
	storageDriverRegisterMu.Lock()
	defer storageDriverRegisterMu.Unlock()

	state := &storageState{
		queries: append([]storageQueuedQuery(nil), queries...),
	}
	driverName := fmt.Sprintf("asset_storage_resolver_%d", time.Now().UnixNano())
	sql.Register(driverName, &storageDriver{state: state})

	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	t.Cleanup(func() {
		_ = db.Close()
	})

	return db
}

func TestResolveSharedAssetParentStorageContextUsesParentUIDAndRowID(t *testing.T) {
	sharedSpecs, err := json.Marshal(BuildTargetInsertSpecs(BuildImageFileUploadConfig("services", 10, []string{"png"})))
	if err != nil {
		t.Fatalf("json.Marshal(sharedSpecs): %v", err)
	}

	db := openStorageResolverDB(t, []storageQueuedQuery{
		{
			cols: []string{"parent_table", "source_column_name", "target_insert_specs"},
			rows: [][]driver.Value{{"services", "services_id", sharedSpecs}},
		},
		{
			cols: []string{"table_uid"},
			rows: [][]driver.Value{{"104"}},
		},
	})

	context, err := ResolveSharedAssetParentStorageContext(
		db,
		"services_media_bucket",
		"services_id",
		int64(55),
	)
	if err != nil {
		t.Fatalf("ResolveSharedAssetParentStorageContext returned error: %v", err)
	}

	if context.ParentTable != "services" {
		t.Fatalf("ParentTable = %q, want services", context.ParentTable)
	}
	if context.ParentTableUID != "104" {
		t.Fatalf("ParentTableUID = %q, want 104", context.ParentTableUID)
	}
	if context.ParentRowID != 55 {
		t.Fatalf("ParentRowID = %d, want 55", context.ParentRowID)
	}
}

func TestCollectSharedAssetFileMovesUsesParentStorageCoordinates(t *testing.T) {
	sharedSpecs, err := json.Marshal(BuildTargetInsertSpecs(BuildImageFileUploadConfig("services", 10, []string{"png"})))
	if err != nil {
		t.Fatalf("json.Marshal(sharedSpecs): %v", err)
	}

	db := openStorageResolverDB(t, []storageQueuedQuery{
		{
			cols: []string{"parent_table", "source_column_name", "target_insert_specs"},
			rows: [][]driver.Value{{"services", "services_id", sharedSpecs}},
		},
		{
			cols: []string{"table_uid"},
			rows: [][]driver.Value{{"104"}},
		},
		{
			cols: []string{"services_id", "filename"},
			rows: [][]driver.Value{
				{int64(41), "104_41_9.png"},
				{int64(41), "104_41_10.pdf"},
			},
		},
	})

	moves, err := CollectSharedAssetFileMoves(db, "services_media_bucket", []int64{9, 10})
	if err != nil {
		t.Fatalf("CollectSharedAssetFileMoves returned error: %v", err)
	}

	if len(moves) != 2 {
		t.Fatalf("len(moves) = %d, want 2", len(moves))
	}
	if moves[0].StorageTableUID != "104" || moves[0].StorageRowID != 41 || moves[0].Filename != "104_41_9.png" {
		t.Fatalf("moves[0] = %#v, want storage uid 104 row 41 file 104_41_9.png", moves[0])
	}
	if moves[1].Filename != "104_41_10.pdf" {
		t.Fatalf("moves[1].Filename = %q, want 104_41_10.pdf", moves[1].Filename)
	}
}

func TestCollectSharedAssetFileMovesUsesFilenameEncodedLegacyStorageCoordinates(t *testing.T) {
	sharedSpecs, err := json.Marshal(BuildTargetInsertSpecs(BuildImageFileUploadConfig("tasks", 10, []string{"png"})))
	if err != nil {
		t.Fatalf("json.Marshal(sharedSpecs): %v", err)
	}

	db := openStorageResolverDB(t, []storageQueuedQuery{
		{
			cols: []string{"parent_table", "source_column_name", "target_insert_specs"},
			rows: [][]driver.Value{{"tasks", "tasks_id", sharedSpecs}},
		},
		{
			cols: []string{"table_uid"},
			rows: [][]driver.Value{{"346"}},
		},
		{
			cols: []string{"tasks_id", "filename"},
			rows: [][]driver.Value{
				{int64(7), "612_7_7.png"},
			},
		},
	})

	moves, err := CollectSharedAssetFileMoves(db, "tasks_assets", []int64{7})
	if err != nil {
		t.Fatalf("CollectSharedAssetFileMoves returned error: %v", err)
	}

	if len(moves) != 1 {
		t.Fatalf("len(moves) = %d, want 1", len(moves))
	}
	if moves[0].StorageTableUID != "612" || moves[0].StorageRowID != 7 || moves[0].Filename != "612_7_7.png" {
		t.Fatalf("moves[0] = %#v, want filename-derived legacy storage coordinates", moves[0])
	}
}

func TestResolveSharedAssetParentStorageContextSkipsLegacyImageRelations(t *testing.T) {
	legacySpecs, err := json.Marshal(map[string]interface{}{
		"file_upload": map[string]interface{}{
			"enabled":          true,
			"profile_key":      AssetProfileImage,
			"asset_kinds":      []string{"image"},
			"target_directory": "media",
		},
	})
	if err != nil {
		t.Fatalf("json.Marshal(legacySpecs): %v", err)
	}

	db := openStorageResolverDB(t, []storageQueuedQuery{
		{
			cols: []string{"parent_table", "source_column_name", "target_insert_specs"},
			rows: [][]driver.Value{{"services", "services_id", legacySpecs}},
		},
	})

	context, err := ResolveSharedAssetParentStorageContext(db, "services_gallery", "services_id", int64(55))
	if err != nil {
		t.Fatalf("ResolveSharedAssetParentStorageContext returned error: %v", err)
	}
	if context != (SharedAssetParentStorageContext{}) {
		t.Fatalf("context = %#v, want empty context for legacy relation", context)
	}
}
