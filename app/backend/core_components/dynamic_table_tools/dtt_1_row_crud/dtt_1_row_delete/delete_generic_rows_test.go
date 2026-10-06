// delete_generic_rows_test.go
// Unit tests for the dtt_1_row_delete package.
// Uses httptest for handler guard branches and a database/sql driver double for the extracted transaction-level helpers.
// Keeps exact counts, savepoint rollback and logging regressions together.
package dtt_1_row_delete

import (
	"database/sql/driver"
	"errors"
	"strings"
	"testing"

	"github.com/lib/pq"
)

func TestDeleteGenericRowsHappyPath(t *testing.T) {
	_, tx, state := openDelRowTx(t, nil, []queuedExec{
		{},                                       // generic delete SAVEPOINT
		{rowsAffected: 2, setRowsAffected: true}, // DELETE FROM table
		{},                                       // generic delete RELEASE SAVEPOINT
		{},                                       // deletion log SAVEPOINT
		{},                                       // logDeletionsToLog INSERT
		{},                                       // deletion log RELEASE SAVEPOINT
	})

	err := deleteGenericRows(tx, "users", []int{10, 20}, "42", "admin", 42)
	if err != nil {
		t.Fatalf("deleteGenericRows returned error: %v", err)
	}
	if len(state.execCalls) != 6 {
		t.Fatalf("exec calls = %d, want 6", len(state.execCalls))
	}
	if state.execCalls[0] != "SAVEPOINT generic_row_delete" {
		t.Fatalf("exec[0] = %q, want generic delete SAVEPOINT", state.execCalls[0])
	}
	if !strings.Contains(state.execCalls[1], `DELETE FROM "users" WHERE "users"."id" IN`) {
		t.Fatalf("exec[1] = %q, want DELETE statement", state.execCalls[1])
	}
	if state.execCalls[2] != "RELEASE SAVEPOINT generic_row_delete" {
		t.Fatalf("exec[2] = %q, want generic delete RELEASE before logging", state.execCalls[2])
	}
	if state.execCalls[3] != "SAVEPOINT deletion_log_insert" {
		t.Fatalf("exec[3] = %q, want deletion log SAVEPOINT", state.execCalls[3])
	}
	if !strings.Contains(state.execCalls[4], "INSERT INTO deletion_log") {
		t.Fatalf("exec[4] = %q, want deletion log INSERT", state.execCalls[4])
	}
}

func TestDeleteGenericRowsRepeatsLegacyMutationPolicyInDelete(t *testing.T) {
	_, tx, state := openDelRowTx(t, []queuedQuery{
		{cols: []string{"column_name"}, rows: [][]driver.Value{{"published"}}},
		{cols: []string{"exists"}, rows: [][]driver.Value{{true}}},
		{cols: []string{"row_policy_owner_column"}, rows: [][]driver.Value{{"user_id"}}},
		{cols: []string{"column_name"}, rows: [][]driver.Value{{"id"}, {"user_id"}, {"published"}}},
	}, []queuedExec{
		{}, // generic delete SAVEPOINT
		{}, // DELETE
		{}, // generic delete RELEASE SAVEPOINT
		{}, // deletion log SAVEPOINT
		{}, // deletion log INSERT
		{}, // deletion log RELEASE SAVEPOINT
	})

	err := deleteGenericRows(tx, "articles", []int{7}, "42", "basic", 42)
	if err != nil {
		t.Fatalf("deleteGenericRows returned error: %v", err)
	}
	if len(state.execCalls) < 2 {
		t.Fatalf("exec calls = %#v, want guarded DELETE", state.execCalls)
	}
	deleteQuery := state.execCalls[1]
	if !strings.Contains(deleteQuery, `("articles"."published" = TRUE OR "articles"."user_id" = $2)`) {
		t.Fatalf("delete query = %q, want legacy flag-or-owner predicate", deleteQuery)
	}
}

func TestDeleteGenericRowsPropagatesExecError(t *testing.T) {
	wantErr := errors.New("delete boom")
	_, tx, state := openDelRowTx(t, nil, []queuedExec{
		{},             // SAVEPOINT
		{err: wantErr}, // DELETE fails
		{},             // ROLLBACK TO SAVEPOINT
		{},             // RELEASE SAVEPOINT
	})

	err := deleteGenericRows(tx, "users", []int{1}, "system", "admin", 2)
	if err == nil || !strings.Contains(err.Error(), "error deleting rows") {
		t.Fatalf("err = %v, want wrapped delete error", err)
	}
	if len(state.execCalls) != 4 || state.execCalls[2] != "ROLLBACK TO SAVEPOINT generic_row_delete" || state.execCalls[3] != "RELEASE SAVEPOINT generic_row_delete" {
		t.Fatalf("exec calls = %#v, want failed DELETE rolled back and savepoint released", state.execCalls)
	}
	for _, call := range state.execCalls {
		if strings.Contains(call, "deletion_log") {
			t.Fatalf("deletion log call after failed DELETE: %q", call)
		}
	}
}

