// column_update_metadata_test.go
// Unit tests for column metadata synchronization and failure propagation.
// Between UpdateColumnMetadata and the shared database/sql driver double.
// Keeps metadata cleanup, insertion, updates, and deletion covered without PostgreSQL.
package dtt_2_column_update

import (
	"database/sql/driver"
	"errors"
	"strings"
	"testing"
)

func TestUpdateColumnMetadataPropagatesCleanupError(t *testing.T) {
	db, _ := openColUpdateDB(t, nil, []queuedExec{
		{err: errors.New("cleanup boom")},
	})

	err := UpdateColumnMetadata(db)
	if err == nil || !strings.Contains(err.Error(), "error cleaning up obsolete entries") {
		t.Fatalf("err = %v, want wrapped cleanup error", err)
	}
}

func TestUpdateColumnMetadataPropagatesTablesQueryError(t *testing.T) {
	db, _ := openColUpdateDB(t, []queuedQuery{
		{err: errors.New("tables boom")},
	}, []queuedExec{
		{}, // cleanup succeeds
	})

	err := UpdateColumnMetadata(db)
	if err == nil || !strings.Contains(err.Error(), "error fetching tables") {
		t.Fatalf("err = %v, want wrapped tables query error", err)
	}
}

func TestUpdateColumnMetadataNoTablesReturnsNil(t *testing.T) {
	db, state := openColUpdateDB(t, []queuedQuery{
		{cols: []string{"table_name", "table_uid"}, rows: nil},
	}, []queuedExec{
		{}, // cleanup
	})

	err := UpdateColumnMetadata(db)
	if err != nil {
		t.Fatalf("UpdateColumnMetadata returned error: %v", err)
	}
	if len(state.execCalls) != 1 {
		t.Fatalf("exec calls = %d, want 1 (cleanup only)", len(state.execCalls))
	}
}

func TestUpdateColumnMetadataUsesNonAbortingRegclassLookup(t *testing.T) {
	db, state := openColUpdateDB(t, []queuedQuery{
		{
			cols: []string{"table_name", "table_uid"},
			rows: [][]driver.Value{{"concurrently_deleted_table", int64(1)}},
		},
		{
			cols: []string{"attname", "attnum", "data_type"},
			rows: nil, // to_regclass(NULL) represents the table disappearing mid-sync
		},
		{
			cols: []string{"column_name", "column_uid", "data_type"},
			rows: nil,
		},
	}, []queuedExec{{}})

	if err := UpdateColumnMetadata(db); err != nil {
		t.Fatalf("UpdateColumnMetadata returned error: %v", err)
	}
	if len(state.queryCalls) != 3 {
		t.Fatalf("query calls = %d, want 3", len(state.queryCalls))
	}
	columnsQuery := state.queryCalls[1]
	if !strings.Contains(columnsQuery, "pg_catalog.to_regclass($1)") {
		t.Fatalf("columns query = %q, want parameterized to_regclass lookup", columnsQuery)
	}
	if strings.Contains(columnsQuery, "::regclass") {
		t.Fatalf("columns query = %q, direct regclass cast can abort on a concurrent delete", columnsQuery)
	}
}

