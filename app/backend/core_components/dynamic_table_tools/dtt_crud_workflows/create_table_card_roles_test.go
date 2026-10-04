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
		`{"dataset_name":"sample","column_list":[{"name":"id","data_type":"SERIAL","card_role":"unsupported"}]}`,
		`{"dataset_name":"sample","column_list":[{"name":"id","data_type":"SERIAL","card_role":42}]}`,
		`{"dataset_name":"sample","column_list":[{"name":"id","data_type":"SERIAL","card_role":"` + strings.Repeat("details,", 40) + `details"}]}`,
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
	for _, role := range []string{"", "header+lang_key", "description2,details_link10"} {
		list := []CreateColumnDef{{Name: "id", DataType: "SERIAL"}, {Name: "title", DataType: "TEXT", CardRole: role}}
		validated, err := validateCreateColumnList(list)
		if err != nil {
			t.Fatal(err)
		}
		if roles := cardRolesOf(validated); role == "" && len(roles) != 0 {
			t.Fatalf("a column without a role must keep the default, got %v", roles)
		}
	}
	q := &roleRecorder{}
	if err := applyColumnCardRoles(q, "sample", cardRolesOf([]CreateColumnDef{{Name: "title", DataType: "TEXT"}})); err != nil || len(q.args) != 0 {
		t.Fatal("omitted roles should not change metadata defaults")
	}
	oversize := []CreateColumnDef{{Name: "title", DataType: "TEXT", CardRole: strings.Repeat("details,", 40) + "details"}}
	if _, err := validateCreateColumnList(oversize); err == nil {
		t.Fatal("oversize role must fail before the transaction")
	}
}

type roleRecorder struct {
	args    [][]interface{}
	queries []string
	rows    int64
	err     error
}

func (q *roleRecorder) Exec(query string, args ...interface{}) (sql.Result, error) {
	if !strings.Contains(query, "dt.schema_name = current_schema()") {
		panic("missing schema scope")
	}
	q.args = append(q.args, args)
	q.queries = append(q.queries, query)
	return &workflowQueueResult{rowsAffected: q.rows}, q.err
}
func (*roleRecorder) Query(string, ...interface{}) (*sql.Rows, error) { panic("unexpected query") }
func (*roleRecorder) QueryRow(string, ...interface{}) *sql.Row        { panic("unexpected query row") }

func TestCreationCardRoleAssignmentChecksEveryTargetAndUsesBoundValues(t *testing.T) {
	q := &roleRecorder{rows: 1}
	err := applyColumnCardRoles(q, "Sample", map[string]string{"Title": "header", "id": "details"})
	if err != nil {
		t.Fatal(err)
	}
	expected := [][]interface{}{{"header", "sample", "title"}, {"details", "sample", "id"}}
	if !reflect.DeepEqual(q.args, expected) {
		t.Fatalf("args=%v", q.args)
	}
	for _, q := range []*roleRecorder{{rows: 0}, {rows: 2}, {err: errors.New("write failed")}} {
		if err := applyColumnCardRoles(q, "sample", map[string]string{"title": "header"}); err == nil {
			t.Fatal("unmatched/failed assignment must abort creation")
		}
	}
}

func TestCreationRoleAssignmentPreservesRawLabelOverrides(t *testing.T) {
	q := &roleRecorder{rows: 1}
	roles := map[string]string{"id": "details", "location": "details_link10", "title": "header",
		"description": "description", "keywords": "keywords", "image": "image"}
	if err := applyColumnCardRoles(q, "sample", roles); err != nil {
		t.Fatal(err)
	}
	for index, args := range q.args {
		if len(args) != 3 || args[0] != roles[args[2].(string)] {
			t.Fatalf("role arguments = %v", args)
		}
		if strings.Contains(q.queries[index], "show_key_on_card") {
			t.Fatal("role assignment must not materialize or overwrite raw label choices")
		}
	}
}

// A change to an existing dataset carries only the roles it sets, without the
// dataset's full column list, so the role values themselves are what is checked.
func TestValidateCardRoleValuesAcceptsSupportedRolesOnly(t *testing.T) {
	if err := validateCardRoleValues(map[string]string{"title": "header", "note": "details"}); err != nil {
		t.Fatalf("supported roles were refused: %v", err)
	}
	if err := validateCardRoleValues(nil); err != nil {
		t.Fatalf("no roles must be accepted: %v", err)
	}
	if err := validateCardRoleValues(map[string]string{"title": "not_a_role"}); err == nil {
		t.Fatal("an unsupported role must be refused")
	}
	if err := validateCardRoleValues(map[string]string{"  ": "header"}); err == nil {
		t.Fatal("a role without a column must be refused")
	}
}
