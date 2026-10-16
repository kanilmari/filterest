// sec4_read_boundary_test.go
// Exercises the accepted security lows through real handlers with in-memory SQL.
// Connects permission principals and controlled rows without network or installation data.
// Refusals must precede disclosure; administrator behavior remains covered.
package dtt_1_row_read

import (
	"database/sql/driver"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils/queryfixture"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSEC4FilterOptionsRejectsUnselectableValueColumn(t *testing.T) {
	db := queryfixture.Open(t, func(q string, _ []driver.NamedValue) (driver.Rows, error) {
		switch {
		case strings.Contains(q, "column_privileges"):
			return queryfixture.Rows([]string{"column_name"}, []driver.Value{"id"}, []driver.Value{"name"}), nil
		case strings.Contains(q, "information_schema.columns"), strings.Contains(q, "SELECT EXISTS"):
			return queryfixture.Rows([]string{"exists"}, []driver.Value{true}), nil
		case strings.Contains(q, "system_column_details"):
			return queryfixture.Rows([]string{"column_name"}), nil
		case strings.Contains(q, "FROM system_db_tables"):
			return queryfixture.Rows([]string{"uid"}, []driver.Value{int64(7)}), nil
		default:
			return queryfixture.Rows([]string{"internal_notes", "name"}, []driver.Value{"private note", "Row name"}), nil
		}
	})
	old, oldBasic := backend.Db, backend.DbBasic
	backend.Db, backend.DbBasic = db, db
	t.Cleanup(func() { backend.Db, backend.DbBasic = old, oldBasic })
	req := queryfixture.Request(t, "GET", "/api/get-filter-options?dataset=private_data&value_column=internal_notes", "", 42, "basic")
	rec := httptest.NewRecorder()
	GetFilterOptionsHandler(rec, req)
	if rec.Code != 403 {
		t.Fatalf("unselectable field: status=%d want 403: %s", rec.Code, rec.Body)
	}
}
