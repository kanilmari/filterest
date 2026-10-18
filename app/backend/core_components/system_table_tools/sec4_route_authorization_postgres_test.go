// sec4_route_authorization_postgres_test.go
// Proves empty-row and shared-layout authorization against disposable PostgreSQL.
// Connects registered profiles, real grant/admin stages and committed persistence.
// Keeps refusals atomic while preserving WO77 shared edits and personal-order policy.
package system_table_tools

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"easelect/backend/core_components/dbutils/queryfixture"
	"easelect/backend/pipeline"
)

func sec4AuthorizationDB(t *testing.T) *sql.DB {
	t.Helper()
	t.Setenv("FILTEREST_ADMIN_PERMISSION_RECOVERY_MODE", "")
	db := frontPageDisposableDB(t)
	frontPageExec(t, db, `
		INSERT INTO public.system_users(id,username,enabled,admin_access_allowed)
			VALUES(74,'SEC4 administrator',true,true);
		INSERT INTO public.system_user_group_memberships(user_id,group_id) VALUES(74,1);
		UPDATE public.system_config SET boolean_value=false WHERE key='login_to_browse';
		DELETE FROM public.system_functions WHERE url_route_endpoint IN
			('/api/empty-rows','/api/filterbar-section-layout/save');
		INSERT INTO public.system_functions(id,name,disabled,specific_table_related,url_route_endpoint)
			VALUES(500001,'system_table_tools.GetEmptyRowsHandler',false,false,'/api/empty-rows'),
			(500002,'system_table_tools.SaveFilterbarSectionLayoutHandler',false,false,'/api/filterbar-section-layout/save');
		INSERT INTO public.system_group_table_func_rights(user_group_id,function_id,target_table_uid)
			VALUES(1,500001,NULL),(1,500002,NULL);
		CREATE TABLE public.sec4_empty_rows(id integer PRIMARY KEY,value text);
		INSERT INTO public.sec4_empty_rows VALUES(6201,NULL),(6202,'Keep this row');
		INSERT INTO public.system_user_visual_preferences(user_id,theme_mode) VALUES(42,'dark');`)
	// Keep the actual authorization and transaction stages. Session binding and
	// CSRF are covered by profile tests; they do not decide the changed boundary.
	previous := pipeline.PipelineOrder
	pipeline.PipelineOrder = nil
	for _, stage := range previous {
		switch stage.Name {
		case "access_control", "admin_check", "transaction":
			pipeline.PipelineOrder = append(pipeline.PipelineOrder, stage)
		}
	}
	t.Cleanup(func() { pipeline.PipelineOrder = previous })
	return db
}

func sec4CallRoute(t *testing.T, path, name, method, body string, userID int, handler http.HandlerFunc) *httptest.ResponseRecorder {
	t.Helper()
	role := "basic"
	if userID == 1 {
		role = "guest"
	} else if userID == 74 {
		role = "admin"
	}
	request := queryfixture.Request(t, method, path, body, userID, role)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	pipeline.BuildHandler(handler, pipeline.RouteContext{URLPattern: path, HandlerName: name}, pipeline.GetProfile(name))(response, request)
	return response
}

func sec4AssertRefusal(t *testing.T, response *httptest.ResponseRecorder) {
	t.Helper()
	var body map[string]interface{}
	if response.Code != 403 || response.Header().Get("Content-Type") != "application/json; charset=utf-8" ||
		json.Unmarshal(response.Body.Bytes(), &body) != nil || body["error"] == nil || body["code"] != float64(403) {
		t.Fatalf("want normal JSON 403: %d %s", response.Code, response.Body)
	}
}