func TestUpdateColumnMetadataPropagatesPerTableQueryErrors(t *testing.T) {
	tests := []struct {
		name       string
		queries    []queuedQuery
		wantDetail string
	}{
		{
			name: "columns query",
			queries: []queuedQuery{
				{cols: []string{"table_name", "table_uid"}, rows: [][]driver.Value{{"test_table", int64(1)}}},
				{err: errors.New("columns boom")},
			},
			wantDetail: "error fetching columns for table test_table",
		},
		{
			name: "columns scan",
			queries: []queuedQuery{
				{cols: []string{"table_name", "table_uid"}, rows: [][]driver.Value{{"test_table", int64(1)}}},
				{cols: []string{"attname", "attnum", "data_type"}, rows: [][]driver.Value{{"id", "not-an-integer", "integer"}}},
			},
			wantDetail: "error scanning column info for table test_table",
		},
		{
			name: "metadata query",
			queries: []queuedQuery{
				{cols: []string{"table_name", "table_uid"}, rows: [][]driver.Value{{"test_table", int64(1)}}},
				{cols: []string{"attname", "attnum", "data_type"}, rows: nil},
				{err: errors.New("metadata boom")},
			},
			wantDetail: "error fetching metadata for table test_table",
		},
		{
			name: "metadata scan",
			queries: []queuedQuery{
				{cols: []string{"table_name", "table_uid"}, rows: [][]driver.Value{{"test_table", int64(1)}}},
				{cols: []string{"attname", "attnum", "data_type"}, rows: nil},
				{cols: []string{"column_name", "column_uid", "data_type"}, rows: [][]driver.Value{{"id", "not-an-integer", "integer"}}},
			},
			wantDetail: "error scanning metadata for table test_table",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db, _ := openColUpdateDB(t, tt.queries, []queuedExec{{}})
			err := UpdateColumnMetadata(db)
			if err == nil || !strings.Contains(err.Error(), tt.wantDetail) {
				t.Fatalf("err = %v, want detail %q", err, tt.wantDetail)
			}
		})
	}
}

func TestUpdateColumnMetadataStopsAfterMetadataMutationError(t *testing.T) {
	tests := []struct {
		name       string
		columns    [][]driver.Value
		metadata   [][]driver.Value
		wantDetail string
	}{
		{
			name:       "update",
			columns:    [][]driver.Value{{"id", int64(1), "integer"}},
			metadata:   [][]driver.Value{{"id", int64(10), "integer"}},
			wantDetail: "error updating system_column_details",
		},
		{
			name:       "insert",
			columns:    [][]driver.Value{{"new_col", int64(2), "text"}},
			metadata:   nil,
			wantDetail: "error inserting into system_column_details",
		},
		{
			name:       "delete",
			columns:    nil,
			metadata:   [][]driver.Value{{"old_col", int64(11), "text"}},
			wantDetail: "error deleting from system_column_details",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db, state := openColUpdateDB(t, []queuedQuery{
				{cols: []string{"table_name", "table_uid"}, rows: [][]driver.Value{{"test_table", int64(1)}}},
				{cols: []string{"attname", "attnum", "data_type"}, rows: tt.columns},
				{cols: []string{"column_name", "column_uid", "data_type"}, rows: tt.metadata},
			}, []queuedExec{
				{},
				{err: errors.New("mutation boom")},
				{}, // must remain unused: a failed transaction cannot accept more work
			})

			err := UpdateColumnMetadata(db)
			if err == nil || !strings.Contains(err.Error(), tt.wantDetail) {
				t.Fatalf("err = %v, want detail %q", err, tt.wantDetail)
			}
			if len(state.execCalls) != 2 {
				t.Fatalf("exec calls = %d, want cleanup plus one failed mutation", len(state.execCalls))
			}
		})
	}
}

func TestUpdateColumnMetadataUpdatesExistingColumn(t *testing.T) {
	db, state := openColUpdateDB(t, []queuedQuery{
		// tables
		{
			cols: []string{"table_name", "table_uid"},
			rows: [][]driver.Value{{"test_table", int64(1)}},
		},
		// pg_attribute → "id" exists
		{
			cols: []string{"attname", "attnum", "data_type"},
			rows: [][]driver.Value{{"id", int64(1), "integer"}},
		},
		// metadata → "id" already tracked (triggers update path)
		{
			cols: []string{"column_name", "column_uid", "data_type"},
			rows: [][]driver.Value{{"id", int64(10), "integer"}},
		},
	}, []queuedExec{
		{}, // cleanup
		{}, // UPDATE system_column_details
	})

	err := UpdateColumnMetadata(db)
	if err != nil {
		t.Fatalf("UpdateColumnMetadata returned error: %v", err)
	}
	if len(state.execCalls) != 2 {
		t.Fatalf("exec calls = %d, want 2 (cleanup + update)", len(state.execCalls))
	}
	if !strings.Contains(state.execCalls[1], "UPDATE system_column_details") {
		t.Fatalf("exec[1] = %q, want UPDATE", state.execCalls[1])
	}
	if !strings.Contains(state.execCalls[1], "card_element") {
		t.Fatalf("exec[1] = %q, want card_element backfill in UPDATE", state.execCalls[1])
	}
}

