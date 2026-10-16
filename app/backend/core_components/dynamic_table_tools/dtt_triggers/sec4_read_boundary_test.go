// sec4_read_boundary_test.go
// Exercises the accepted security lows through real handlers with in-memory SQL.
// Connects permission principals and controlled rows without network or installation data.
// Refusals must precede disclosure; administrator behavior remains covered.
package dtt_triggers

import (
	"database/sql/driver"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/dbutils/queryfixture"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSEC4TriggersRequireBothReadableDatasets(t *testing.T) {
	db := queryfixture.Open(t, func(q string, args []driver.NamedValue) (driver.Rows, error) {
		if strings.Contains(q, "FROM system_triggers") {
			return queryfixture.Rows([]string{"id", "source_table", "condition", "target_table", "action_values"}, []driver.Value{int64(1), "visible", "true", "visible", "{}"}, []driver.Value{int64(2), "visible", "true", "hidden", "{}"}, []driver.Value{int64(3), "hidden", "true", "visible", "{}"}), nil
		}
		if args[len(args)-1].Value == "visible" {
			return queryfixture.Rows([]string{"allowed"}, []driver.Value{int64(1)}), nil
		}
		return queryfixture.Rows([]string{"allowed"}), nil
	})
	old := backend.Db
	backend.Db = db
	t.Cleanup(func() { backend.Db = old })
	for _, role := range []string{"guest", "basic", "admin"} {
		principal := 42
		if role == "guest" {
			principal = 1
		}
		tx, _ := db.Begin()
		defer tx.Rollback()
		req := httptest.NewRequest("GET", "/api/system_triggers/list?dataset=visible", nil)
		ctx := dbutils.SetTx(req.Context(), tx)
		req = req.WithContext(dbutils.SetRequestActorContext(ctx, dbutils.NewRequestActorContext(principal, role)))
		rec := httptest.NewRecorder()
		GetTriggersHandler(rec, req)
		var got []map[string]any
		err := json.Unmarshal(rec.Body.Bytes(), &got)
		want := 1
		if role == "admin" {
			want = 3
		}
		if rec.Code != 200 || err != nil || len(got) != want {
			t.Fatalf("%s: status=%d rows=%v err=%v", role, rec.Code, got, err)
		}
	}
}