func TestDeleteGenericRowsPreservesForeignKeyViolationAfterRollback(t *testing.T) {
	databaseErr := &pq.Error{Code: "23503", Constraint: "child_parent_id_fkey"}
	_, tx, state := openDelRowTx(t, nil, []queuedExec{
		{},                 // SAVEPOINT
		{err: databaseErr}, // DELETE fails due to a referencing row
		{},                 // ROLLBACK TO SAVEPOINT
		{},                 // RELEASE SAVEPOINT
	})

	err := deleteGenericRows(tx, "users", []int{1}, "system", "admin", 2)
	var gotDatabaseErr *pq.Error
	if !errors.As(err, &gotDatabaseErr) || gotDatabaseErr.Code != "23503" {
		t.Fatalf("err = %v, want preserved PostgreSQL 23503 error", err)
	}
	if len(state.execCalls) != 4 || state.execCalls[2] != "ROLLBACK TO SAVEPOINT generic_row_delete" || state.execCalls[3] != "RELEASE SAVEPOINT generic_row_delete" {
		t.Fatalf("exec calls = %#v, want failed DELETE rolled back and savepoint released", state.execCalls)
	}
}

func TestDeleteGenericRowsRollsBackWhenRowsAffectedFails(t *testing.T) {
	wantErr := errors.New("rows affected unavailable")
	_, tx, state := openDelRowTx(t, nil, []queuedExec{
		{},                         // SAVEPOINT
		{rowsAffectedErr: wantErr}, // DELETE result cannot be verified
		{},                         // ROLLBACK TO SAVEPOINT
		{},                         // RELEASE SAVEPOINT
	})

	err := deleteGenericRows(tx, "users", []int{1}, "system", "admin", 2)
	if err == nil || !strings.Contains(err.Error(), "error verifying deleted rows") {
		t.Fatalf("err = %v, want wrapped RowsAffected error", err)
	}
	if len(state.execCalls) != 4 || state.execCalls[2] != "ROLLBACK TO SAVEPOINT generic_row_delete" || state.execCalls[3] != "RELEASE SAVEPOINT generic_row_delete" {
		t.Fatalf("exec calls = %#v, want unverifiable DELETE rolled back and savepoint released", state.execCalls)
	}
	for _, call := range state.execCalls {
		if strings.Contains(call, "deletion_log") {
			t.Fatalf("deletion log call after unverifiable DELETE: %q", call)
		}
	}
}

func TestDeleteGenericRowsContinuesWhenDeletionLogInsertFails(t *testing.T) {
	_, tx, state := openDelRowTx(t, nil, []queuedExec{
		{},                        // generic delete SAVEPOINT
		{},                        // DELETE FROM table
		{},                        // generic delete RELEASE SAVEPOINT
		{},                        // deletion log SAVEPOINT
		{err: errors.New("boom")}, // deletion log INSERT
		{},                        // deletion log ROLLBACK TO SAVEPOINT
		{},                        // deletion log RELEASE SAVEPOINT
	})

	err := deleteGenericRows(tx, "users", []int{10}, "42", "admin", 42)
	if err != nil {
		t.Fatalf("deleteGenericRows returned error: %v", err)
	}
	if len(state.execCalls) != 7 {
		t.Fatalf("exec calls = %d, want 7", len(state.execCalls))
	}
	if state.execCalls[2] != "RELEASE SAVEPOINT generic_row_delete" {
		t.Fatalf("exec[2] = %q, want generic delete RELEASE", state.execCalls[2])
	}
	if state.execCalls[3] != "SAVEPOINT deletion_log_insert" {
		t.Fatalf("exec[3] = %q, want deletion log SAVEPOINT", state.execCalls[3])
	}
	if state.execCalls[5] != "ROLLBACK TO SAVEPOINT deletion_log_insert" {
		t.Fatalf("exec[5] = %q, want deletion log ROLLBACK TO SAVEPOINT", state.execCalls[5])
	}
}

