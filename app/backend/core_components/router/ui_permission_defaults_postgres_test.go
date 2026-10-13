// ui_permission_defaults_postgres_test.go
// Proves article defaults, reader revocation and administrator restoration in disposable PostgreSQL.
// Connects route reconciliation and the administrator safety net in startup order.
// Opens no database until the explicit disposable-test opt-in is present.
package router

import (
	"testing"

	backend "easelect/backend/core_components"
)

func TestArticleUIPermissionDefaultsPostgres(t *testing.T) {
	db := routeIdentityDisposableDB(t)
	if _, err := db.Exec(`
		ALTER TABLE system_functions ADD creation_spec text;
		ALTER TABLE system_group_table_func_rights ADD user_group_id integer,
		 ADD target_schema_name text, ADD creation_spec text, ADD target_table_uid integer;
		CREATE UNIQUE INDEX global_ui_grants ON system_group_table_func_rights (user_group_id, function_id) WHERE target_table_uid IS NULL;
		CREATE TABLE system_user_groups (id integer PRIMARY KEY, name text UNIQUE);
		INSERT INTO system_user_groups VALUES (10,'admins'), (20,'users'), (30,'guests'), (40,'custom');
		INSERT INTO system_functions (name,"package",disabled,specific_table_related,url_route_endpoint,ui_only)
		 VALUES ('ui.view.card','frontend',false,false,'/ui/view/card',true);
		INSERT INTO system_group_table_func_rights (user_group_id,function_id,target_schema_name)
		 SELECT 40,id,'public' FROM system_functions WHERE name='ui.view.card';
	`); err != nil {
		t.Fatal(err)
	}
	if err := ReactivateUIRoutes(db); err != nil {
		t.Fatal(err)
	}
	for _, route := range canonicalUIPermissionRoutes {
		if route.DefaultGrantGroups == "" {
			continue
		}
		for _, group := range []string{"admins", "users", "guests", "custom"} {
			var allowed bool
			if err := db.QueryRow(`SELECT EXISTS (
			 SELECT 1 FROM system_group_table_func_rights rights
			 JOIN system_functions fn ON fn.id=rights.function_id
			 JOIN system_user_groups groups ON groups.id=rights.user_group_id
			 WHERE fn.name=$1 AND groups.name=$2 AND rights.target_table_uid IS NULL
			 AND rights.target_schema_name='public')`, route.Name, group).Scan(&allowed); err != nil {
				t.Fatal(err)
			}
			want := group == "admins" || (route.DefaultGrantGroups == "readers" && (group == "users" || group == "guests"))
			if allowed != want {
				t.Fatalf("%s/%s allowed=%t want=%t", route.Name, group, allowed, want)
			}
		}
	}
	if _, err := db.Exec(`
	 DELETE FROM system_group_table_func_rights WHERE function_id=(SELECT id FROM system_functions WHERE name='ui.article.section.details') AND user_group_id IN (20,30);
	 INSERT INTO system_group_table_func_rights (user_group_id,function_id,target_schema_name)
	 SELECT 20,id,'public' FROM system_functions WHERE name='ui.article.section.images';
	 UPDATE system_functions SET disabled=true WHERE name='ui.article.section.details';
	`); err != nil {
		t.Fatal(err)
	}
	if err := ReactivateUIRoutes(db); err != nil {
		t.Fatal(err)
	}
	var revoked, granted, unrelated int
	if err := db.QueryRow(`SELECT count(*) FROM system_group_table_func_rights rights JOIN system_functions fn ON fn.id=rights.function_id WHERE fn.name='ui.article.section.details' AND rights.user_group_id IN (20,30)`).Scan(&revoked); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT count(*) FROM system_group_table_func_rights rights JOIN system_functions fn ON fn.id=rights.function_id WHERE fn.name='ui.article.section.images' AND rights.user_group_id=20`).Scan(&granted); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT count(*) FROM system_group_table_func_rights rights JOIN system_functions fn ON fn.id=rights.function_id WHERE fn.name='ui.view.card' AND rights.user_group_id=40`).Scan(&unrelated); err != nil {
		t.Fatal(err)
	}
	if revoked != 0 || granted != 1 || unrelated != 1 {
		t.Fatalf("revoked/granted/unrelated = %d/%d/%d", revoked, granted, unrelated)
	}
}

func TestArticleUIPermissionStartupRestoresAdminsAndPreservesReaderRevocationsPostgres(t *testing.T) {
	db := routeIdentityDisposableDB(t)
	if _, err := db.Exec(`
		ALTER TABLE system_functions ADD creation_spec text;
		ALTER TABLE system_group_table_func_rights ADD user_group_id integer,
		 ADD target_schema_name text, ADD creation_spec text, ADD target_table_uid integer;
		CREATE UNIQUE INDEX global_ui_grants ON system_group_table_func_rights (user_group_id, function_id) WHERE target_table_uid IS NULL;
		CREATE TABLE system_user_groups (id integer PRIMARY KEY, name text UNIQUE);
		INSERT INTO system_user_groups VALUES (1,'admins'), (20,'users'), (30,'guests');
	`); err != nil {
		t.Fatal(err)
	}
	// Exercise the permission startup steps in application_runtime/startup_sequence.go
	// order, including the safety net that reconciliation-only tests do not cover.
	runPermissionStartup := func(t *testing.T) {
		t.Helper()
		if err := ReactivateUIRoutes(db); err != nil {
			t.Fatal(err)
		}
		if err := backend.EnsureAdminPermissions(db); err != nil {
			t.Fatal(err)
		}
	}
	assertGrants := func(t *testing.T, adminsAllowed, detailsReadersAllowed bool) {
		t.Helper()
		for _, route := range canonicalUIPermissionRoutes {
			if route.DefaultGrantGroups == "" && route.Name != "ui.view.price_chart" {
				continue
			}
			for _, group := range []string{"admins", "users", "guests"} {
				var grants int
				if err := db.QueryRow(`SELECT count(*)
				 FROM system_group_table_func_rights rights
				 JOIN system_functions fn ON fn.id=rights.function_id
				 JOIN system_user_groups groups ON groups.id=rights.user_group_id
				 WHERE fn.name=$1 AND groups.name=$2 AND rights.target_table_uid IS NULL
				 AND rights.target_schema_name='public'`, route.Name, group).Scan(&grants); err != nil {
					t.Fatal(err)
				}
				want := 0
				if (group == "admins" && adminsAllowed) || (group != "admins" && detailsReadersAllowed && route.DefaultGrantGroups == "readers") {
					want = 1
				}
				if grants != want {
					t.Fatalf("%s/%s grants=%d want=%d", route.Name, group, grants, want)
				}
			}
		}
	}

	runPermissionStartup(t)
	assertGrants(t, true, true)
	// Revoke all article grants and Chart's administrator grant, then simulate
	// a disabled Details route. Startup must reactivate it without reseeding readers.
	if _, err := db.Exec(`
	 DELETE FROM system_group_table_func_rights rights USING system_functions fn
	 WHERE fn.id=rights.function_id AND (fn.name LIKE 'ui.article.%' OR fn.name='ui.view.price_chart');
	 UPDATE system_functions SET disabled=true WHERE name='ui.article.section.details';
	`); err != nil {
		t.Fatal(err)
	}
	assertGrants(t, false, false)
	for _, name := range []string{"restart", "repeated restart"} {
		t.Run(name, func(t *testing.T) {
			runPermissionStartup(t)
			assertGrants(t, true, false)
		})
	}
}
