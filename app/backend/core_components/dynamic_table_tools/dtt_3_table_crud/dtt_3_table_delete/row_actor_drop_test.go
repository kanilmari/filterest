// row_actor_drop_test.go
// Proves internal registries and incomplete metadata cannot be dropped.
// Exercises the handler in the request's lazy transaction, including cleanup failure.
// A failed cleanup must return 500 and roll the DROP back rather than commit it.
package dtt_3_table_delete

import (
	"database/sql/driver"
	"easelect/backend/core_components/dbutils"
	"errors"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestActorDatasetDropGuardsAndRollback(t *testing.T) {
	for _, tc := range []struct {
		name                     string
		uid                      driver.Value
		internal, cleanupFailure bool
	}{
		{name: "system_row_actor_columns", internal: true}, {name: "system_media_assets", internal: true}, {name: "system_media_asset_usages", internal: true},
		{name: "notes", uid: nil}, {name: "notes", uid: int64(42), cleanupFailure: true},
	} {
		var queries []queuedDeleteQuery
		var execs []queuedDeleteExec
		if !tc.internal {
			queries = []queuedDeleteQuery{{cols: []string{"is_default", "is_removable"}, rows: [][]driver.Value{{false, true}}}, {cols: []string{"table_uid", "schema_name"}, rows: [][]driver.Value{{tc.uid, "public"}}}}
		}
		if tc.cleanupFailure {
			queries = append(queries, queuedDeleteQuery{cols: []string{"table_name", "table_uid", "schema_name"}})
			execs = []queuedDeleteExec{{rowsAffected: 1}, {err: errors.New("injected cleanup failure")}}
		}
		db, state := openDeleteTableDB(t, queries, execs)
		lt := dbutils.NewLazyTx(db)
		req := httptest.NewRequest("POST", "/", strings.NewReader(fmt.Sprintf(`{"dataset_name":%q,"confirm_dataset_name":%q}`, tc.name, tc.name)))
		req = req.WithContext(dbutils.SetLazyTx(req.Context(), lt))
		rec := httptest.NewRecorder()
		DropTableHandler(rec, req)
		if rec.Code >= 400 {
			_ = lt.Rollback()
		} else {
			_ = lt.Commit()
		}
		want := 500
		if tc.internal {
			want = 400
		}
		if rec.Code != want || state.committed || !state.rolledBack {
			t.Fatalf("%+v: %d %s state=%+v", tc, rec.Code, rec.Body, state)
		}
		if tc.internal && !strings.Contains(rec.Body.String(), "error_internal_table_not_droppable") {
			t.Fatal(rec.Body)
		}
		if !tc.internal && !strings.Contains(rec.Body.String(), "metadata cleanup failed; the dataset was not deleted") {
			t.Fatal(rec.Body)
		}
		if tc.cleanupFailure {
			if len(state.execCalls) != 2 || !strings.HasPrefix(state.execCalls[0], "DROP TABLE notes") {
				t.Fatalf("did not reach cleanup after DROP: %v", state.execCalls)
			}
		} else if len(state.execCalls) != 0 {
			t.Fatal("guard allowed DDL")
		}
	}
}
