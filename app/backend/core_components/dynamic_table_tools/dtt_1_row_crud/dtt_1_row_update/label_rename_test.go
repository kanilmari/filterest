// label_rename_test.go
// Proves a registry-name cell edit moves the dataset's label inside the request transaction.
// Reuses row-validation queues with real middleware and a failing language-key read.
// A label that cannot move must roll the physical and automation rename back (#937).
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
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/middlewares"
	"easelect/backend/core_components/runtime_grants/granttest"
)

type labelRenameState struct {
	automationRenameState
	labelRead bool
}
type labelRenameDriver struct{ state *labelRenameState }
type labelRenameConn struct {
	automationRenameConn
	label *labelRenameState
}

func (d labelRenameDriver) Open(string) (driver.Conn, error) {
	return &labelRenameConn{automationRenameConn{updRowConn{state: &d.state.row}, &d.state.automationRenameState}, d.state}, nil
}

func (c *labelRenameConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	switch {
	case strings.HasPrefix(query, "SELECT r.id,r.target_insert_specs,COALESCE("):
		return &updRowRows{cols: []string{"id", "specs", "destination"}}, nil
	case strings.Contains(query, "lang_key_type, creation_spec"):
		if !c.label.physical || !c.label.automation || c.label.registry {
			return nil, errors.New("label moved outside the physical, automation and registry order")
		}
		c.label.labelRead = true
		return nil, errors.New("injected language-key failure")
	}
	return c.automationRenameConn.QueryContext(ctx, query, args)
}

func (c *labelRenameConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	if strings.HasPrefix(query, "UPDATE public.system_triggers") {
		c.label.automation = c.label.physical
		return driver.RowsAffected(0), nil
	}
	return c.automationRenameConn.ExecContext(ctx, query, args)
}

func TestGenericRenameRollsBackWhenTheLabelCannotMove(t *testing.T) {
	granttest.ConfigureRoles(t)
	state := &labelRenameState{automationRenameState: automationRenameState{row: updRowState{queries: []queuedQuery{
		{cols: []string{"granted"}, rows: [][]driver.Value{{false}}},
		{cols: []string{"table_uid"}, rows: [][]driver.Value{{int64(99)}}},
		{cols: []string{"id"}, rows: [][]driver.Value{{int64(5)}}},
		{cols: []string{"table_uid"}, rows: [][]driver.Value{{int64(99)}}},
		{cols: []string{"editable_in_ui"}, rows: [][]driver.Value{{true}}},
		{cols: []string{"data_type"}, rows: [][]driver.Value{{"text"}}},
		{cols: []string{"table_name"}, rows: [][]driver.Value{{"label_before"}}},
	}}}}
	name := fmt.Sprintf("generic_label_rename_%d", automationRenameCounter.Add(1))
	sql.Register(name, labelRenameDriver{state})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	oldDB, oldAdmin := backend.Db, backend.DbAdmin
	backend.Db, backend.DbAdmin = db, db
	defer func() { backend.Db, backend.DbAdmin = oldDB, oldAdmin }()
	req := buildUpdateRowSessionRequest(t, http.MethodPost, "/api/update-row?dataset=system_db_tables", `{"id":5,"column":"table_name","value":"label_after"}`)
	req = req.WithContext(dbutils.SetRequestActorContext(req.Context(), dbutils.NewRequestActorContext(2, "admin")))
	rec := httptest.NewRecorder()
	middlewares.WithLazyTransaction(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { UpdateRowHandler(w, r, "system_db_tables") })).ServeHTTP(rec, req)
	if rec.Code != 500 || !strings.Contains(rec.Body.String(), "Error moving the dataset label") || !state.labelRead ||
		state.registry || state.committed || !state.rolledBack {
		t.Fatal("a label that could not move did not roll the rename back", rec.Code, rec.Body, state.labelRead, state.registry, state.committed, state.rolledBack)
	}
}
