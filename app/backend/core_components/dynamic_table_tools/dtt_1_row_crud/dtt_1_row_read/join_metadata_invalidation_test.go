// join_metadata_invalidation_test.go
// Proves target metadata saves invalidate referencing datasets immediately.
// Connects after-commit invalidation to warm joins and blocked metadata lookups.
// Prevents a pre-save lookup from restoring title eligibility for later readers.
package dtt_1_row_read

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/runtime_grant_mutations"
	"easelect/backend/core_components/runtime_grants/granttest"
)

// Seed helpers deliberately bypass database loading, but use the current epoch.
func setCachedJoinMetadata(tableName string, entry joinMetadataCacheEntry) {
	setCachedJoinMetadataAtGeneration(tableName, entry, joinMetadataGeneration())
}

func resetJoinMetadataCacheForTests() { invalidateJoinMetadataCache() }

type titleSaveDriver struct {
	mu        sync.Mutex
	counter   *buildJoinsQueryCounter
	target    recordTitleTargetMetadata
	commitErr bool
	started   chan struct{}
	release   chan struct{}
}
type titleSaveConn struct {
	*buildJoinsMockConn
	state  *titleSaveDriver
	staged *recordTitleTargetMetadata
}
type titleSaveTx struct{ conn *titleSaveConn }

