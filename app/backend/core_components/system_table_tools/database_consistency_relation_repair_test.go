// database_consistency_relation_repair_test.go
// Checks category-5 predicates and stale repair IDs for both relation types.
// Reuses the consistency SQL queue and grant-boundary driver fixtures.
// A no-op repair must keep the transaction usable and report no fixed rows.
package system_table_tools

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/runtime_grants/granttest"
)

func TestRelationRepairRechecksMissingTables(t *testing.T) {
	for _, kind := range []struct {
		id, table string
		columns   []string
	}{
		{"cat5_1m_39", "system_foreign_key_relations_1_m", []string{"source_table_uid", "target_table_uid"}},
		{"cat5_mm_39", "system_foreign_key_relations_m_m", []string{"table_a_uid", "table_b_uid", "bridging_table_uid"}},
	} {
		for _, count := range []int64{0, 1} {
			t.Run(fmt.Sprintf("%s/affected=%d", kind.id, count), func(t *testing.T) {
				resetOrphanQueues()
				defer resetOrphanQueues()
				db := newSystemTableToolsTestDB(t)
				defer db.Close()
				pushOrphanExec(orphanQueuedExec{rowsAffected: count})
				err := fixIssue(db, kind.id, nil)
				if count == 0 && !errors.Is(err, errConsistencyFixSkipped) || count == 1 && err != nil {
					t.Fatal("incorrect repair result", err)
				}
				calls := snapshotOrphanCalls()
				if len(calls) != 1 || !strings.Contains(calls[0], "DELETE FROM "+kind.table+" fk WHERE id = $1::bigint AND (") {
					t.Fatal("unguarded relation delete", calls)
				}
				for _, column := range kind.columns {
					if !strings.Contains(calls[0], "NOT EXISTS (SELECT 1 FROM system_db_tables WHERE table_uid = fk."+column+")") {
						t.Fatal("missing listing predicate", column, calls)
					}
				}
			})
		}
	}
}

type skippedRepairDriver struct{ state *consistencyBoundaryState }
type skippedRepairConn struct{ consistencyBoundaryConn }

func (d skippedRepairDriver) Open(string) (driver.Conn, error) {
	return &skippedRepairConn{consistencyBoundaryConn{state: d.state}}, nil
}
func (c *skippedRepairConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	if granttest.IsPolicyLock(query) {
		return c.consistencyBoundaryConn.ExecContext(ctx, query, args)
	}
	if !c.state.locked || !strings.HasPrefix(query, "DELETE FROM system_foreign_key_relations_1_m") {
		return nil, fmt.Errorf("unexpected skipped repair: %s", query)
	}
	return driver.RowsAffected(0), nil
}

func TestConsistencyRepairDoesNotCountSkippedRelation(t *testing.T) {
	granttest.ConfigureRoles(t)
	state := &consistencyBoundaryState{t: t}
	name := fmt.Sprintf("skipped_repair_%d", atomic.AddInt64(&consistencyBoundaryCounter, 1))
	sql.Register(name, skippedRepairDriver{state})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	lazy := dbutils.NewLazyTx(db)
	req := httptest.NewRequest("POST", "/api/fix-database-consistency", strings.NewReader(`{"fix_ids":["cat5_1m_39"]}`))
	req = req.WithContext(dbutils.SetLazyTx(req.Context(), lazy))
	rec := httptest.NewRecorder()
	FixDatabaseConsistencyHandler(granttest.Recorder{ResponseRecorder: rec}, req)
	var response struct {
		Fixed  int
		Errors []string
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil || rec.Code != 200 || response.Fixed != 0 || len(response.Errors) != 0 {
		t.Fatal("skipped repair reported as fixed or failed", rec.Code, rec.Body, err)
	}
	if err := lazy.Commit(); err != nil || state.snapshots != 3 || state.comparisons != 3 {
		t.Fatal("skipped repair poisoned transaction", err, state)
	}
}
