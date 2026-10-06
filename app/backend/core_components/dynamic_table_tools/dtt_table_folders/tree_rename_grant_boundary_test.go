// tree_rename_grant_boundary_test.go
// Checks that successful renames finish their grant boundary after metadata writes.
// Reuses the table-folder driver and shared runtime-policy catalogue fixture.
// A failed effective postcheck must become an HTTP failure instead of success.
package dtt_system_table_folders

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

	"easelect/backend/core_components/runtime_grants/granttest"
)

type renameBoundaryState struct {
	t           *testing.T
	folder      *folderMockState
	comparisons int
	fail        bool
}
type renameBoundaryDriver struct{ state *renameBoundaryState }
type renameBoundaryConn struct {
	folderMockConn
	boundary *renameBoundaryState
}

func (d renameBoundaryDriver) Open(string) (driver.Conn, error) {
	return &renameBoundaryConn{folderMockConn: folderMockConn{state: d.state.folder}, boundary: d.state}, nil
}
func (c *renameBoundaryConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if strings.Contains(query, "FROM actual WHERE wanted IS DISTINCT FROM present") {
		c.boundary.comparisons++
		var renamed, registered, automations bool
		for _, call := range c.state.calls {
			renamed = renamed || strings.HasPrefix(call.query, "ALTER TABLE")
			registered = registered || strings.Contains(call.query, "UPDATE system_db_tables SET table_name")
			automations = automations || strings.Contains(call.query, "UPDATE public.system_triggers")
		}
		if !renamed || !registered || !automations {
			c.boundary.t.Fatal("grant comparison preceded physical, registry and automation rename")
		}
		if c.boundary.fail && c.boundary.comparisons == 3 {
			return nil, errors.New("effective privilege check failed")
		}
	}
	return c.folderMockConn.QueryContext(ctx, query, args)
}

func TestTreeRenameCompletesGrantBoundary(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(fmt.Sprintf("postcheck failure=%t", fail), func(t *testing.T) {
			granttest.ConfigureRoles(t)
			state := &renameBoundaryState{t: t, fail: fail, folder: &folderMockState{
				queries: []folderQueryResponse{
					{match: "SELECT to_regclass('public.system_triggers')", cols: []string{"present"}, rows: [][]driver.Value{{true}}},
					{match: "FROM system_db_table_aliases", cols: []string{"table_name", "alias_slug"}},
					{match: "SELECT table_uid, table_name", cols: []string{"table_uid", "table_name"}},
					{match: "SELECT id, table_name", cols: []string{"id", "table_name"}},
					{match: "SELECT table_name FROM system_db_tables", cols: []string{"table_name"}, rows: [][]driver.Value{{"rename_before"}}},
					{match: "SELECT id FROM system_lang_keys", cols: []string{"id"}, rows: [][]driver.Value{{int64(11)}}},
				},
				execs: []folderExecResponse{
					{match: "UPDATE public.system_triggers", rowsAffected: 1},
					{match: "ALTER TABLE", rowsAffected: 1}, {match: "UPDATE system_db_tables", rowsAffected: 1},
					{match: "system_lang_keys", rowsAffected: 1}, {match: "system_lang_key_sources", rowsAffected: 1},
				},
			}}
			name := fmt.Sprintf("rename_boundary_%d", atomic.AddInt64(&folderDriverCounter, 1))
			sql.Register(name, renameBoundaryDriver{state})
			db, err := sql.Open(name, "")
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			req := withFolderTx(httptest.NewRequest("POST", "/api/rename-tree-node", strings.NewReader(`{"item_id":5,"item_type":"table","new_name":"rename_after"}`)), db)
			rec := httptest.NewRecorder()
			HandleRenameTreeNode(granttest.Recorder{ResponseRecorder: rec}, req)
			wantStatus := 200
			if fail {
				wantStatus = 500
			}
			if rec.Code != wantStatus || state.comparisons != 3 {
				t.Fatal("rename did not finish policy boundary", rec.Code, rec.Body, state.comparisons)
			}
		})
	}
}
