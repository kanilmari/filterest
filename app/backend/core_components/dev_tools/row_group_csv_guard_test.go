// row_group_csv_guard_test.go
// Keeps development restores inside the dedicated row-group mutation boundary.
// A refusal must precede file reads and database access, even for an administrator.
package devtools

import (
	"strings"
	"testing"
)

func TestRowGroupCSVImportRefusesDedicatedTablesBeforeFileOrDatabaseAccess(t *testing.T) {
	for _, table := range []string{"system_row_groups", "system_row_group_memberships", "system_row_group_classifications"} {
		_, _, err := ImportTableCSVTxWithUsername(nil, table, "administrator")
		if err == nil || !strings.Contains(err.Error(), "dedicated mutation API") {
			t.Fatalf("%s: %v", table, err)
		}
	}
}
