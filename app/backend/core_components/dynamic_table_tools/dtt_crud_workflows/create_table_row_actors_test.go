// create_table_row_actors_test.go
// Checks reserved actor declarations before schema work and the editor's marks.
// Connects the ordered creation contract to translated HTTP refusals.
// Actor declarations choose presentation, never physical order or defaults.
package dtt_crud_workflows

import (
	"database/sql/driver"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCreateActorColumnValidation(t *testing.T) {
	yes := true
	for _, column := range []CreateColumnDef{
		{Name: "created_by", DataType: "TEXT"}, {Name: "owner_id", DataType: "INTEGER NOT NULL"}, {Name: "created_by", DataType: "BIGINT DEFAULT 2"},
		{Name: "created_by", DataType: "INTEGER", CardRole: "username"}, {Name: "owner_id", DataType: "BIGINT", CardRole: "details"},
		{Name: "reviewer_id", DataType: "INTEGER", CardRole: "username"}, {Name: "owner_id", DataType: "BIGINT", Sortable: true},
		{Name: "created_by", DataType: "BIGINT", VisibilityGate: true}, {Name: "owner_id", DataType: "BIGINT", IsMultilingual: &yes},
	} {
		body, _ := json.Marshal(CreateTableRequest{TableName: "sample", ColumnList: []CreateColumnDef{{Name: "id", DataType: "SERIAL"}, column}})
		rec := httptest.NewRecorder()
		CreateTableHandler(rec, httptest.NewRequest("POST", "/", strings.NewReader(string(body))))
		if rec.Code != 400 || !strings.Contains(rec.Body.String(), `"error_lang_key":"error_reserved_owner_column"`) {
			t.Fatalf("%+v: %d %s", column, rec.Code, rec.Body)
		}
	}
	for _, name := range []string{"created_by", "owner_id"} {
		for _, typ := range []string{"integer", "BIGINT"} {
			for _, role := range []string{"", "hidden", map[string]string{"created_by": "details", "owner_id": "username"}[name]} {
				list, err := validateCreateColumnList([]CreateColumnDef{{Name: name, DataType: typ, CardRole: role, HideInFilterPanel: true}, {Name: "id", DataType: "SERIAL"}, {Name: "title", DataType: "TEXT"}})
				if err != nil {
					t.Fatal(err)
				}
				got := tableColumnsOf(list)
				if len(got) != 2 || got[0].Name != "id" || got[1].Name != "title" {
					t.Fatalf("actor moved ordinary columns: %v", got)
				}
			}
		}
	}
}
func TestCreateActorForeignKeyRefusal(t *testing.T) {
	for _, target := range []string{`"referenced_dataset":"other","referenced_column":"id"`, `"referenced_dataset":"system_users","referenced_column":"username"`} {
		rec := httptest.NewRecorder()
		CreateTableHandler(rec, httptest.NewRequest("POST", "/", strings.NewReader(`{"dataset_name":"sample","column_list":[{"name":"id","data_type":"SERIAL"}],"foreign_keys":[{"referencing_column":"owner_id",`+target+`}]}`)))
		if rec.Code != 400 || !strings.Contains(rec.Body.String(), "error_reserved_owner_column") {
			t.Fatalf("%d %s", rec.Code, rec.Body)
		}
	}
}
func TestSideTableActorDeclarationRefusedBeforeCreation(t *testing.T) {
	resetWorkflowQueue()
	t.Cleanup(resetWorkflowQueue)
	db := newWorkflowQueueTestDB(t)
	defer db.Close()
	pushWorkflowQuery(queuedWorkflowQuery{cols: []string{"reason"}, rows: [][]driver.Value{{"R1_history"}}})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/", strings.NewReader(`{"dataset_name":"notes_history","column_list":[{"name":"id","data_type":"SERIAL"},{"name":"created_by","data_type":"BIGINT"}]}`))
	CreateTableHandler(rec, withWorkflowTx(req, db))
	if rec.Code != 400 || !strings.Contains(rec.Body.String(), "error_reserved_owner_column") || !strings.Contains(rec.Body.String(), "R1_history") {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
}
func TestModifyActorCardRoleRefusedBeforeWrites(t *testing.T) {
	for _, role := range []map[string]string{{"created_by": "username"}, {"owner_id": "details"}, {"other": "username"}} {
		resetWorkflowQueue()
		t.Cleanup(resetWorkflowQueue)
		db := newWorkflowQueueTestDB(t)
		defer db.Close()
		pushWorkflowQuery(queuedWorkflowQuery{cols: []string{"column_name", "actor_role"}, rows: [][]driver.Value{{"created_by", "creator"}, {"owner_id", "owner"}}})
		body, _ := json.Marshal(map[string]interface{}{"dataset_name": "notes", "column_card_roles": role})
		rec := httptest.NewRecorder()
		req := httptest.NewRequest("POST", "/", strings.NewReader(string(body)))
		ModifyColumnsHandler(rec, withWorkflowTx(req, db))
		if rec.Code != 400 || !strings.Contains(rec.Body.String(), "error_reserved_owner_column") {
			t.Fatalf("%v: %d %s", role, rec.Code, rec.Body)
		}
	}
}

func TestModifyActorColumnChangesReturnTranslatedRefusal(t *testing.T) {
	for _, body := range []string{
		`{"dataset_name":"notes","removed_columns":["created_by"]}`,
		`{"dataset_name":"notes","modified_columns":[{"original_name":"created_by","new_name":"renamed","data_type":"BIGINT"}]}`,
	} {
		db := newWorkflowQueueTestDB(t)
		defer db.Close()
		if strings.Contains(body, "modified_columns") {
			pushWorkflowQuery(queuedWorkflowQuery{cols: []string{"attname"}})
		}
		pushWorkflowQuery(queuedWorkflowQuery{cols: []string{"column_name", "actor_role"}, rows: [][]driver.Value{{"created_by", "creator"}, {"owner_id", "owner"}}})
		rec := httptest.NewRecorder()
		req := httptest.NewRequest("POST", "/", strings.NewReader(body))
		ModifyColumnsHandler(rec, withWorkflowTx(req, db))
		if rec.Code != 400 || !strings.Contains(rec.Body.String(), `"error_lang_key":"error_owner_column_protected"`) {
			t.Fatalf("%s: %d %s", body, rec.Code, rec.Body)
		}
	}
}
