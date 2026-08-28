// registration_test.go
// Verifies that public Agent Tools source stays dormant until explicitly activated.
// Bridges the Agent Tools activation function with app-route and pipeline registries.
// Exists so moving the implementation into Filterest core cannot expose it by default.
package agent_tools

import (
	"net/http"
	"testing"

	appregistry "easelect/backend/core_components/app_registry"
	"easelect/backend/pipeline"
)

func collectRegisteredAgentToolRoutes() map[string]string {
	routes := map[string]string{}
	appregistry.RegisterRoutes(func(pattern string, _ http.HandlerFunc, handlerName string) {
		routes[pattern] = handlerName
	})
	return routes
}

func TestAgentToolsRequireExplicitActivation(t *testing.T) {
	if routes := collectRegisteredAgentToolRoutes(); len(routes) != 0 {
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
		"/api/app/bee/messages":                 "agent_tools.BeeMessagesHandler",
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
		"agent_tools.WorklinesHandler",
		"agent_tools.WorklineReportsHandler",
		"agent_tools.WorklineTasksHandler",
		"agent_tools.HandoverReportsHandler",
		"agent_tools.BeeMessagesHandler",
	} {
		if got := pipeline.DescribeRouteProfile(handlerName).ProfileName; got != "login_only" {
			t.Fatalf("%s profile = %q, want login_only", handlerName, got)
		}
	}
}
