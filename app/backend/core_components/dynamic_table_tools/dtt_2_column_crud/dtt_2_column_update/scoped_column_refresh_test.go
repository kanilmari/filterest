// scoped_column_refresh_test.go
// Proves a creation refresh visits only its requested dataset's columns.
// Uses the SQL driver alongside the global maintenance refresh regressions.
// Keeps catalogue-size-dependent work and unrelated cleanup out of creation.
package dtt_2_column_update

import (
	"database/sql/driver"
	"strings"
	"testing"
)

func TestDatasetColumnRefreshSkipsGlobalCleanup(t *testing.T) {
	db, state := openColUpdateDB(t, []queuedQuery{
		{cols: []string{"table_name", "table_uid"}, rows: [][]driver.Value{{"new_dataset", int64(91)}}},
		{cols: []string{"attname", "attnum", "data_type"}, rows: [][]driver.Value{{"id", int64(1), "integer"}}},
		{cols: []string{"column_name", "column_uid", "data_type"}},
	}, []queuedExec{{}})
	if err := UpdateDatasetColumnMetadata(db, "new_dataset"); err != nil {
		t.Fatal(err)
	}
	if len(state.execCalls) != 1 || !strings.Contains(state.execCalls[0], "INSERT INTO system_column_details") {
		t.Fatal("creation performed global cleanup", state.execCalls)
	}
	if len(state.queryCalls) != 3 || !strings.Contains(state.queryCalls[0], "WHERE table_name = $1") {
		t.Fatal("creation scanned every registered dataset", state.queryCalls)
	}
	t.Log("one dataset: 3 reads + 1 column insert; no global orphan cleanup")
}
