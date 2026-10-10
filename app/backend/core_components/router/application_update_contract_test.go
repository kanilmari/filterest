// application_update_contract_test.go
// Verifies the versioned update routes retain methods and protection in every build mode.
// Connects shared route registrations to generated profile and API inventory evidence.
// Keeps the executor-free admission API behind authentication, CSRF and administrator checks.
package router

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestApplicationUpdateRoutesStayGuardedAcrossScenarios(t *testing.T) {
	manifest, err := BuildDefaultRouteManifest()
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, route := range manifest.Routes {
		if !strings.HasPrefix(route.HandlerName, "application_updates.") {
			continue
		}
		count++
		for _, scenario := range route.Scenarios {
			if scenario.ProfileName != "admin" || !scenario.AdminOnly || len(scenario.SkipStages) > 0 {
				t.Fatal(route, scenario)
			}
		}
		want := http.MethodPost
		if route.HandlerName == "application_updates.StatusHandler" || route.HandlerName == "application_updates.JobHandler" {
			want = http.MethodGet
		}
		if route.Methods[0] != want {
			t.Fatal(route)
		}
	}
	if count != 5 {
		t.Fatal("incomplete admission route contract", count)
	}
}

func TestApplicationUpdateParameterizedPathsUseServerMuxAndMethodBoundary(t *testing.T) {
	mux := http.NewServeMux()
	for _, route := range []struct{ path, method string }{{"/api/admin/application-update/jobs/{id}", "GET"}, {"/api/admin/application-update/jobs/{id}/decisions", "POST"}} {
		mux.HandleFunc(route.path, enforceRouteMethods(func(w http.ResponseWriter, r *http.Request) {
			if r.PathValue("id") != "job-1" {
				t.Fatal("job path identity was lost")
			}
			w.WriteHeader(204)
		}, "application_updates.test", newRouteMethodContract(route.method)))
	}
	for _, test := range []struct {
		path, method string
		want         int
	}{{"/api/admin/application-update/jobs/job-1", "GET", 204}, {"/api/admin/application-update/jobs/job-1/decisions", "POST", 204}, {"/api/admin/application-update/jobs/job-1/decisions", "GET", 405}, {"/api/admin/application-update/jobs/job-1", "POST", 405}} {
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, httptest.NewRequest(test.method, test.path, nil))
		if response.Code != test.want {
			t.Fatal(test, response.Code)
		}
	}
}
