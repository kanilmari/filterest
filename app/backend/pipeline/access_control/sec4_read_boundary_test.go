// sec4_read_boundary_test.go
// Exercises the accepted security lows through real handlers with in-memory SQL.
// Connects permission principals and controlled rows without network or installation data.
// Refusals must precede disclosure; administrator behavior remains covered.
package access_control

import (
	"database/sql/driver"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils/queryfixture"
	"strings"
	"testing"
)

func TestSEC4TreeIgnoresDisabledFunctionGrants(t *testing.T) {
	db := queryfixture.Open(t, func(q string, args []driver.NamedValue) (driver.Rows, error) {
		if strings.Contains(q, "SELECT 1 FROM system_user_group_memberships") {
			if args[0].Value == int64(99) {
				return queryfixture.Rows([]string{"admin"}, []driver.Value{int64(1)}), nil
			}
			return queryfixture.Rows([]string{"admin"}), nil
		}
		rows := [][]driver.Value{{int64(10)}}
		if !strings.Contains(q, "f.disabled = false OR f.disabled IS NULL") {
			rows = append(rows, []driver.Value{int64(20)})
		}
		return queryfixture.Rows([]string{"uid"}, rows...), nil
	})
	old := backend.Db
	backend.Db = db
	t.Cleanup(func() { backend.Db = old })
	got, err := GetTablesVisibleToUser(db, 42)
	if err != nil || len(got) != 1 || !got[10] {
		t.Fatalf("disabled-only dataset visible: %v %v", got, err)
	}
	got, err = GetTablesVisibleToUser(db, 99)
	if err != nil || got != nil {
		t.Fatal("administrator wildcard changed")
	}
}
