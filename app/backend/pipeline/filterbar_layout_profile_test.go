// filterbar_layout_profile_test.go
// Exercises safe public reads and explicit-grant writes through the access stage.
// Connects registered security profiles to real permission queries and safe responses.
// Prevents a public layout read from widening into a public configuration writer.
package pipeline_test

import (
	"database/sql/driver"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils/queryfixture"
	"easelect/backend/core_components/system_table_tools"
	"easelect/backend/pipeline"
	"easelect/backend/pipeline/access_control"
)

func TestFilterbarLayoutPublicReadAndGrantedEdit(t *testing.T) {
	allowed := false
	db := queryfixture.Open(t, func(query string, _ []driver.NamedValue) (driver.Rows, error) {
		var value driver.Value
		switch {
		case strings.Contains(query, "json_value"):
			value = []byte(`{"section_order":["style","filters"],"allow_own_order":false,"unreviewed_private_setting":"must-stay-private","section_collapsed":{"unknown":true}}`)
		case strings.Contains(query, "SELECT username"):
			value = "ordinary"
		case strings.Contains(query, "specific_table_related"), strings.Contains(query, "login_to_browse"):
			value = false
		case strings.Contains(query, "FROM system_group_table_func_rights"):
			if !allowed {
				return queryfixture.Rows([]string{"value"}), nil
			}
			value = int64(1)
		default:
			return nil, fmt.Errorf("unexpected query: %s", query)
		}
		return queryfixture.Rows([]string{"value"}, []driver.Value{value}), nil
	})
	oldDB, oldStages := backend.Db, pipeline.PipelineOrder
	backend.Db = db
	// Isolate the real grant stage; profile assertions below cover retained auth/CSRF.
	pipeline.PipelineOrder = []pipeline.Stage{{Name: "access_control", Fn: func(next http.HandlerFunc, ctx pipeline.RouteContext) http.HandlerFunc {
		return access_control.WithAccessControl(ctx.URLPattern, ctx.HandlerName, next)
	}}}
	t.Cleanup(func() { backend.Db, pipeline.PipelineOrder = oldDB, oldStages })
	for _, id := range []int{0, 1, 42} {
		request := queryfixture.Request(t, "GET", "/api/filterbar-section-layout", "", id, "user")
		response := httptest.NewRecorder()
		name := "system_table_tools.GetFilterbarSectionLayoutHandler"
		pipeline.BuildHandler(system_table_tools.GetFilterbarSectionLayoutHandler,
			pipeline.RouteContext{URLPattern: "/api/filterbar-section-layout", HandlerName: name}, pipeline.GetProfile(name))(response, request)
		if response.Code != 200 || !strings.Contains(response.Body.String(), `"style"`) || strings.Contains(response.Body.String(), "must-stay-private") || strings.Contains(response.Body.String(), "unknown") {
			t.Fatalf("public reader %d: %d %s", id, response.Code, response.Body)
		}
	}
	for _, id := range []int{1, 42} {
		for _, grant := range []bool{false, true} {
			allowed = grant
			request := queryfixture.Request(t, "POST", "/api/filterbar-section-layout/save", `{}`, id, "user")
			request.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			name := "system_table_tools.SaveFilterbarSectionLayoutHandler"
			called := false
			pipeline.BuildHandler(func(w http.ResponseWriter, _ *http.Request) { called = true; w.WriteHeader(204) },
				pipeline.RouteContext{URLPattern: "/api/filterbar-section-layout/save", HandlerName: name}, pipeline.GetProfile(name))(response, request)
			if called != grant || (!grant && response.Code != 403) {
				t.Fatalf("actor=%d grant=%t called=%t status=%d", id, grant, called, response.Code)
			}
		}
	}
}

func TestFilterbarLayoutSecurityProfiles(t *testing.T) {
	name := "system_table_tools.SaveFilterbarSectionLayoutHandler"
	stages := pipeline.DescribePipeline(pipeline.RouteContext{}, pipeline.GetProfile(name))
	containsAll(t, stages, []string{"auth", "csrf", "fingerprint", "device_id", "access_control", "transaction"})
	if pipeline.GetProfile(name).AdminOnly {
		t.Fatal("an explicit route grant must permit an ordinary editor")
	}
	if pipeline.DescribeRouteProfile("system_table_tools.GetFilterbarSectionLayoutHandler").ProfileName != "public" {
		t.Fatal("read must be public")
	}
	own := pipeline.GetProfile("system_table_tools.UserFilterbarPreferenceHandler")
	if !own.Skips("access_control") || own.Skips("auth") || own.Skips("csrf") {
		t.Fatal("personal preferences must be authenticated and self scoped")
	}
}
