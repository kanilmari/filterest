// consistency_grant_boundary_test.go
// Proves consistency fixes lock first, reconcile, and roll back as one batch.
// Reuses the grant catalogue fixture and the existing SQL driver's connection.
// Tests both a later bad repair and an effective-grant postcheck failure.
package system_table_tools

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/runtime_grants/granttest"
)

type consistencyBoundaryState struct {
	t                                                      *testing.T
	locked, failPostcheck                                  bool
	pending, committed, rolledBack, snapshots, comparisons int
}
type consistencyBoundaryDriver struct{ state *consistencyBoundaryState }
type consistencyBoundaryConn struct {
	orphanQueueConn
	state *consistencyBoundaryState
}
type consistencyBoundaryTx struct{ state *consistencyBoundaryState }

var consistencyBoundaryCounter int64

func (d consistencyBoundaryDriver) Open(string) (driver.Conn, error) {
	return &consistencyBoundaryConn{state: d.state}, nil
}
func (c *consistencyBoundaryConn) Begin() (driver.Tx, error) {
	return consistencyBoundaryTx{c.state}, nil
}
func (c *consistencyBoundaryConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if !c.state.locked {
		c.state.t.Fatal("catalogue read preceded policy lock")
	}
	if strings.Contains(query, "SELECT to_regclass('public.system_db_tables')") {
		c.state.snapshots++
	}
	if strings.Contains(query, "FROM actual WHERE wanted IS DISTINCT FROM present") {
		c.state.comparisons++
		if c.state.failPostcheck && c.state.comparisons == 3 {
			return nil, errors.New("effective privilege check failed")
		}
	}
	if rows, ok := granttest.BoundaryQuery(query, args); ok {
		return rows, nil
	}
	return nil, fmt.Errorf("unexpected repair query: %s", query)
}
func (c *consistencyBoundaryConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	if granttest.IsPolicyLock(query) {
		if strings.Contains(query, "pg_advisory_xact_lock") {
			c.state.locked = true
		}
		return driver.RowsAffected(0), nil
	}
	if !c.state.locked {
		c.state.t.Fatal("repair write preceded policy lock")
	}
	if !strings.HasPrefix(query, "DELETE FROM system_foreign_key_relations_1_m") {
		return nil, fmt.Errorf("unexpected repair exec: %s", query)
	}
	c.state.pending++
	return driver.RowsAffected(1), nil
}
func (tx consistencyBoundaryTx) Commit() error {
	tx.state.committed = tx.state.pending
	tx.state.pending = 0
	return nil
}
func (tx consistencyBoundaryTx) Rollback() error {
	tx.state.rolledBack++
	tx.state.pending = 0
	return nil
}

func TestConsistencyRepairGrantBoundaryIsAtomic(t *testing.T) {
	for _, test := range []struct {
		name, body string
		fail       bool
		status     int
	}{
		{"success", `{"fix_ids":["cat5_1m_1"]}`, false, 200},
		{"later invalid repair", `{"fix_ids":["cat5_1m_1","unsupported"]}`, false, 500},
		{"postcheck fails", `{"fix_ids":["cat5_1m_1"]}`, true, 500},
	} {
		t.Run(test.name, func(t *testing.T) {
			granttest.ConfigureRoles(t)
			state := &consistencyBoundaryState{t: t, failPostcheck: test.fail}
			name := fmt.Sprintf("consistency_boundary_%d", atomic.AddInt64(&consistencyBoundaryCounter, 1))
			sql.Register(name, consistencyBoundaryDriver{state})
			db, err := sql.Open(name, "")
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			lazy := dbutils.NewLazyTx(db)
			req := httptest.NewRequest("POST", "/api/fix-database-consistency", strings.NewReader(test.body))
			req = req.WithContext(dbutils.SetLazyTx(req.Context(), lazy))
			rec := httptest.NewRecorder()
			FixDatabaseConsistencyHandler(granttest.Recorder{ResponseRecorder: rec}, req)
			if rec.Code != test.status {
				t.Fatal(rec.Code, rec.Body)
			}
			if rec.Code == 200 {
				if err := lazy.Commit(); err != nil {
					t.Fatal(err)
				}
			} else {
				_ = lazy.Rollback()
			}
			if test.status == 200 {
				if state.committed != 1 || state.snapshots != 3 || state.comparisons != 3 {
					t.Fatal("repair skipped completion", state)
				}
			} else {
				if state.committed != 0 || state.pending != 0 || state.rolledBack == 0 {
					t.Fatal("partial repair committed", state)
				}
			}
		})
	}
}
