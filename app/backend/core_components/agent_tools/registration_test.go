// registration_test.go
// Verifies that public Agent Tools source stays dormant until explicitly activated.
// Bridges the Agent Tools activation function with app-route and pipeline registries.
// Exists so moving the implementation into Filterest core cannot expose it by default.
package agent_tools

import (
	"net/http"
	"slices"
	"testing"

	appregistry "easelect/backend/core_components/app_registry"
	"easelect/backend/pipeline"
)

func collectRegisteredAgentToolRoutes() map[string]string {
	routes := map[string]string{}
	appregistry.RegisterRoutes(func(pattern string, _ http.HandlerFunc, handlerName string, methods ...string) {
		routes[pattern] = handlerName
	})
	return routes
}

// Capture package initialization before any test explicitly activates the app.
// Other handler tests also call Register, so test order must not decide dormancy.
var agentToolRoutesBeforeActivation = collectRegisteredAgentToolRoutes()

func TestAgentToolsRequireExplicitActivation(t *testing.T) {
	if routes := agentToolRoutesBeforeActivation; len(routes) != 0 {
		t.Fatalf("Agent Tools registered %d routes before explicit activation", len(routes))
	}

	Register()
	routes := collectRegisteredAgentToolRoutes()
	want := map[string]string{
		"/api/app/agent-tools/tasks":            "agent_tools.TasksHandler",
		"/api/app/agent-tools/task-runs":        "agent_tools.TaskRunsHandler",
		"/api/app/agent-tools/task-todos":       "agent_tools.TaskTodosHandler",
		"/api/app/agent-tools/task-groups":      "agent_tools.TaskGroupsHandler",
		"/api/app/agent-tools/worklines":        "agent_tools.WorklinesHandler",
		"/api/app/agent-tools/workline-reports": "agent_tools.WorklineReportsHandler",
		"/api/app/agent-tools/workline-tasks":   "agent_tools.WorklineTasksHandler",
		"/api/app/agent-tools/handover-reports": "agent_tools.HandoverReportsHandler",
	}
	if len(routes) != len(want) {
		t.Fatalf("registered routes = %#v, want %#v", routes, want)
	}
	for path, handlerName := range want {
		if got := routes[path]; got != handlerName {
			t.Fatalf("%s handler = %q, want %q", path, got, handlerName)
		}
	}

	for _, handlerName := range []string{
		"agent_tools.TasksHandler",
		"agent_tools.TaskRunsHandler",
		"agent_tools.TaskTodosHandler",
		"agent_tools.TaskGroupsHandler",
		"agent_tools.WorklinesHandler",
		"agent_tools.WorklineReportsHandler",
		"agent_tools.WorklineTasksHandler",
		"agent_tools.HandoverReportsHandler",
	} {
		if got := pipeline.DescribeRouteProfile(handlerName).ProfileName; got != "admin" {
			t.Errorf("%s profile = %q, want admin", handlerName, got)
		}
		stages := pipeline.DescribePipeline(pipeline.RouteContext{HandlerName: handlerName}, pipeline.GetProfile(handlerName))
		for _, required := range []string{"auth", "csrf", "access_control", "admin_check"} {
			if !slices.Contains(stages, required) {
				t.Errorf("%s missing %s stage: %v", handlerName, required, stages)
			}
		}
	}
}