func (s *titleSaveDriver) Open(string) (driver.Conn, error) {
	return &titleSaveConn{buildJoinsMockConn: &buildJoinsMockConn{counter: s.counter, foreignKeyMode: true}, state: s}, nil
}
func (c *titleSaveConn) Begin() (driver.Tx, error) { return &titleSaveTx{c}, nil }
func (tx *titleSaveTx) Commit() error {
	s := tx.conn.state
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.commitErr {
		return fmt.Errorf("commit refused")
	}
	if tx.conn.staged != nil {
		s.target = *tx.conn.staged
	}
	return nil
}
func (*titleSaveTx) Rollback() error { return nil }
func (c *titleSaveConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	if strings.Contains(query, "UPDATE system_column_details SET hide_everywhere") {
		c.state.mu.Lock()
		target := c.state.target
		c.state.mu.Unlock()
		target.HideEverywhere = args[0].Value.(bool)
		target.ClientDeliveryMode = args[1].Value.(string)
		target.IsMultilingual = args[2].Value.(bool)
		c.staged = &target
	}
	return driver.RowsAffected(1), nil // Grant-boundary lock/reconciliation writes.
}
func (c *titleSaveConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if rows, ok := granttest.BoundaryQuery(query, args); ok {
		return rows, nil
	}
	if !strings.Contains(query, "AS title_sources(source_column, target_table, target_column)") {
		return c.buildJoinsMockConn.QueryContext(ctx, query, args)
	}
	c.state.counter.add("title_targets")
	c.state.mu.Lock()
	target, started, release := c.state.target, c.state.started, c.state.release
	c.state.started, c.state.release = nil, nil
	c.state.mu.Unlock()
	if started != nil {
		close(started)
		select {
		case <-release:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	return &buildJoinsMockRows{
		cols: []string{"source_column", "data_type", "is_multilingual", "hide_everywhere", "client_delivery_mode"},
		rows: [][]driver.Value{{"table_uid", target.DataType, target.IsMultilingual, target.HideEverywhere, target.ClientDeliveryMode}},
	}, nil
}

func titleSaveFixture(t *testing.T) (*sql.DB, *titleSaveDriver) {
	t.Helper()
	granttest.ConfigureRoles(t)
	resetJoinMetadataCacheForTests()
	s := &titleSaveDriver{counter: &buildJoinsQueryCounter{counts: map[string]int{}},
		target: recordTitleTargetMetadata{DataType: "jsonb", IsMultilingual: true, ClientDeliveryMode: "include"}}
	driverName := fmt.Sprintf("title_save_%d", time.Now().UnixNano())
	sql.Register(driverName, s)
	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatal(err)
	}
	previous := backend.Db
	backend.Db = db
	t.Cleanup(func() { backend.Db = previous; resetJoinMetadataCacheForTests(); db.Close() })
	return db, s
}

func assertTitleTarget(t *testing.T, db *sql.DB, want recordTitleTargetMetadata, wantReads int, s *titleSaveDriver) {
	t.Helper()
	// Query construction and response annotation deliberately read the SOURCE;
	// the changed TARGET is system_db_tables, never the source cache key.
	if _, err := loadJoinMetadata(db, "system_column_details"); err != nil {
		t.Fatal(err)
	}
	types := recordTitleAliasSources("system_column_details", map[string]interface{}{"table_uid": map[string]interface{}{}})
	facts, ok := types["table_uid"].(map[string]interface{})["foreign_display_metadata"].(map[string]interface{})
	if !ok || facts["data_type"] != want.DataType || facts["hide_everywhere"] != want.HideEverywhere ||
		facts["client_delivery_mode"] != want.ClientDeliveryMode || facts["is_multilingual"] != want.IsMultilingual {
		t.Fatalf("title target proof=%v want=%+v", facts, want)
	}
	if got := s.counter.get("title_targets"); got != wantReads {
		t.Fatalf("target lookups=%d want=%d", got, wantReads)
	}
}

func TestRelationTitleTargetSaveInvalidatesOnlyAfterCommit(t *testing.T) {
	for _, path := range []string{"schema save", "generic metadata save"} {
		for _, change := range []string{"hidden", "server only", "multilingual removed"} {
			for _, end := range []string{"commit", "rollback", "failed commit"} {
				t.Run(path+"/"+change+"/"+end, func(t *testing.T) {
					db, s := titleSaveFixture(t)
					before := s.target
					after := before
					switch change {
					case "hidden":
						after.HideEverywhere = true
					case "server only":
						after.ClientDeliveryMode = "server_only"
					case "multilingual removed":
						after.IsMultilingual = false
					}
					assertTitleTarget(t, db, before, 1, s)
					lazy := dbutils.NewLazyTx(db)
					defer lazy.Rollback()
					ctx := dbutils.SetLazyTx(context.Background(), lazy)
					tx, err := dbutils.RequireTxWithError(ctx)
					if err != nil {
						t.Fatal(err)
					}
					var mutation *runtime_grant_mutations.Mutation
					if path == "generic metadata save" {
						mutation, err = runtime_grant_mutations.BeginTx(ctx, tx)
						if err != nil {
							t.Fatal(err)
						}
					}
					if _, err := tx.Exec(`UPDATE system_column_details SET hide_everywhere=$1, client_delivery_mode=$2, is_multilingual=$3 WHERE column_uid=$4`,
						after.HideEverywhere, after.ClientDeliveryMode, after.IsMultilingual, 1); err != nil {
						t.Fatal(err)
					}
					if mutation != nil {
						if err := mutation.Finish(ctx); err != nil {
							t.Fatal(err)
						}
					} else {
						dbutils.RegisterAfterCommitHook(ctx, func() { InvalidateSchemaCache("system_db_tables") })
					}
					assertTitleTarget(t, db, before, 1, s)
					if end == "rollback" {
						if err := lazy.Rollback(); err != nil {
							t.Fatal(err)
						}
					} else {
						s.commitErr = end == "failed commit"
						if err := lazy.Commit(); (err != nil) != s.commitErr {
							t.Fatal(err)
						}
					}
					if end == "commit" {
						assertTitleTarget(t, db, after, 2, s)
					} else {
						assertTitleTarget(t, db, before, 1, s)
					}
				})
			}
		}
	}
}

func TestRelationTitleInvalidationRejectsInflightLookup(t *testing.T) {
	for _, refill := range []bool{false, true} {
		t.Run(fmt.Sprintf("new_reader_first=%v", refill), func(t *testing.T) {
			db, s := titleSaveFixture(t)
			started, release := make(chan struct{}), make(chan struct{})
			s.started, s.release = started, release
			done := make(chan struct{})
			var lookupErr error
			go func() {
				_, lookupErr = loadJoinMetadata(db, "system_column_details")
				close(done)
			}()
			var releaseOnce sync.Once
			releaseOld := func() { releaseOnce.Do(func() { close(release) }) }
			defer func() { releaseOld(); <-done }()
			select {
			case <-started:
			case <-time.After(5 * time.Second):
				t.Fatal("old target lookup never started")
			}
			s.mu.Lock()
			s.target.HideEverywhere = true
			after := s.target
			s.mu.Unlock()
			InvalidateSchemaCache("system_db_tables")
			if refill {
				assertTitleTarget(t, db, after, 2, s)
			}
			releaseOld()
			<-done
			if lookupErr != nil {
				t.Fatal(lookupErr)
			}
			if cached, found := getCachedJoinMetadata("system_column_details"); found && (!refill || !cached.titleTargets["table_uid"].HideEverywhere) {
				t.Fatal("old lookup repopulated or replaced current metadata", cached.titleTargets)
			}
			assertTitleTarget(t, db, after, 2, s)
		})
	}
}
