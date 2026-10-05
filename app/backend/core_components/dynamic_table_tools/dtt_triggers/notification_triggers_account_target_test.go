// notification_triggers_account_target_test.go
// Verifies that the automation editor refuses an automation whose destination is an account or rights table.
// Bridges CreateTriggerHandler with the account-table check of the start-up step (WL124 stage 2a).
// Exists because an automation writes on the caller's own connection without a route check on its destination.
package dtt_triggers

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"easelect/backend/core_components/dbutils"
)

type triggerAccountTargetState struct {
	actorRows     [][]driver.Value
	actionQuery   string
	actionArgs    []driver.NamedValue
	accountTables map[string]bool
	queryErr      error
	checked       []string
	inserted      []string
}

type triggerAccountTargetDriver struct{ state *triggerAccountTargetState }
type triggerAccountTargetConn struct{ state *triggerAccountTargetState }
type triggerAccountTargetTx struct{}
type triggerAccountTargetRows struct {
	value bool
	done  bool
}

var triggerAccountTargetDriverCounter int64

func (driverInstance *triggerAccountTargetDriver) Open(string) (driver.Conn, error) {
	return &triggerAccountTargetConn{state: driverInstance.state}, nil
}

func (*triggerAccountTargetConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("prepare is not supported")
}

func (*triggerAccountTargetConn) Close() error { return nil }

func (*triggerAccountTargetConn) Begin() (driver.Tx, error) { return triggerAccountTargetTx{}, nil }

func (connection *triggerAccountTargetConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if strings.Contains(query, "AS roles(actor_role)") {
		return &actorActionRows{cols: []string{"column_name", "actor_role"}, rows: connection.state.actorRows}, nil
	}
	if strings.Contains(query, "FROM information_schema.tables") {
		return &actorActionRows{cols: []string{"exists"}, rows: [][]driver.Value{{false}}}, nil
	}
	if strings.HasPrefix(query, "SHOW myapp.trigger_session_var") {
		return &actorActionRows{cols: []string{"setting"}, rows: [][]driver.Value{{""}}}, nil
	}
	if strings.Contains(query, "system_foreign_key_relations_1_m") {
		return &actorActionRows{cols: []string{"empty"}}, nil
	}
	if !strings.Contains(query, "relation.relname::text = btrim($5::text)") || len(args) != 5 {
		return nil, fmt.Errorf("unexpected query: %s", query)
	}
	if connection.state.queryErr != nil {
		return nil, connection.state.queryErr
	}
	name, _ := args[4].Value.(string)
	connection.state.checked = append(connection.state.checked, name)
	return &triggerAccountTargetRows{value: connection.state.accountTables[strings.TrimSpace(name)]}, nil
}

func (connection *triggerAccountTargetConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	if strings.HasPrefix(query, `INSERT INTO "notes"`) {
		connection.state.actionQuery = query
		connection.state.actionArgs = append([]driver.NamedValue(nil), args...)
		return driver.RowsAffected(1), nil
	}
	if !strings.Contains(query, "INSERT INTO system_triggers") || len(args) != 4 {
		return nil, fmt.Errorf("unexpected statement: %s", query)
	}
	target, _ := args[2].Value.(string)
	connection.state.inserted = append(connection.state.inserted, target)
	return driver.RowsAffected(1), nil
}

func (triggerAccountTargetTx) Commit() error   { return nil }
func (triggerAccountTargetTx) Rollback() error { return nil }

func (*triggerAccountTargetRows) Columns() []string { return []string{"exists"} }
func (*triggerAccountTargetRows) Close() error      { return nil }
func (rows *triggerAccountTargetRows) Next(dest []driver.Value) error {
	if rows.done {
		return io.EOF
	}
	rows.done = true
	dest[0] = rows.value
	return nil
}

func TestCreateTriggerHandlerRefusesAccountTableTarget(t *testing.T) {
	for _, testCase := range []struct {
		name         string
		target       string
		queryErr     error
		wantStatus   int
		wantBody     string
		wantInserted []string
	}{
		{name: "a membership table", target: "system_user_group_memberships", wantStatus: http.StatusBadRequest, wantBody: "automation_target_account_table_not_allowed"},
		{name: "a view over the users, padded", target: " user_names ", wantStatus: http.StatusBadRequest, wantBody: "automation_target_account_table_not_allowed"},
		{name: "an ordinary dataset", target: "notes", wantStatus: http.StatusCreated, wantBody: "Heräte luotu onnistuneesti", wantInserted: []string{"notes"}},
		{name: "the check cannot read the catalog", target: "notes", queryErr: errors.New("catalog unavailable"), wantStatus: http.StatusInternalServerError, wantBody: "error checking trigger target"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			state := &triggerAccountTargetState{
				accountTables: map[string]bool{"system_user_group_memberships": true, "user_names": true},
				queryErr:      testCase.queryErr,
			}
			driverName := fmt.Sprintf("trigger_account_target_%d", atomic.AddInt64(&triggerAccountTargetDriverCounter, 1))
			sql.Register(driverName, &triggerAccountTargetDriver{state: state})
			database, err := sql.Open(driverName, "")
			if err != nil {
				t.Fatalf("sql.Open: %v", err)
			}
			defer database.Close()
			tx, err := database.Begin()
			if err != nil {
				t.Fatalf("Begin: %v", err)
			}
			defer tx.Rollback()

			body := fmt.Sprintf(`{"source_dataset":"notes","condition":"title = 'x'","target_dataset":%q,"action_values":"{}"}`, testCase.target)
			request := httptest.NewRequest(http.MethodPost, "/api/system_triggers/create", strings.NewReader(body))
			request = request.WithContext(dbutils.SetTx(request.Context(), tx))
			recorder := httptest.NewRecorder()

			CreateTriggerHandler(recorder, request)

			if recorder.Code != testCase.wantStatus || !strings.Contains(recorder.Body.String(), testCase.wantBody) {
				t.Fatalf("response = %d %q, want %d containing %q", recorder.Code, recorder.Body.String(), testCase.wantStatus, testCase.wantBody)
			}
			if strings.Join(state.inserted, ",") != strings.Join(testCase.wantInserted, ",") {
				t.Fatalf("stored automations = %v, want %v", state.inserted, testCase.wantInserted)
			}
			if testCase.queryErr == nil && (len(state.checked) != 1 || state.checked[0] != testCase.target) {
				t.Fatalf("checked destinations = %q, want [%q]", state.checked, testCase.target)
			}
		})
	}
}
