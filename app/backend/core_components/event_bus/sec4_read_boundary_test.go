// sec4_read_boundary_test.go
// Exercises the accepted security lows through real handlers with in-memory SQL.
// Connects permission principals and controlled rows without network or installation data.
// Refusals must precede disclosure; administrator behavior remains covered.
package event_bus

import (
	"database/sql/driver"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/dbutils/queryfixture"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSEC4SSEDropsMandatoryHiddenRow(t *testing.T) {
	// system_users owns itself. Row 7 is enabled=false, despite an explicit row allow.
	db := queryfixture.Open(t, func(q string, args []driver.NamedValue) (driver.Rows, error) {
		switch {
		case strings.Contains(q, "must_be_true_unless_own"):
			return queryfixture.Rows([]string{"column_name"}, []driver.Value{"enabled"}), nil
		case strings.Contains(q, `FROM "system_users"`):
			visible := !strings.Contains(q, `"system_users"."enabled" = TRUE`)
			if len(args) > 1 && args[1].Value == int64(7) {
				visible = true
			}
			return queryfixture.Rows([]string{"exists"}, []driver.Value{visible}), nil
		default:
			return queryfixture.Rows([]string{"allowed"}, []driver.Value{true}), nil
		}
	})
	old, oldBasic, oldGuest := backend.Db, backend.DbBasic, backend.DbGuest
	backend.Db, backend.DbBasic, backend.DbGuest = db, db, db
	t.Cleanup(func() { backend.Db, backend.DbBasic, backend.DbGuest = old, oldBasic, oldGuest })
	for _, test := range []struct {
		role string
		id   int
		want bool
	}{{"guest", 1, false}, {"basic", 42, false}, {"basic", 7, true}, {"admin", 42, true}} {
		req := httptest.NewRequest("GET", "/api/sse/subscribe?datasets=system_users", nil)
		req = req.WithContext(dbutils.SetRequestActorContext(req.Context(), dbutils.NewRequestActorContext(test.id, test.role)))
		got := shouldForwardSSEEvent(req, Event{Table: "system_users", RowID: 7, Action: "update"}, authorizeSSEEventRead)
		if got != test.want {
			t.Fatalf("%s %d: flagged row forwarded=%v", test.role, test.id, got)
		}
	}
}
