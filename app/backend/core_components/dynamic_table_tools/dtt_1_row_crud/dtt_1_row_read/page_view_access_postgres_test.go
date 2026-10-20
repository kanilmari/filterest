// page_view_access_postgres_test.go
// Proves the Page permission scope against native disposable PostgreSQL.
// Connects the real permission SQL to the catalogue's own scope and the dataset read right.
// A tableless Page catalogue entry counts a global grant; a dataset-specific one counts only its dataset.
package dtt_1_row_read

import (
	backend "easelect/backend/core_components"
	"easelect/backend/pipeline/access_control"
	"net/http/httptest"
	"testing"
)

func TestPageViewDatasetPermissionPostgres(t *testing.T) {
	db, _ := ownerResolverPostgres(t)
	old := backend.Db
	backend.Db = db
	t.Cleanup(func() { backend.Db = old })
	t.Setenv("FILTEREST_ADMIN_PERMISSION_RECOVERY_MODE", "")
	exec := func(statement string) {
		t.Helper()
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	// Production shape (fintravel 20.10.): the Page function is tableless and granted globally (target NULL);
	// /api/get-results is dataset-specific. system_about is UID 2, app_service_catalog UID 3.
	exec(`CREATE TABLE system_functions(id bigint PRIMARY KEY,url_route_endpoint text,disabled boolean,specific_table_related boolean);
 CREATE TABLE system_group_table_func_rights(user_group_id bigint,function_id bigint,target_table_uid bigint);
 INSERT INTO system_functions VALUES(260,'/ui/view/image_first_page_view',false,false),(261,'/api/get-results',false,true);
 INSERT INTO system_user_group_memberships VALUES(42,260);
 INSERT INTO system_group_table_func_rights VALUES(260,261,2);`)
	page := func(dataset string) bool {
		return allowResultsPresentationRead(httptest.NewRecorder(), dataset, 42, "image_first_page_view")
	}
	readable := func(dataset string) bool {
		return access_control.UserHasFunctionPermissionOnTableQuiet(42, "/api/get-results", dataset, "")
	}
	opens := func(dataset string) bool { return page(dataset) && readable(dataset) }

	// No Page grant at all: 403 with the existing shape.
	denied := httptest.NewRecorder()
	if allowResultsPresentationRead(denied, "system_about", 42, "image_first_page_view") || denied.Code != 403 {
		t.Fatal("Page opened without any Page grant")
	}
	// A dataset-scoped grant does not count for a tableless catalogue entry (canonical scope).
	exec(`INSERT INTO system_group_table_func_rights VALUES(260,260,2)`)
	if page("system_about") {
		t.Fatal("a table-scoped grant authorized a tableless Page route")
	}
	// The global grant (production shape) authorizes the presentation; the dataset read right still decides.
	exec(`DELETE FROM system_group_table_func_rights WHERE function_id=260; INSERT INTO system_group_table_func_rights VALUES(260,260,NULL)`)
	if !opens("system_about") {
		t.Fatal("global Page grant + get-results on the dataset was denied")
	}
	if !page("app_service_catalog") || opens("app_service_catalog") {
		t.Fatal("the dataset read right did not bound the global Page grant")
	}

	// A dataset-specific catalogue entry: only a grant on that dataset counts, another dataset's grant never does.
	exec(`UPDATE system_functions SET specific_table_related=true WHERE id=260`)
	if page("system_about") {
		t.Fatal("a global grant authorized a dataset-specific Page route")
	}
	exec(`DELETE FROM system_group_table_func_rights WHERE function_id=260; INSERT INTO system_group_table_func_rights VALUES(260,260,3)`)
	if page("system_about") {
		t.Fatal("another dataset authorized Page")
	}
	exec(`INSERT INTO system_group_table_func_rights VALUES(260,260,2)`)
	if !opens("system_about") {
		t.Fatal("same dataset grant denied")
	}

	// A disabled function never opens, whatever the grants.
	exec(`UPDATE system_functions SET disabled=true WHERE id=260`)
	if page("system_about") {
		t.Fatal("disabled Page granted")
	}
}
