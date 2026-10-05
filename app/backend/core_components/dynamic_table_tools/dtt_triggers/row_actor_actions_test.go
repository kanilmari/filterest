// row_actor_actions_test.go
// Checks stored and newly configured automations at the actor boundary.
// Connects the trigger handler and SQL action writer to the same marks.
// Actor templates are stripped before expansion and use the request-local SQL function.
package dtt_triggers

import (
	"database/sql"
	"database/sql/driver"
	"easelect/backend/core_components/dbutils"
	"encoding/json"
	"fmt"
	"io"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type actorActionRows struct {
	cols  []string
	rows  [][]driver.Value
	index int
}

func (r *actorActionRows) Columns() []string { return r.cols }
func (r *actorActionRows) Close() error      { return nil }
func (r *actorActionRows) Next(dest []driver.Value) error {
	if r.index == len(r.rows) {
		return io.EOF
	}
	copy(dest, r.rows[r.index])
	r.index++
	return nil
}
func TestTriggerActorsAreRefusedOrServerStamped(t *testing.T) {
	state := &triggerAccountTargetState{actorRows: [][]driver.Value{{"created_by", "creator"}, {"user_id", "owner"}}}
	name := fmt.Sprintf("actor-actions-%d", time.Now().UnixNano())
	sql.Register(name, &triggerAccountTargetDriver{state})
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
	for _, column := range []string{"created_by", "user_id"} {
		body, _ := json.Marshal(Trigger{SourceTable: "notes", TargetTable: "notes", ActionValues: fmt.Sprintf(`{%q:99}`, column)})
		req := httptest.NewRequest("POST", "/", strings.NewReader(string(body)))
		rec := httptest.NewRecorder()
		CreateTriggerHandler(rec, req.WithContext(dbutils.SetTx(req.Context(), tx)))
		if rec.Code != 400 || !strings.Contains(rec.Body.String(), `"error_lang_key":"error_trigger_actor_column"`) || len(state.inserted) != 0 {
			t.Fatalf("%s: %d %s", column, rec.Code, rec.Body)
		}
	}
	t.Cleanup(func() { reportedActorTriggerActions.Delete(100); reportedActorTriggerActions.Delete(101) })
	for _, values := range []string{`{"created_by":"{{missing}}","user_id":99,"title":"{{title}}"}`, `{"title":"{{title}}"}`} {
		if err := executeAction(tx, 100, "notes", values, map[string]interface{}{"title": "copied"}); err != nil {
			t.Fatal(err)
		}
		if strings.Count(state.actionQuery, "public.app_request_actor_id()") != 2 || !strings.Contains(state.actionQuery, `"created_by"`) || !strings.Contains(state.actionQuery, `"user_id"`) || len(state.actionArgs) != 1 || state.actionArgs[0].Value != "copied" {
			t.Fatalf("%s %+v", state.actionQuery, state.actionArgs)
		}
	}

	// Two stored triggers with identical actions each receive their own warning.
	if err := executeAction(tx, 101, "notes", `{"created_by":99,"title":"copied"}`, nil); err != nil {
		t.Fatal(err)
	}
	for _, id := range []int{100, 101} {
		if _, reported := reportedActorTriggerActions.Load(id); !reported {
			t.Fatalf("trigger %d was not reported", id)
		}
	}
}
