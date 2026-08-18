// registration.go
// Exposes the DB-backed agent workflow as an explicitly activated Filterest capability.
// Bridges the public Agent Tools handlers with the shared app and pipeline registries.
// Exists so the implementation can live in public core while remaining disabled by default.
package agent_tools

import (
	"sync"

	appregistry "easelect/backend/core_components/app_registry"
	"easelect/backend/pipeline"
)

var registerOnce sync.Once

// Register activates the Agent Tools startup hook, routes, and security profiles.
// The public product never calls this automatically; a reviewed maintainer or
// deployment activation boundary must opt in explicitly.
func Register() {
	registerOnce.Do(func() {
		appregistry.RegisterStartup("agent_tools", func(_ string, _ string) {
			Init()
		})

		appregistry.RegisterRoute(
			"/api/app/agent-tools/tasks",
			TasksHandler,
			"agent_tools.TasksHandler",
		)
		appregistry.RegisterRoute(
			"/api/app/agent-tools/task-runs",
			TaskRunsHandler,
			"agent_tools.TaskRunsHandler",
		)
		appregistry.RegisterRoute(
			"/api/app/agent-tools/task-todos",
			TaskTodosHandler,
			"agent_tools.TaskTodosHandler",
		)
		appregistry.RegisterRoute(
			"/api/app/agent-tools/task-groups",
			TaskGroupsHandler,
			"agent_tools.TaskGroupsHandler",
		)
		appregistry.RegisterRoute(
			"/api/app/bee/messages",
			BeeMessagesHandler,
			"agent_tools.BeeMessagesHandler",
		)

		loginOnlyHandlers := []string{
			"agent_tools.TasksHandler",
			"agent_tools.TaskRunsHandler",
			"agent_tools.TaskTodosHandler",
			"agent_tools.BeeMessagesHandler",
		}
		for _, handlerName := range loginOnlyHandlers {
			pipeline.RegisterRouteProfile(handlerName, pipeline.LoginOnlyProfile)
		}
		pipeline.RegisterRouteProfile("agent_tools.TaskGroupsHandler", pipeline.DefaultProfile)
	})
}
