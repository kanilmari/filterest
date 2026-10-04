// account_reference_recheck_test.go
// Unit test for RecheckRowsVisibleAfterInsert's choice of the rows it reads again.
// Bridges the add-row path's repeated reference check and unlockedReferenceTables.
// Exists because only rows checked without a lock need the second read; the others stay locked from the first check.
package dtt_1_row_read

import (
	"reflect"
	"testing"
)

func TestRecheckRowsVisibleAfterInsertReadsOnlyRowsCheckedWithoutALock(t *testing.T) {
	// A table whose rows the first check locked is not read again: reading through the nil transaction would panic.
	for _, tableName := range []string{"owned_notes", "palvelukatalogi", rlsPilotTableName} {
		visible, err := RecheckRowsVisibleAfterInsert(nil, tableName, "basic", 4, []int64{1})
		if err != nil || !visible {
			t.Fatalf("%s: visible = %v, err = %v; want true without reading", tableName, visible, err)
		}
	}
	// The rows read again are those of the five account and rights tables (proved on PostgreSQL by the add-row
	// package's TestAddRowRefusesAUserHiddenWhileTheRowIsAddedPostgres).
	want := map[string]bool{
		"system_users": true, "system_user_groups": true, "system_user_group_memberships": true,
		"system_group_table_func_rights": true, "system_functions": true,
	}
	if !reflect.DeepEqual(unlockedReferenceTables, want) {
		t.Fatalf("tables checked without a lock: %v, want %v", unlockedReferenceTables, want)
	}
}