func sec4SetGrant(t *testing.T, db *sql.DB, functionID int, allowed bool) {
	t.Helper()
	if _, err := db.Exec(`DELETE FROM public.system_group_table_func_rights WHERE function_id=$1 AND user_group_id IN(2,3)`, functionID); err != nil {
		t.Fatal(err)
	}
	if allowed {
		if _, err := db.Exec(`INSERT INTO public.system_group_table_func_rights(user_group_id,function_id,target_table_uid)
			VALUES(2,$1,NULL),(3,$1,NULL)`, functionID); err != nil {
			t.Fatal(err)
		}
	}
}

func sec4LayoutSnapshot(t *testing.T, db *sql.DB) string {
	t.Helper()
	var snapshot string
	if err := db.QueryRow(`SELECT json_build_array(
		(SELECT row_to_json(c) FROM public.system_config c WHERE key='filterbar_section_layout'),
		(SELECT json_agg(p ORDER BY user_id) FROM public.system_user_visual_preferences p))::text`).Scan(&snapshot); err != nil {
		t.Fatal(err)
	}
	return snapshot
}

func TestEmptyRowsRouteAuthorizationPostgres(t *testing.T) {
	db := sec4AuthorizationDB(t)
	for _, grant := range []bool{false, true} {
		sec4SetGrant(t, db, 500001, grant)
		for _, userID := range []int{1, 42} {
			t.Run(fmt.Sprintf("actor_%d_grant_%t", userID, grant), func(t *testing.T) {
				called := false
				response := sec4CallRoute(t, "/api/empty-rows", "system_table_tools.GetEmptyRowsHandler", "GET", "", userID,
					func(w http.ResponseWriter, r *http.Request) { called = true; GetEmptyRowsHandler(w, r) })
				sec4AssertRefusal(t, response)
				if called {
					t.Fatal("non-admin reached cross-dataset reader")
				}
			})
		}
	}
	response := sec4CallRoute(t, "/api/empty-rows", "system_table_tools.GetEmptyRowsHandler", "GET", "", 74, GetEmptyRowsHandler)
	var datasets []struct {
		Dataset string                   `json:"dataset"`
		Rows    []map[string]interface{} `json:"rows"`
	}
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &datasets) != nil {
		t.Fatalf("admin read: %d %s", response.Code, response.Body)
	}
	for _, dataset := range datasets {
		if dataset.Dataset == "sec4_empty_rows" {
			if len(dataset.Rows) != 1 || dataset.Rows[0]["id"] != float64(6201) {
				t.Fatalf("admin rows changed: %+v", dataset.Rows)
			}
			return
		}
	}
	t.Fatal("admin did not receive the empty fixture row")
}

