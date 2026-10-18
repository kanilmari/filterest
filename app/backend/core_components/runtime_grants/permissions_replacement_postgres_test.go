// permissions_replacement_postgres_test.go
// Proves full permission saves preserve grants absent from the legacy editor.
// Uses the shared disposable bootstrap and real HTTP transaction/reconciliation.
// Checks exact enabled sets, scope isolation, empty saves and repeated hidden grants.
package runtime_grants_test

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"reflect"
	"testing"

	backend "easelect/backend/core_components"
	. "easelect/backend/core_components/runtime_grants"
)

func TestPermissionReplacementPreservesDisabledGrantsPostgres(t *testing.T) {
	f := newMutationHooksFixture(t)
	uid := int(f.create("b273_permission_replacement", ""))
	var enabled, disabled int
	for _, function := range []struct {
		name     string
		disabled bool
		id       *int
	}{{"enabled", false, &enabled}, {"disabled", true, &disabled}} {
		if err := f.owner.QueryRow(`INSERT INTO system_functions
		 (name,package,url_route_endpoint,disabled,ui_only,specific_table_related)
		 VALUES($1,'b273',$2,$3,true,true) RETURNING id`, "b273."+function.name,
			"/ui/b273/"+function.name, function.disabled).Scan(function.id); err != nil {
			t.Fatal(err)
		}
	}
	// Isolate the two scopes from bootstrap/create defaults. The throwaway
	// cluster owns every fixture and is removed by its cleanup even on failure.
	FixtureExec(t, f.owner, `DELETE FROM system_group_table_func_rights
	 WHERE target_schema_name='public' AND (target_table_uid IS NULL OR target_table_uid=$1)`, uid)
	FixtureExec(t, f.owner, `INSERT INTO system_group_table_func_rights
	 (user_group_id,function_id,target_schema_name,target_table_uid)
	 VALUES(1,$1,'public',NULL),(2,$1,'public',NULL),
	       (1,$2,'public',NULL),(2,$2,'public',NULL),
	       (1,$1,'public',$3),(1,$2,'public',$3)`, enabled, disabled, uid)

	type hiddenGrant struct {
		id, group, uid int
		schema         string
	}
	hiddenGrants := func() []hiddenGrant {
		t.Helper()
		rows, err := f.owner.Query(`SELECT id,user_group_id,COALESCE(target_table_uid,0),target_schema_name
		 FROM system_group_table_func_rights WHERE function_id=$1 ORDER BY id`, disabled)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		var grants []hiddenGrant
		for rows.Next() {
			var grant hiddenGrant
			if err := rows.Scan(&grant.id, &grant.group, &grant.uid, &grant.schema); err != nil {
				t.Fatal(err)
			}
			grants = append(grants, grant)
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		return grants
	}
	wantHidden := hiddenGrants()
	if len(wantHidden) != 3 {
		t.Fatalf("seeded hidden grants=%d, want 3", len(wantHidden))
	}
	assertState := func(globalGroups, datasetGroups []int) {
		t.Helper()
		if got := hiddenGrants(); !reflect.DeepEqual(got, wantHidden) {
			t.Fatalf("hidden grants changed: got %+v, want %+v", got, wantHidden)
		}
		for i, groups := range [][]int{globalGroups, datasetGroups} {
			target := sql.NullInt64{Int64: int64(uid), Valid: i == 1}
			rows, err := f.owner.Query(`SELECT agr.user_group_id,agr.function_id
			 FROM system_group_table_func_rights agr
			 JOIN system_functions f ON f.id=agr.function_id AND f.disabled=false
			 WHERE agr.target_schema_name='public' AND agr.target_table_uid IS NOT DISTINCT FROM $1
			 ORDER BY agr.user_group_id,agr.function_id`, target)
			if err != nil {
				t.Fatal(err)
			}
			got, want := [][2]int{}, [][2]int{}
			for rows.Next() {
				var grant [2]int
				if err := rows.Scan(&grant[0], &grant[1]); err != nil {
					rows.Close()
					t.Fatal(err)
				}
				got = append(got, grant)
			}
			err = rows.Err()
			rows.Close()
			if err != nil {
				t.Fatal(err)
			}
			for _, group := range groups {
				want = append(want, [2]int{group, enabled})
			}
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("scope %d enabled grants=%v, want exact payload %v", i, got, want)
			}
		}
	}
	grant := func(group, function, target int) backend.Permission {
		return backend.Permission{AuthUserGroupID: group, FunctionID: function,
			TargetSchemaName: "public", TargetTableUID: target}
	}
	post := func(url string, permissions ...backend.Permission) {
		t.Helper()
		body, err := json.Marshal(struct {
			Permissions []backend.Permission `json:"permissions"`
		}{append([]backend.Permission{}, permissions...)})
		if err != nil {
			t.Fatal(err)
		}
		f.request(func(w http.ResponseWriter, r *http.Request) {
			r.URL.Path = "/api/dataset_permissions"
			r.URL.RawQuery = url
			backend.PermissionsHandler(w, r)
		}, string(body), http.StatusCreated)
	}

	assertState([]int{1, 2}, []int{1})
	// Omission preserves disabled rows while replacing all enabled groups.
	post("", grant(3, enabled, 0))
	assertState([]int{3}, []int{1})
	post("", grant(2, enabled, uid))
	assertState([]int{3}, []int{2})
	// An API caller may include an already retained grant, even twice.
	post("", grant(3, enabled, 0), grant(1, disabled, 0), grant(1, disabled, 0), grant(2, disabled, 0))
	assertState([]int{3}, []int{2})
	post("", grant(2, enabled, uid), grant(1, disabled, uid), grant(1, disabled, uid))
	assertState([]int{3}, []int{2})
	post("schema=public&dataset=")
	assertState(nil, []int{2})
	post(fmt.Sprintf("schema=public&dataset_uid=%d", uid))
	assertState(nil, nil)
}
