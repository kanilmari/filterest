// read_update_columns_test.go
// Verifies column inspection retains declared PostgreSQL decimal scale.
// Bridges the dataset-column API query with the owner-visible type description.
// Exists so diagnostics cannot regress from numeric(precision,scale) to bare numeric.
package dtt_2_column_crud

import (
	"strings"
	"testing"
)

func TestTableColumnsQueryCarriesDeclaredNumericScale(t *testing.T) {
	for _, requiredFragment := range []string{
		"WHEN c.data_type = 'numeric'",
		"pg_catalog.format_type(type_column.atttypid, type_column.atttypmod)",
		"ELSE c.data_type",
	} {
		if !strings.Contains(tableColumnsWithTypesAndIDsQuery, requiredFragment) {
			t.Fatalf("dataset-column query missing %q", requiredFragment)
		}
	}
}
