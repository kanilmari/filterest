// row_access_commit_test.go
// Exercises large principal readback through the real row-access mutation handler.
// Connects an in-memory SQL driver to the request transaction and response boundary.
// Keeps large installations compatible while withholding success on commit failure.
package system_table_tools

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/middlewares"
	esessions "easelect/backend/core_components/sessions"
	"github.com/gorilla/sessions"
)

type rowAccessCommitDriver struct {
	t                      *testing.T
	response               *httptest.ResponseRecorder
	fail                   bool
	commits, rules, events int
}
type rowAccessCommitConn struct{ state *rowAccessCommitDriver }
type rowAccessCommitTx struct{ state *rowAccessCommitDriver }
type rowAccessCommitRows struct {
	columns []string
	values  [][]driver.Value
}

func (d *rowAccessCommitDriver) Open(string) (driver.Conn, error) {
	return &rowAccessCommitConn{d}, nil
}
func (d *rowAccessCommitDriver) Connect(context.Context) (driver.Conn, error) { return d.Open("") }
func (d *rowAccessCommitDriver) Driver() driver.Driver                        { return d }
func (*rowAccessCommitConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepare")
}
func (*rowAccessCommitConn) Close() error                { return nil }
func (c *rowAccessCommitConn) Begin() (driver.Tx, error) { return rowAccessCommitTx{c.state}, nil }
func (tx rowAccessCommitTx) Commit() error {
	tx.state.commits++
	if tx.state.response.Body.Len() != 0 {
		tx.state.t.Error("row-access response escaped before commit")
	}
	if tx.state.fail {
		return errors.New("injected row-access commit failure")
	}
	return nil
}
func (rowAccessCommitTx) Rollback() error { return nil }
func (c *rowAccessCommitConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	if strings.Contains(query, "INSERT INTO public.system_row_access_rules (") {
		c.state.rules++
	}
	if strings.Contains(query, "INSERT INTO public.system_row_access_rule_events (") {
		c.state.events++
	}
	return driver.RowsAffected(1), nil
}
func (*rowAccessCommitConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	rows := &rowAccessCommitRows{columns: []string{"value"}}
	switch {
	case strings.Contains(query, "SELECT table_uid,"):
		rows.columns, rows.values = []string{"uid", "schema"}, [][]driver.Value{{int64(42), "public"}}
	case strings.Contains(query, "SELECT EXISTS"):
		rows.values = [][]driver.Value{{true}}
	case strings.Contains(query, `SELECT id FROM "public"."app_service_catalog"`):
		rows.values = [][]driver.Value{{int64(7)}}
	case strings.Contains(query, "SELECT actions.id,"):
		rows.columns = []string{"id", "key", "label", "category", "order"}
		for i, key := range []string{"read", "update", "delete"} {
			rows.values = append(rows.values, []driver.Value{int64(i + 1), key, "permission_" + key, "row", int64(i)})
		}
	case strings.Contains(query, "SELECT actions.action_key, rules.effect"):
		rows.columns, rows.values = []string{"action", "effect", "count"}, [][]driver.Value{{"read", "allow", int64(1)}}
	case strings.Contains(query, "SELECT id, name FROM public.system_user_groups"):
		rows.columns = []string{"id", "name"}
	case strings.Contains(query, "SELECT id, username, COALESCE(full_name, '')"):
		rows.columns = []string{"id", "name", "full_name"}
		for i := 0; i < 20000; i++ {
			rows.values = append(rows.values, []driver.Value{int64(i + 2), fmt.Sprintf("member%05d", i), fmt.Sprintf("Member %05d", i)})
		}
	}
	return rows, nil
}
func (r *rowAccessCommitRows) Columns() []string { return r.columns }
func (*rowAccessCommitRows) Close() error        { return nil }
func (r *rowAccessCommitRows) Next(dest []driver.Value) error {
	if len(r.values) == 0 {
		return io.EOF
	}
	copy(dest, r.values[0])
	r.values = r.values[1:]
	return nil
}

func TestRowAccessMutationDeliversLargeResponseAfterCommit(t *testing.T) {
	oldStore := esessions.Store
	esessions.Store = sessions.NewCookieStore([]byte("large-handler-unit-test"))
	t.Cleanup(func() { esessions.Store = oldStore })
	for _, failure := range []bool{false, true} {
		t.Run(fmt.Sprintf("commit_failure=%t", failure), func(t *testing.T) {
			response := httptest.NewRecorder()
			state := &rowAccessCommitDriver{t: t, response: response, fail: failure}
			db := sql.OpenDB(state)
			oldDB, oldAdmin := backend.Db, backend.DbAdmin
			backend.Db, backend.DbAdmin = db, db
			t.Cleanup(func() { backend.Db, backend.DbAdmin = oldDB, oldAdmin; _ = db.Close() })
			request := httptest.NewRequest(http.MethodPost, "/api/admin/row-access-rules", strings.NewReader(`{"dataset":"app_service_catalog","row_ids":[7],"principals":[{"type":"user","id":2}],"changes":{"read":"allow"}}`))
			request = request.WithContext(dbutils.SetRequestActorContext(request.Context(), dbutils.NewRequestActorContext(2, "admin")))
			middlewares.WithLazyTransaction(http.HandlerFunc(AdminRowAccessRulesHandler)).ServeHTTP(response, request)
			if state.rules != 1 || state.events != 1 || state.commits != 1 {
				t.Fatalf("real mutation not completed: rules=%d events=%d commits=%d", state.rules, state.events, state.commits)
			}
			if failure {
				if response.Code != 500 || !strings.Contains(response.Body.String(), "transaction commit failed") || strings.Contains(response.Body.String(), "principals") || strings.Contains(response.Body.String(), "member00000") {
					t.Fatal("large row-access success escaped commit failure")
				}
				return
			}
			if response.Code != 200 || response.Body.Len() <= 1<<20 {
				t.Fatalf("large success not delivered: status=%d bytes=%d", response.Code, response.Body.Len())
			}
			var payload rowAccessResponse
			if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
				t.Fatal(err)
			}
			if payload.Dataset != "app_service_catalog" || len(payload.Principals) != 20000 || payload.States["read"].State != "allow" || payload.AffectedRuleCount != 1 || payload.ChangeSetID == "" {
				t.Fatal("mutation readback was incomplete")
			}
			for i, principal := range payload.Principals {
				if principal.ID != int64(i+2) || principal.Type != "user" || principal.Name != fmt.Sprintf("member%05d", i) || principal.FullName != fmt.Sprintf("Member %05d", i) {
					t.Fatalf("principal %d was truncated or changed", i)
				}
			}
		})
	}
}
