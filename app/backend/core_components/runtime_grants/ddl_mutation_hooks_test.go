// ddl_mutation_hooks_test.go
// Checks dedicated schema/dependency handlers complete the grant boundary.
// Reuses the empty policy catalogue and actual lazy request transaction.
// PostgreSQL companions prove real ACL deltas; these checks prove atomic refusals.
package runtime_grants_test

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	drop "easelect/backend/core_components/dynamic_table_tools/dtt_3_table_crud/dtt_3_table_delete"
	workflows "easelect/backend/core_components/dynamic_table_tools/dtt_crud_workflows"
	fk "easelect/backend/core_components/dynamic_table_tools/dtt_foreign_keys"
	triggers "easelect/backend/core_components/dynamic_table_tools/dtt_triggers"
	"easelect/backend/core_components/runtime_grants/granttest"
)

type ddlBoundaryState struct {
	t                                           *testing.T
	locked, fail                                bool
	pending, committed, rolledBack, comparisons int
}
type ddlBoundaryDriver struct{ state *ddlBoundaryState }
type ddlBoundaryConn struct{ state *ddlBoundaryState }
type ddlBoundaryTx struct{ state *ddlBoundaryState }
type ddlBoundaryRows struct {
	columns int
	values  [][]driver.Value
}

var ddlBoundaryCounter int64

func (d ddlBoundaryDriver) Open(string) (driver.Conn, error) { return &ddlBoundaryConn{d.state}, nil }
func (c *ddlBoundaryConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepare")
}
func (c *ddlBoundaryConn) Close() error              { return nil }
func (c *ddlBoundaryConn) Begin() (driver.Tx, error) { return ddlBoundaryTx{c.state}, nil }
func (tx ddlBoundaryTx) Commit() error {
	tx.state.committed = tx.state.pending
	tx.state.pending = 0
	return nil
}
func (tx ddlBoundaryTx) Rollback() error {
	tx.state.rolledBack++
	tx.state.pending = 0
	return nil
}
func (r *ddlBoundaryRows) Columns() []string { return make([]string, r.columns) }
func (r *ddlBoundaryRows) Close() error      { return nil }
func (r *ddlBoundaryRows) Next(dest []driver.Value) error {
	if len(r.values) == 0 {
		return io.EOF
	}
	copy(dest, r.values[0])
	r.values = r.values[1:]
	return nil
}
func (c *ddlBoundaryConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if strings.HasPrefix(query, "SELECT EXISTS(SELECT 1 FROM public.system_db_tables") {
		return &ddlBoundaryRows{1, [][]driver.Value{{true}}}, nil
	}
	if strings.Contains(query, "FROM actual WHERE wanted IS DISTINCT FROM present") {
		c.state.comparisons++
		if c.state.pending == 0 {
			c.state.t.Fatal("grant comparison preceded mutation")
		}
		if c.state.fail && c.state.comparisons == 3 {
			return nil, errors.New("effective postcheck failed")
		}
	}
	if rows, ok := granttest.BoundaryQuery(query, args); ok {
		return rows, nil
	}
	rows := func(columns int, values ...[]driver.Value) driver.Rows {
		return &ddlBoundaryRows{columns, values}
	}
	switch {
	case strings.Contains(query, "SELECT EXISTS (") && strings.Contains(query, "information_schema."):
		// The existing FK add handler has read-only existence preflights.
		return rows(1, []driver.Value{true}), nil
	case strings.Contains(query, "WITH RECURSIVE"):
		return rows(1, []driver.Value{false}), nil // automation target is content
	case strings.Contains(query, "public.app_row_actor_column"):
		return rows(2), nil
	case strings.Contains(query, "COALESCE(array_agg(attribute.attname"):
		return rows(1, []driver.Value{"{ref_id}"}), nil
	case strings.Contains(query, "SELECT a.attname") && strings.Contains(query, "con.contype = 'p'"):
		return rows(1, []driver.Value{"id"}), nil
	case strings.Contains(query, "SELECT c.oid, n.nspname AS schema_name"):
		return rows(3), nil
	case strings.Contains(query, "SELECT table_name, table_uid"):
		return rows(2), nil
	case strings.Contains(query, "FROM system_table_folders"):
		return rows(1, []driver.Value{int64(4)}), nil
	case strings.Contains(query, "SELECT is_default, COALESCE(is_removable"):
		return rows(2, []driver.Value{false, true}), nil
	case strings.Contains(query, "SELECT table_uid, schema_name"):
		return rows(2), nil // raw table; registered cleanup has PostgreSQL coverage
	default:
		return nil, fmt.Errorf("unexpected DDL query: %s", query)
	}
}
func (c *ddlBoundaryConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	if granttest.IsPolicyLock(query) {
		if strings.Contains(query, "pg_advisory_xact_lock") {
			c.state.locked = true
		}
		return driver.RowsAffected(0), nil
	}
	if !c.state.locked {
		c.state.t.Fatal("mutation write preceded policy lock")
	}
	c.state.pending++
	return driver.RowsAffected(1), nil
}

func TestDedicatedDDLHandlersCompleteAndRefuseAtomically(t *testing.T) {
	for _, test := range []struct {
		name, body string
		handler    http.HandlerFunc
		status     int
	}{
		{"foreign key add", `{"referencing_dataset":"source","referencing_column":"ref_id","referenced_dataset":"target","referenced_column":"id"}`, fk.AddForeignKeyHandler, 200},
		{"foreign key delete", `{"referencing_dataset":"source","constraint_name":"fk_source_ref_id"}`, fk.DeleteForeignKeyHandler, 200},
		{"trigger creation", `{"source_dataset":"source","target_dataset":"target","condition":"true","action_values":"{\"title\":\"test\"}"}`, triggers.CreateTriggerHandler, 201},
		{"column workflow completion", `{"dataset_name":"source","prevent_deletion":false}`, workflows.ModifyColumnsHandler, 200},
		{"table drop", `{"dataset_name":"source","confirm_dataset_name":"source"}`, drop.DropTableHandler, 200},
	} {
		for _, fail := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/postcheck failure=%t", test.name, fail), func(t *testing.T) {
				granttest.ConfigureRoles(t)
				state := &ddlBoundaryState{t: t, fail: fail}
				name := fmt.Sprintf("ddl_boundary_%d", atomic.AddInt64(&ddlBoundaryCounter, 1))
				sql.Register(name, ddlBoundaryDriver{state})
				db, err := sql.Open(name, "")
				if err != nil {
					t.Fatal(err)
				}
				defer db.Close()
				old := backend.Db
				backend.Db = db
				defer func() { backend.Db = old }()
				lazy := dbutils.NewLazyTx(db)
				req := httptest.NewRequest("POST", "/api/ddl-boundary", strings.NewReader(test.body))
				req = req.WithContext(dbutils.SetLazyTx(req.Context(), lazy))
				rec := httptest.NewRecorder()
				test.handler(granttest.Recorder{ResponseRecorder: rec}, req)
				want := test.status
				if fail {
					want = 500
				}
				if rec.Code != want || state.comparisons != 3 {
					t.Fatal(rec.Code, rec.Body, state)
				}
				if fail {
					if state.pending != 0 || state.committed != 0 || state.rolledBack == 0 {
						t.Fatal("failed policy left writes pending", state)
					}
				} else {
					if err := lazy.Commit(); err != nil {
						t.Fatal(err)
					}
					if state.committed == 0 {
						t.Fatal("successful mutation did not commit", state)
					}
				}
			})
		}
	}
}
