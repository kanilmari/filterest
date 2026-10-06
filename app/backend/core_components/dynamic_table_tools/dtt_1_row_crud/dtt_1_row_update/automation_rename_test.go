// automation_rename_test.go
// Proves registry-name edits invoke automation maintenance inside the request transaction.
// Reuses row-validation queues with real middleware and a failing metadata write.
// A failed automation rename must roll back the physical rename before registry success.
package dtt_1_row_update

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/middlewares"
	"easelect/backend/core_components/runtime_grants/granttest"
)

type automationRenameState struct {
	row                                                   updRowState
	physical, automation, registry, committed, rolledBack bool
}
type automationRenameDriver struct{ state *automationRenameState }
type automationRenameConn struct {
	updRowConn
	automation *automationRenameState
}
type automationRenameTx struct{ state *automationRenameState }

var automationRenameCounter atomic.Int64

func (d automationRenameDriver) Open(string) (driver.Conn, error) {
	return &automationRenameConn{updRowConn{state: &d.state.row}, d.state}, nil
}
func (c *automationRenameConn) Begin() (driver.Tx, error) {
	return automationRenameTx{c.automation}, nil
}
func (c *automationRenameConn) BeginTx(context.Context, driver.TxOptions) (driver.Tx, error) {
	return c.Begin()
}
func (tx automationRenameTx) Commit() error   { tx.state.committed = true; return nil }
func (tx automationRenameTx) Rollback() error { tx.state.rolledBack = true; return nil }
func (c *automationRenameConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if strings.Contains(query, "SELECT username FROM system_users") || strings.Contains(query, "SELECT id FROM system_functions WHERE url_route_endpoint") {
		return &updRowRows{cols: []string{"value"}}, nil
	}
	if query == "SELECT to_regclass('public.system_triggers') IS NOT NULL" {
		return &updRowRows{cols: []string{"present"}, rows: [][]driver.Value{{true}}}, nil
	}
	return c.updRowConn.QueryContext(ctx, query, args)
}
func (c *automationRenameConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	switch {
	case granttest.IsPolicyLock(query), strings.Contains(query, "set_config('app.user_id'"):
		return driver.RowsAffected(0), nil
	case strings.HasPrefix(query, "INSERT INTO system_transaction_log"):
		return driver.RowsAffected(1), nil
	case strings.HasPrefix(query, "ALTER TABLE"):
		c.automation.physical = true
		return driver.RowsAffected(1), nil
	case strings.HasPrefix(query, "UPDATE public.system_triggers"):
		if !c.automation.physical || len(args) != 2 || args[0].Value != "automation_before" || args[1].Value != "automation_after" {
			return nil, errors.New("incorrect automation rename boundary")
		}
		c.automation.automation = true
		return nil, errors.New("automation write failed")
	case strings.HasPrefix(query, `UPDATE "system_db_tables"`):
		c.automation.registry = true
	}
	return nil, fmt.Errorf("unexpected rename exec: %s", query)
}

func TestGenericRenameRollsBackOnAutomationMetadataFailure(t *testing.T) {
	granttest.ConfigureRoles(t)
	state := &automationRenameState{row: updRowState{queries: []queuedQuery{
		{cols: []string{"table_uid"}, rows: [][]driver.Value{{int64(99)}}},
		{cols: []string{"id"}, rows: [][]driver.Value{{int64(5)}}},
		{cols: []string{"table_uid"}, rows: [][]driver.Value{{int64(99)}}},
		{cols: []string{"editable_in_ui"}, rows: [][]driver.Value{{true}}},
		{cols: []string{"data_type"}, rows: [][]driver.Value{{"text"}}},
		{cols: []string{"table_name"}, rows: [][]driver.Value{{"automation_before"}}},
		{cols: []string{"table_uid", "table_name"}},
		{cols: []string{"id", "table_name"}},
	}}}
	name := fmt.Sprintf("generic_automation_rename_%d", automationRenameCounter.Add(1))
	sql.Register(name, automationRenameDriver{state})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	oldDB, oldAdmin := backend.Db, backend.DbAdmin
	backend.Db, backend.DbAdmin = db, db
	defer func() { backend.Db, backend.DbAdmin = oldDB, oldAdmin }()
	req := buildUpdateRowSessionRequest(t, http.MethodPost, "/api/update-row?dataset=system_db_tables", `{"id":5,"column":"table_name","value":"automation_after"}`)
	req = req.WithContext(dbutils.SetRequestActorContext(req.Context(), dbutils.NewRequestActorContext(2, "admin")))
	rec := httptest.NewRecorder()
	middlewares.WithLazyTransaction(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { UpdateRowHandler(w, r, "system_db_tables") })).ServeHTTP(rec, req)
	if rec.Code != 500 || !state.physical || !state.automation || state.registry || state.committed || !state.rolledBack {
		t.Fatal("automation failure did not roll back rename", rec.Code, rec.Body, state)
	}
}
