// notification_trigger_endpoints_test.go
// Proves the automation handler rejects either unresolved endpoint before writes.
// Extends the existing grant-boundary fixture with real handler preflight queries.
// Missing source, target and both endpoints return a translated 400 refusal.
package dtt_triggers

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/runtime_grants/granttest"
	"fmt"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

type automationEndpointDriver struct {
	state   *triggerAccountTargetState
	checked *[]string
}
type automationEndpointConn struct {
	triggerAccountTargetConn
	checked *[]string
}

func (d automationEndpointDriver) Open(string) (driver.Conn, error) {
	return &automationEndpointConn{triggerAccountTargetConn{state: d.state}, d.checked}, nil
}

func (c *automationEndpointConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if strings.HasPrefix(query, "SELECT EXISTS(SELECT 1 FROM public.system_db_tables") {
		name := args[0].Value.(string)
		*c.checked = append(*c.checked, name)
		return &actorActionRows{cols: []string{"exists"}, rows: [][]driver.Value{{name == "present"}}}, nil
	}
	return c.triggerAccountTargetConn.QueryContext(ctx, query, args)
}

func TestCreateAutomationRejectsMissingEndpointsBeforeWrite(t *testing.T) {
	granttest.ConfigureRoles(t)
	for _, tc := range []struct {
		source, target, refused string
		checks                  int
	}{
		{"missing_source", "present", "source", 1},
		{"present", "missing_target", "target", 2},
		{"missing_source", "missing_target", "source", 1},
	} {
		t.Run(tc.source+"/"+tc.target, func(t *testing.T) {
			state := &triggerAccountTargetState{}
			var checked []string
			name := fmt.Sprintf("automation_endpoint_%d", atomic.AddInt64(&triggerAccountTargetDriverCounter, 1))
			sql.Register(name, automationEndpointDriver{state, &checked})
			db, err := sql.Open(name, "")
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			tx, err := db.Begin()
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			body := fmt.Sprintf(`{"source_dataset":%q,"target_dataset":%q,"condition":"true","action_values":"{}"}`, tc.source, tc.target)
			req := httptest.NewRequest("POST", "/api/system_triggers/create", strings.NewReader(body))
			req = req.WithContext(dbutils.SetTx(req.Context(), tx))
			rec := httptest.NewRecorder()
			CreateTriggerHandler(granttest.Recorder{ResponseRecorder: rec}, req)
			if rec.Code != 400 || !strings.Contains(rec.Body.String(), "error_trigger_"+tc.refused+"_dataset_missing") || !strings.Contains(rec.Body.String(), "dataset does not exist") {
				t.Fatal(rec.Code, rec.Body)
			}
			if len(checked) != tc.checks || len(state.checked) != 0 || len(state.inserted) != 0 {
				t.Fatal("invalid endpoint reached writes or account checks", checked, state)
			}
		})
	}
}
