// sec4_read_boundary_test.go
// Exercises the accepted security lows through real handlers with in-memory SQL.
// Connects permission principals and controlled rows without network or installation data.
// Refusals must precede disclosure; administrator behavior remains covered.
package dtt_2_column_crud

import (
	"database/sql/driver"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils/queryfixture"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSEC4DatasetColumnsRejectsConflictingTarget(t *testing.T) {
	db := queryfixture.Open(t, func(q string, _ []driver.NamedValue) (driver.Rows, error) {
		if strings.Contains(q, "SELECT table_uid") {
			return queryfixture.Rows([]string{"uid"}, []driver.Value{int64(9)}), nil
		}
		return queryfixture.Rows([]string{"uid", "column_name", "type", "order", "role", "length", "multilingual", "new_multilingual"}, []driver.Value{int64(10), "B_only", "text", int64(1), "details", nil, false, false}), nil
	})
	old := backend.Db
	backend.Db = db
	t.Cleanup(func() { backend.Db = old })
	rec := httptest.NewRecorder()
	GetTableColumnsHandler(rec, httptest.NewRequest("GET", "/api/dataset-columns/B?dataset=A", nil))
	if rec.Code != 400 && rec.Code != 403 {
		t.Fatalf("conflicting target: status=%d, want 400/403", rec.Code)
	}
}
