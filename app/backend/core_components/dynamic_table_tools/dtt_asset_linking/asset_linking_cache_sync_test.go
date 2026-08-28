// asset_linking_cache_sync_test.go
// Unit tests for shared asset parent cache resync helpers.
// Bridges a database/sql driver double and the shared asset cache-sync workflow.
// Exists to lock cached_image recomputation behavior for shared `<parent>_assets` changes.
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

type cacheSyncQueuedQuery struct {
	cols []string
	rows [][]driver.Value
	err  error
}

type cacheSyncQueuedExec struct {
	err  error
	rows int64
}

type cacheSyncState struct {
	mu sync.Mutex

	queries []cacheSyncQueuedQuery
	execs   []cacheSyncQueuedExec

	execCalls []string
	execArgs  [][]driver.NamedValue
}

type cacheSyncDriver struct{ state *cacheSyncState }
type cacheSyncConn struct{ state *cacheSyncState }
type cacheSyncRows struct {
	cols []string
	rows [][]driver.Value
	idx  int
}

var cacheSyncDriverRegisterMu sync.Mutex

func (d *cacheSyncDriver) Open(string) (driver.Conn, error) {
	return &cacheSyncConn{state: d.state}, nil
}

func (c *cacheSyncConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("prepare not supported in cache sync test driver")
}

func (c *cacheSyncConn) Close() error              { return nil }
func (c *cacheSyncConn) Begin() (driver.Tx, error) { return nil, errors.New("transactions not used") }

func (c *cacheSyncConn) QueryContext(_ context.Context, _ string, _ []driver.NamedValue) (driver.Rows, error) {
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

	return &cacheSyncRows{
		cols: append([]string(nil), next.cols...),
		rows: rows,
	}, nil
}

func (c *cacheSyncConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	c.state.mu.Lock()
	defer c.state.mu.Unlock()

	c.state.execCalls = append(c.state.execCalls, query)
	clonedArgs := make([]driver.NamedValue, len(args))
	copy(clonedArgs, args)
	c.state.execArgs = append(c.state.execArgs, clonedArgs)

	if len(c.state.execs) == 0 {
		return nil, errors.New("unexpected exec")
	}

	next := c.state.execs[0]
	c.state.execs = c.state.execs[1:]
	if next.err != nil {
		return nil, next.err
	}

	if next.rows == 0 {
		return driver.RowsAffected(1), nil
	}
	return driver.RowsAffected(next.rows), nil
}

func (r *cacheSyncRows) Columns() []string { return append([]string(nil), r.cols...) }
func (r *cacheSyncRows) Close() error      { return nil }

func (r *cacheSyncRows) Next(dest []driver.Value) error {
	if r.idx >= len(r.rows) {
		return io.EOF
	}
	copy(dest, r.rows[r.idx])
	r.idx++
	return nil
}

func openCacheSyncDB(t *testing.T, queries []cacheSyncQueuedQuery, execs []cacheSyncQueuedExec) (*sql.DB, *cacheSyncState) {
	t.Helper()
	cacheSyncDriverRegisterMu.Lock()
	defer cacheSyncDriverRegisterMu.Unlock()

	state := &cacheSyncState{
		queries: append([]cacheSyncQueuedQuery(nil), queries...),
		execs:   append([]cacheSyncQueuedExec(nil), execs...),
	}
	driverName := fmt.Sprintf("asset_cache_sync_%d", time.Now().UnixNano())
	sql.Register(driverName, &cacheSyncDriver{state: state})

	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	t.Cleanup(func() {
		_ = db.Close()
	})

	return db, state
}

func TestCollectSharedAssetParentCacheSyncPlanResolvesParentRows(t *testing.T) {
	sharedSpecs, err := json.Marshal(BuildTargetInsertSpecs(BuildImageFileUploadConfig("services", 10, []string{"png"})))
	if err != nil {
		t.Fatalf("json.Marshal(sharedSpecs): %v", err)
	}

	db, _ := openCacheSyncDB(t,
		[]cacheSyncQueuedQuery{
			{
				cols: []string{"parent_table", "source_column_name", "target_insert_specs"},
				rows: [][]driver.Value{{"services", "services_id", sharedSpecs}},
			},
			{
				cols: []string{"services_id"},
				rows: [][]driver.Value{{int64(41)}, {int64(42)}, {int64(41)}},
			},
		},
		nil,
	)

	plan, err := CollectSharedAssetParentCacheSyncPlan(db, "services_media_bucket", []int64{11, 12, 13})
	if err != nil {
		t.Fatalf("CollectSharedAssetParentCacheSyncPlan returned error: %v", err)
	}

	if plan.ParentTable != "services" {
		t.Fatalf("ParentTable = %q, want services", plan.ParentTable)
	}
	if plan.ForeignKeyColumn != "services_id" {
		t.Fatalf("ForeignKeyColumn = %q, want services_id", plan.ForeignKeyColumn)
	}
	if len(plan.ParentRowIDs) != 2 || plan.ParentRowIDs[0] != 41 || plan.ParentRowIDs[1] != 42 {
		t.Fatalf("ParentRowIDs = %#v, want [41 42]", plan.ParentRowIDs)
	}
}

func TestCollectSharedAssetParentCacheSyncPlanSkipsLegacyImageRelations(t *testing.T) {
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

	db, _ := openCacheSyncDB(t,
		[]cacheSyncQueuedQuery{
			{
				cols: []string{"parent_table", "source_column_name", "target_insert_specs"},
				rows: [][]driver.Value{{"services", "services_id", legacySpecs}},
			},
		},
		nil,
	)

	plan, err := CollectSharedAssetParentCacheSyncPlan(db, "services_gallery", []int64{11, 12})
	if err != nil {
		t.Fatalf("CollectSharedAssetParentCacheSyncPlan returned error: %v", err)
	}
	if plan.ParentTable != "" || plan.ChildTable != "" || plan.ForeignKeyColumn != "" || len(plan.ParentRowIDs) != 0 {
		t.Fatalf("plan = %#v, want empty plan for legacy relation", plan)
	}
}

func TestResyncSharedAssetParentCacheUpdatesAndClearsCachedImage(t *testing.T) {
	db, state := openCacheSyncDB(t,
		[]cacheSyncQueuedQuery{
			{
				cols: []string{"exists"},
				rows: [][]driver.Value{{true}},
			},
			{
				cols: []string{"services_id", "filename"},
				rows: [][]driver.Value{{int64(41), "hero.png"}},
			},
		},
		[]cacheSyncQueuedExec{{}, {}},
	)

	err := ResyncSharedAssetParentCache(db, SharedAssetCacheSyncPlan{
		ParentTable:      "services",
		ChildTable:       "services_assets",
		ForeignKeyColumn: "services_id",
		ParentRowIDs:     []int64{41, 42},
	})
	if err != nil {
		t.Fatalf("ResyncSharedAssetParentCache returned error: %v", err)
	}

	if len(state.execCalls) != 2 {
		t.Fatalf("exec calls = %d, want 2", len(state.execCalls))
	}

	if got := state.execArgs[0][0].Value; got != "hero.png" {
		t.Fatalf("first cached_image value = %#v, want hero.png", got)
	}
	if got := state.execArgs[0][1].Value; got != int64(41) {
		t.Fatalf("first parent id = %#v, want 41", got)
	}

	if got := state.execArgs[1][0].Value; got != nil {
		t.Fatalf("second cached_image value = %#v, want nil", got)
	}
	if got := state.execArgs[1][1].Value; got != int64(42) {
		t.Fatalf("second parent id = %#v, want 42", got)
	}
}