func TestSharedFilterbarRouteAuthorizationPostgres(t *testing.T) {
	db := sec4AuthorizationDB(t)
	bodies := []string{
		`{"section_order":["style","views"]}`,
		`{"section_collapsed":{"filters":true,"tools":false}}`,
		`{"section_collapsed":{"filters":null}}`,
		`{"allow_own_order":true}`, `{"allow_own_order":false}`,
		`{"section_order":["views"],"section_collapsed":{"style":true},"allow_own_order":true}`,
	}
	for _, userID := range []int{1, 42, 74} {
		for _, grant := range []bool{false, true} {
			sec4SetGrant(t, db, 500002, grant)
			for kind, body := range bodies {
				t.Run(fmt.Sprintf("actor_%d_grant_%t_kind_%d", userID, grant, kind), func(t *testing.T) {
					before := sec4LayoutSnapshot(t, db)
					called := false
					response := sec4CallRoute(t, "/api/filterbar-section-layout/save", "system_table_tools.SaveFilterbarSectionLayoutHandler", "POST", body, userID,
						func(w http.ResponseWriter, r *http.Request) { called = true; SaveFilterbarSectionLayoutHandler(w, r) })
					if userID == 1 || userID != 74 && !grant {
						sec4AssertRefusal(t, response)
						if called != grant {
							t.Fatal("ungranted actor reached handler, or granted guest bypassed handler refusal")
						}
						if after := sec4LayoutSnapshot(t, db); after != before {
							t.Fatal("refusal partially changed shared settings or account preferences")
						}
						return
					}
					if !called || response.Code != 200 {
						t.Fatalf("authorized edit: %d %s", response.Code, response.Body)
					}
					var got, persisted filterbarSectionLayoutConfig
					if err := json.Unmarshal(response.Body.Bytes(), &got); err != nil {
						t.Fatal(err)
					}
					persisted, err := readFilterbarSectionLayout()
					if err != nil {
						t.Fatal(err)
					}
					gotJSON, _ := json.Marshal(got)
					persistedJSON, _ := json.Marshal(persisted)
					if string(gotJSON) != string(persistedJSON) {
						t.Fatal("successful edit was not committed")
					}
					switch kind {
					case 0:
						if persisted.SectionOrder[0] != "style" {
							t.Fatal("order not saved")
						}
					case 1:
						if !persisted.SectionCollapsed["filters"] || persisted.SectionCollapsed["tools"] {
							t.Fatal("collapse defaults not saved")
						}
					case 2:
						if _, exists := persisted.SectionCollapsed["filters"]; exists {
							t.Fatal("collapse default not removed")
						}
					case 3:
						if !persisted.AllowOwnOrder {
							t.Fatal("site policy not enabled")
						}
					case 4:
						if persisted.AllowOwnOrder {
							t.Fatal("site policy not disabled")
						}
					case 5:
						if persisted.SectionOrder[0] != "views" || !persisted.SectionCollapsed["style"] || !persisted.AllowOwnOrder {
							t.Fatal("combined shared edit not fully saved")
						}
					}
				})
			}
		}
	}
}

func TestOwnFilterbarOrderPolicyAndAtomicRefusalPostgres(t *testing.T) {
	db := sec4AuthorizationDB(t)
	// Re-disable after saving an own order too: a refusal must preserve the
	// existing account row, including its theme, order and visibility choice.
	for phase, allow := range []bool{false, true, false} {
		frontPageExec(t, db, fmt.Sprintf(`UPDATE public.system_config SET json_value=jsonb_set(json_value,'{allow_own_order}','%t') WHERE key='filterbar_section_layout'`, allow))
		for _, userID := range []int{42, 74} {
			for kind, body := range []string{
				`{"order_mode":"own","visibility_memory":"dataset"}`,
				`{"order_mode":"own","section_order":["chat","style"],"visibility_memory":"shared"}`,
			} {
				t.Run(fmt.Sprintf("phase_%d_allow_%t_actor_%d_%s", phase, allow, userID, body), func(t *testing.T) {
					before := sec4LayoutSnapshot(t, db)
					response := sec4CallRoute(t, "/api/user-filterbar-preference", "system_table_tools.UserFilterbarPreferenceHandler", "PATCH", body, userID, UserFilterbarPreferenceHandler)
					if !allow && userID != 74 {
						sec4AssertRefusal(t, response)
						if sec4LayoutSnapshot(t, db) != before {
							t.Fatal("policy refusal partially wrote preferences")
						}
						return
					}
					if response.Code != 200 {
						t.Fatalf("own order: %d %s", response.Code, response.Body)
					}
					var mode, order string
					if err := db.QueryRow(`SELECT filterbar_order_mode,filterbar_section_order::text FROM public.system_user_visual_preferences WHERE user_id=$1`, userID).Scan(&mode, &order); err != nil || mode != "own" || order == "null" {
						t.Fatalf("own order not persisted: %s/%s %v", mode, order, err)
					}
					var sectionOrder []string
					if err := json.Unmarshal([]byte(order), &sectionOrder); err != nil || len(sectionOrder) != len(defaultFilterbarSectionOrder) {
						t.Fatalf("invalid persisted order: %s %v", order, err)
					}
					if kind == 1 && (sectionOrder[0] != "chat" || sectionOrder[1] != "style") {
						t.Fatal("requested own order not saved")
					}
				})
			}
		}
	}
}
