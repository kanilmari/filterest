// Tests the dataset-level deletion-protection switch that both dataset forms show.
package dtt_crud_workflows

import (
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

type protectionRecorder struct {
	*sql.DB
	args [][]interface{}
	rows int64
	err  error
}

func (q *protectionRecorder) Exec(query string, args ...interface{}) (sql.Result, error) {
	if !strings.Contains(query, "schema_name = current_schema()") {
		panic("missing schema scope")
	}
	q.args = append(q.args, args)
	return &workflowQueueResult{rowsAffected: q.rows}, q.err
}

func TestDeletionProtectionOnlyWritesWhenTheFormSendsAChoice(t *testing.T) {
	quiet := &protectionRecorder{rows: 1}
	if err := applyDatasetDeletionProtection(quiet, "sample", nil); err != nil || len(quiet.args) != 0 {
		t.Fatalf("an omitted switch must leave the dataset alone: err=%v args=%v", err, quiet.args)
	}

	protect, allow := true, false
	for _, testCase := range []struct {
		choice   *bool
		expected []interface{}
	}{
		{&protect, []interface{}{false, "sample"}},
		{&allow, []interface{}{true, "sample"}},
	} {
		recorder := &protectionRecorder{rows: 1}
		if err := applyDatasetDeletionProtection(recorder, "Sample", testCase.choice); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(recorder.args, [][]interface{}{testCase.expected}) {
			t.Fatalf("args = %v, want %v", recorder.args, testCase.expected)
		}
	}
}

func TestDeletionProtectionRefusesAnUnmatchedOrFailedWrite(t *testing.T) {
	protect := true
	for _, recorder := range []*protectionRecorder{{rows: 0}, {rows: 2}, {rows: 1, err: errors.New("write failed")}} {
		if err := applyDatasetDeletionProtection(recorder, "sample", &protect); err == nil {
			t.Fatal("a write that did not reach exactly one dataset must abort the save")
		}
	}
}

func TestDeletionProtectionIsTheOppositeOfRemovability(t *testing.T) {
	for _, testCase := range []struct {
		removable bool
		expected  bool
	}{{removable: true, expected: false}, {removable: false, expected: true}} {
		db := newWorkflowQueueTestDB(t)
		pushWorkflowQuery(queuedWorkflowQuery{
			cols: []string{"is_removable"},
			rows: [][]driver.Value{{testCase.removable}},
		})
		prevented, err := readDatasetDeletionProtection(db, "sample")
		if err != nil {
			t.Fatal(err)
		}
		if prevented != testCase.expected {
			t.Fatalf("removable=%v reported prevent_deletion=%v", testCase.removable, prevented)
		}
		db.Close()
	}
}

func TestDatasetSettingsReadRefusesAMissingOrUnsafeName(t *testing.T) {
	for _, target := range []string{"/api/modify-columns", "/api/modify-columns?dataset_name=%20", "/api/modify-columns?dataset_name=drop;table"} {
		req := httptest.NewRequest(http.MethodGet, target, nil)
		rec := httptest.NewRecorder()
		ModifyColumnsHandler(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%s: status = %d, want 400", target, rec.Code)
		}
	}
}

func TestModifyColumnsCarriesTheDeletionSwitchOnlyWhenItIsSent(t *testing.T) {
	var silent ModifyColumnsRequest
	if err := json.Unmarshal([]byte(`{"dataset_name":"demo"}`), &silent); err != nil {
		t.Fatal(err)
	}
	if silent.PreventDeletion != nil {
		t.Fatal("a request without the switch must not change the dataset's protection")
	}

	var explicit ModifyColumnsRequest
	if err := json.Unmarshal([]byte(`{"dataset_name":"demo","prevent_deletion":true}`), &explicit); err != nil {
		t.Fatal(err)
	}
	if explicit.PreventDeletion == nil || !*explicit.PreventDeletion {
		t.Fatalf("switch = %v, want true", explicit.PreventDeletion)
	}
}

func TestCreationCarriesTheDatasetLanguageDefaultInAFixedOrder(t *testing.T) {
	var request CreateTableRequest
	if err := json.Unmarshal([]byte(`{"dataset_name":"demo","columns":{"id":"SERIAL"},"new_columns_multilingual":true}`), &request); err != nil {
		t.Fatal(err)
	}
	if request.NewColumnsMultilingual == nil || !*request.NewColumnsMultilingual {
		t.Fatalf("language default = %v, want true", request.NewColumnsMultilingual)
	}

	listed := createdColumnsForLanguageDefaults(map[string]string{"title": "TEXT", "id": "SERIAL", "code": "VARCHAR(30)"})
	names := make([]string, 0, len(listed))
	for _, column := range listed {
		names = append(names, column.NewName)
	}
	if !reflect.DeepEqual(names, []string{"code", "id", "title"}) {
		t.Fatalf("columns = %v, want a fixed alphabetical order", names)
	}
	if listed[2].DataType != "TEXT" {
		t.Fatalf("type = %q, want the created column's own type", listed[2].DataType)
	}
}