func TestUpdateColumnMetadataInsertsNewColumn(t *testing.T) {
	db, state := openColUpdateDB(t, []queuedQuery{
		{
			cols: []string{"table_name", "table_uid"},
			rows: [][]driver.Value{{"test_table", int64(1)}},
		},
		{
			cols: []string{"attname", "attnum", "data_type"},
			rows: [][]driver.Value{{"new_col", int64(2), "text"}},
		},
		{
			cols: []string{"column_name", "column_uid", "data_type"},
			rows: nil, // no existing metadata
		},
	}, []queuedExec{
		{}, // cleanup
		{}, // INSERT into system_column_details
	})

	err := UpdateColumnMetadata(db)
	if err != nil {
		t.Fatalf("UpdateColumnMetadata returned error: %v", err)
	}
	if len(state.execCalls) != 2 {
		t.Fatalf("exec calls = %d, want 2 (cleanup + insert)", len(state.execCalls))
	}
	if !strings.Contains(state.execCalls[1], "INSERT INTO system_column_details") {
		t.Fatalf("exec[1] = %q, want INSERT", state.execCalls[1])
	}
	if !strings.Contains(state.execCalls[1], "card_element") {
		t.Fatalf("exec[1] = %q, want explicit card_element default in INSERT", state.execCalls[1])
	}
	if !strings.Contains(state.execCalls[1], "show_key_on_card") || !strings.Contains(state.execCalls[1], "'details', NULL") {
		t.Fatal("new details columns must inherit their label policy through raw NULL")
	}
	insertSQL := strings.ToLower(state.execCalls[1])
	columnListStart := strings.Index(insertSQL, "(")
	columnListEnd := strings.Index(insertSQL[columnListStart+1:], ")")
	if columnListStart < 0 || columnListEnd < 0 {
		t.Fatalf("exec[1] = %q, want an explicit INSERT column list", state.execCalls[1])
	}
	columnListEnd += columnListStart + 1
	for _, columnName := range strings.Split(insertSQL[columnListStart+1:columnListEnd], ",") {
		switch strings.TrimSpace(columnName) {
		case "id", "column_uid":
			t.Fatalf("exec[1] = %q, identity column %q must use its database default", state.execCalls[1], strings.TrimSpace(columnName))
		}
	}
}

func TestUpdateColumnMetadataDeletesRemovedColumn(t *testing.T) {
	db, state := openColUpdateDB(t, []queuedQuery{
		{
			cols: []string{"table_name", "table_uid"},
			rows: [][]driver.Value{{"test_table", int64(1)}},
		},
		{
			cols: []string{"attname", "attnum", "data_type"},
			rows: nil, // no pg columns
		},
		{
			cols: []string{"column_name", "column_uid", "data_type"},
			rows: [][]driver.Value{{"old_col", int64(11), "text"}},
		},
	}, []queuedExec{
		{}, // cleanup
		{}, // DELETE from system_column_details
	})

	err := UpdateColumnMetadata(db)
	if err != nil {
		t.Fatalf("UpdateColumnMetadata returned error: %v", err)
	}
	if len(state.execCalls) != 2 {
		t.Fatalf("exec calls = %d, want 2 (cleanup + delete)", len(state.execCalls))
	}
	if !strings.Contains(state.execCalls[1], "DELETE FROM system_column_details") {
		t.Fatalf("exec[1] = %q, want DELETE", state.execCalls[1])
	}
}
