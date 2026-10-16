// initial_card_roles_postgres_test.go
// Proves creation defaults, explicit choices and preservation on disposable PostgreSQL.
// Exercises the same transaction used by the form and direct create_dataset callers.
// Keeps existing datasets and subsequent Card visibility edits outside inference.
package dtt_crud_workflows

import (
	"database/sql"
	"net/http"
	"reflect"
	"testing"
)

func readCreationRoles(t *testing.T, db *sql.DB, table string) map[string]string {
	t.Helper()
	rows, err := db.Query(`SELECT c.column_name,c.card_element FROM system_column_details c
 JOIN system_db_tables d USING(table_uid) WHERE d.table_name=$1 AND d.schema_name='public'`, table)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	roles := map[string]string{}
	for rows.Next() {
		var name, role string
		if err := rows.Scan(&name, &role); err != nil {
			t.Fatal(err)
		}
		roles[name] = role
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return roles
}

func TestInitialCardRolesCreationAndExistingDatasetsPostgres(t *testing.T) {
	db, _ := registrationDisposableDB(t)
	loadPublicBootstrap(t, db)
	request := `{"dataset_name":"wl962_calendar","folder_id":4,"column_list":[
 {"name":"id","data_type":"SERIAL"},{"name":"title","data_type":"TEXT"},
 {"name":"name","data_type":"VARCHAR(80)"},{"name":"content","data_type":"TEXT"},
 {"name":"starts_at","data_type":"TIMESTAMPTZ"}]}`
	if rec := postCreateDataset(t, db, request); rec.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", rec.Code, rec.Body)
	}
	want := map[string]string{"id": "details", "title": "header", "name": "details",
		"content": "description", "starts_at": "details", "created_by": "hidden", "owner_id": "hidden"}
	if got := readCreationRoles(t, db, "wl962_calendar"); !reflect.DeepEqual(got, want) {
		t.Fatalf("defaults=%v want=%v", got, want)
	}
	// The page edits this same metadata; creation later must not rewrite it.
	if err := applyColumnCardRoles(db, "wl962_calendar", map[string]string{"title": "details", "name": "header"}); err != nil {
		t.Fatal(err)
	}
	before := readCreationRoles(t, db, "wl962_calendar")
	if rec := postCreateDataset(t, db, `{"dataset_name":"wl962_explicit","folder_id":4,"column_list":[
 {"name":"id","data_type":"SERIAL"},{"name":"name","data_type":"TEXT","card_role":"hidden"},
 {"name":"title","data_type":"TEXT","card_role":"header+lang_key"},
 {"name":"label","data_type":"TEXT","card_role":"header"},
 {"name":"description","data_type":"TEXT","card_role":"details"}]}`); rec.Code != http.StatusCreated {
		t.Fatalf("explicit: %d %s", rec.Code, rec.Body)
	}
	got := readCreationRoles(t, db, "wl962_explicit")
	if got["name"] != "hidden" || got["title"] != "header+lang_key" || got["label"] != "header" || got["description"] != "details" {
		t.Fatalf("explicit roles=%v", got)
	}
	if rec := postCreateDataset(t, db, request); rec.Code < 400 {
		t.Fatal("existing dataset accepted as new")
	}
	if after := readCreationRoles(t, db, "wl962_calendar"); !reflect.DeepEqual(before, after) {
		t.Fatalf("existing roles changed: %v -> %v", before, after)
	}
}
