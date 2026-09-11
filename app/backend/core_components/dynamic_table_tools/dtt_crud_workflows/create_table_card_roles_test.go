package dtt_crud_workflows

import (
	"database/sql"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func TestCreationCardRolesValidateBeforeAnyTransaction(t *testing.T) {
	for _, payload := range []string{
		`{"dataset_name":"sample","columns":{"id":"SERIAL"},"column_card_roles":{"id":"unsupported"}}`,
		`{"dataset_name":"sample","columns":{"id":"SERIAL"},"column_card_roles":{"missing":"header"}}`,
		`{"dataset_name":"sample","columns":{"id":"SERIAL"},"column_card_roles":{"id":42}}`,
	} {
		// No transaction context exists: validation must reject before schema work.
		req := httptest.NewRequest(http.MethodPost, "/api/create_dataset", strings.NewReader(payload))
		rec := httptest.NewRecorder()
		CreateTableHandler(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status=%d body=%s", rec.Code, rec.Body)
		}
	}
}

func TestCreationCardRolesKeepLegacyDefaultsAndAcceptExistingVariants(t *testing.T) {
	columns := map[string]string{"id": "SERIAL", "title": "TEXT"}
	for _, roles := range []map[string]string{nil, {}, {"title": ""},
		{"title": "header+lang_key"}, {"title": "description2,details_link10"}} {
		if err := validateCreationCardRoles(roles, columns); err != nil {
			t.Fatal(err)
		}
	}
	q := &roleRecorder{}
	if err := applyCreationCardRoles(q, "sample", nil); err != nil || len(q.args) != 0 {
		t.Fatal("omitted roles should not change metadata defaults")
	}
	if err := validateCreationCardRoles(map[string]string{"title": strings.Repeat("details,", 40) + "details"}, columns); err == nil {
		t.Fatal("oversize role must fail before the transaction")
	}
}

type roleRecorder struct {
	args [][]interface{}
	rows int64
	err  error
}

func (q *roleRecorder) Exec(query string, args ...interface{}) (sql.Result, error) {
	if !strings.Contains(query, "dt.schema_name = current_schema()") {
		panic("missing schema scope")
	}
	q.args = append(q.args, args)
	return &workflowQueueResult{rowsAffected: q.rows}, q.err
}
func (*roleRecorder) Query(string, ...interface{}) (*sql.Rows, error) { panic("unexpected query") }
func (*roleRecorder) QueryRow(string, ...interface{}) *sql.Row        { panic("unexpected query row") }

func TestCreationCardRoleAssignmentChecksEveryTargetAndUsesBoundValues(t *testing.T) {
	q := &roleRecorder{rows: 1}
	err := applyCreationCardRoles(q, "Sample", map[string]string{"Title": "header", "id": "details"})
	if err != nil {
		t.Fatal(err)
	}
	expected := [][]interface{}{{"header", false, "sample", "title"}, {"details", true, "sample", "id"}}
	if !reflect.DeepEqual(q.args, expected) {
		t.Fatalf("args=%v", q.args)
	}
	for _, q := range []*roleRecorder{{rows: 0}, {rows: 2}, {err: errors.New("write failed")}} {
		if err := applyCreationCardRoles(q, "sample", map[string]string{"title": "header"}); err == nil {
			t.Fatal("unmatched/failed assignment must abort creation")
		}
	}
}

func TestCreationRoleDefaultsKeepAdditionalInformationLabelsVisible(t *testing.T) {
	q := &roleRecorder{rows: 1}
	roles := map[string]string{"id": "details", "location": "details_link10", "title": "header",
		"description": "description", "keywords": "keywords", "image": "image"}
	if err := applyCreationCardRoles(q, "sample", roles); err != nil {
		t.Fatal(err)
	}
	wanted := map[string]interface{}{"id": true, "location": true, "title": false, "description": false, "keywords": false, "image": nil}
	for _, args := range q.args {
		if args[1] != wanted[args[3].(string)] {
			t.Fatalf("initial key flag = %v", args)
		}
	}
}