func TestDeleteGenericRowsSkipsDeletionLogForSystemTable(t *testing.T) {
	// When tableName is a system table, logDeletionsToLog skips after the guarded DELETE.
	_, tx, state := openDelRowTx(t, nil, []queuedExec{
		{}, // SAVEPOINT
		{}, // DELETE
		{}, // RELEASE SAVEPOINT
	})

	err := deleteGenericRows(tx, "system_db_tables", []int{1}, "system", "admin", 2)
	if err != nil {
		t.Fatalf("deleteGenericRows returned error: %v", err)
	}
	if len(state.execCalls) != 3 {
		t.Fatalf("exec calls = %d, want 3 (guarded DELETE only)", len(state.execCalls))
	}
}

func TestDeleteGenericRowsRlsPilotRejectsPartialDelete(t *testing.T) {
	_, tx, state := openDelRowTx(t, nil, []queuedExec{
		{},                                       // SAVEPOINT
		{rowsAffected: 1, setRowsAffected: true}, // partial DELETE
		{},                                       // ROLLBACK TO SAVEPOINT
		{},                                       // RELEASE SAVEPOINT
	})

	err := deleteGenericRows(tx, deleteRLSPilotTableName, []int{10, 20}, "42", "basic", 42)
	if err == nil {
		t.Fatalf("deleteGenericRows returned nil, want forbidden error")
	}
	var fe *forbiddenError
	if !errors.As(err, &fe) {
		t.Fatalf("err = %v, want forbiddenError", err)
	}
	if len(state.execCalls) != 4 {
		t.Fatalf("exec calls = %d, want SAVEPOINT, DELETE, ROLLBACK TO, RELEASE", len(state.execCalls))
	}
	if state.execCalls[0] != "SAVEPOINT generic_row_delete" ||
		!strings.Contains(state.execCalls[1], `DELETE FROM "app_service_catalog" WHERE "app_service_catalog"."id" IN`) ||
		!strings.Contains(state.execCalls[1], `"app_service_catalog"."user_id" = $3`) ||
		state.execCalls[2] != "ROLLBACK TO SAVEPOINT generic_row_delete" ||
		state.execCalls[3] != "RELEASE SAVEPOINT generic_row_delete" {
		t.Fatalf("exec calls = %#v, want partial DELETE fully rolled back", state.execCalls)
	}
	for _, call := range state.execCalls {
		if strings.Contains(call, "deletion_log") {
			t.Fatalf("deletion log call after partial DELETE: %q", call)
		}
	}
}

func TestDeleteGenericRowsRlsPilotAllowsExactDeleteAndLogsAfterward(t *testing.T) {
	_, tx, state := openDelRowTx(t, nil, []queuedExec{
		{},                                       // generic delete SAVEPOINT
		{rowsAffected: 2, setRowsAffected: true}, // DELETE
		{},                                       // generic delete RELEASE SAVEPOINT
		{},                                       // deletion log SAVEPOINT
		{},                                       // deletion log INSERT
		{},                                       // deletion log RELEASE SAVEPOINT
	})

	err := deleteGenericRows(tx, deleteRLSPilotTableName, []int{10, 20}, "42", "basic", 42)
	if err != nil {
		t.Fatalf("deleteGenericRows returned error: %v", err)
	}
	if len(state.execCalls) != 6 {
		t.Fatalf("exec calls = %d, want 6", len(state.execCalls))
	}
	if state.execCalls[0] != "SAVEPOINT generic_row_delete" {
		t.Fatalf("exec[0] = %q, want generic delete SAVEPOINT", state.execCalls[0])
	}
	if !strings.Contains(state.execCalls[1], `DELETE FROM "app_service_catalog" WHERE "app_service_catalog"."id" IN`) ||
		!strings.Contains(state.execCalls[1], `"app_service_catalog"."user_id" = $3`) {
		t.Fatalf("exec[1] = %q, want DELETE statement", state.execCalls[1])
	}
	if state.execCalls[2] != "RELEASE SAVEPOINT generic_row_delete" {
		t.Fatalf("exec[2] = %q, want generic delete RELEASE", state.execCalls[2])
	}
	if state.execCalls[3] != "SAVEPOINT deletion_log_insert" || !strings.Contains(state.execCalls[4], "INSERT INTO deletion_log") {
		t.Fatalf("exec calls = %#v, want deletion log only after generic delete RELEASE", state.execCalls)
	}
}

// ── revokeColumnPrivileges tests ───────────────────────────────────────
