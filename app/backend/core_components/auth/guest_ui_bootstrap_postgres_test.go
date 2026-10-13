// guest_ui_bootstrap_postgres_test.go
// Verifies authoritative guest UI selection and revocations in disposable PostgreSQL.
// Connects the bootstrap reader to real group, function and scoped-right joins.
// Excludes other memberships, disabled functions, API and dataset-specific grants.
package auth

import (
	"context"
	"reflect"
	"testing"
)

func TestGuestUIBootstrapGrantsAndRevocationPostgres(t *testing.T) {
	db := loginNameDisposableCluster(t)
	// A different group id proves that the group's name, not seed id 3 or
	// account 1's memberships, determines the anonymous UI set.
	if _, err := db.Exec(`
	 UPDATE system_user_groups SET name='old_guest_ui_fixture' WHERE name='guests';
	 INSERT INTO system_user_groups (id,name) VALUES (91020,'guests'),(91021,'guest_ui_other');
	 INSERT INTO system_user_group_memberships (user_id,group_id) VALUES (1,91021);
	 INSERT INTO system_functions (id,name,"package",disabled,specific_table_related,url_route_endpoint,ui_only)
	 VALUES (91020,'guest_ui.details','frontend',false,false,'/ui/article/section/details',true),
	 (91021,'guest_ui.images','frontend',false,false,'/ui/article/section/images',true),
	 (91022,'guest_ui.disabled','frontend',true,false,'/ui/guest-disabled',true),
	 (91023,'guest_ui.api','auth',false,false,'/api/guest-proof',false),
	 (91024,'guest_ui.other','frontend',false,false,'/ui/other-membership',true),
	 (91025,'guest_ui.scoped','frontend',false,true,'/ui/guest-scoped',true);
	 INSERT INTO system_group_table_func_rights (user_group_id,function_id,target_schema_name,target_table_uid)
	 VALUES (91020,91020,'public',NULL),(91020,91022,'public',NULL),
	 (91020,91023,'public',NULL),(91021,91024,'public',NULL);
	 INSERT INTO system_group_table_func_rights (user_group_id,function_id,target_schema_name,target_table_uid)
	 SELECT 91020,91025,'public',table_uid FROM system_db_tables ORDER BY table_uid LIMIT 1;
	`); err != nil {
		t.Fatal(err)
	}
	assertEndpoints := func(want []string) {
		t.Helper()
		got, err := readGuestUIEndpoints(context.Background(), db)
		if err != nil || !reflect.DeepEqual(got, want) {
			t.Fatalf("endpoints=%v want=%v error=%v", got, want, err)
		}
	}
	assertEndpoints([]string{"/ui/article/section/details"})
	if _, err := db.Exec(`INSERT INTO system_group_table_func_rights (user_group_id,function_id,target_schema_name) VALUES (91020,91021,'public')`); err != nil {
		t.Fatal(err)
	}
	assertEndpoints([]string{"/ui/article/section/details", "/ui/article/section/images"})
	if _, err := db.Exec(`DELETE FROM system_group_table_func_rights WHERE user_group_id=91020 AND function_id IN (91020,91021)`); err != nil {
		t.Fatal(err)
	}
	assertEndpoints([]string{})
	// No cached previous grant survives a failed database read.
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	if endpoints, err := readGuestUIEndpoints(context.Background(), db); err == nil || len(endpoints) != 0 {
		t.Fatal(endpoints, err)
	}
}
