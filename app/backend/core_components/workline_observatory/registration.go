// registration.go
// Activates the workline observatory through the shared app and security registries.
// Bridges the private Easelect activation boundary with isolated observatory handlers.
// Exists so public core can contain the module while no route is enabled by default.
package workline_observatory

import (
	"net/http"
	"sync"

	appregistry "easelect/backend/core_components/app_registry"
	"easelect/backend/pipeline"
)

var registerOnce sync.Once

// Register enables the observatory's read and bounded release-decision routes.
func Register() {
	registerOnce.Do(func() {
		routes := []struct {
			path        string
			handlerName string
			handler     func(http.ResponseWriter, *http.Request)
			methods     []string
		}{
			{"/api/app/workline-observatory/board", "workline_observatory.BoardHandler", BoardHandler, []string{http.MethodGet}},
			{"/api/app/workline-observatory/priority-actions", "workline_observatory.WorklinePriorityActionsHandler", WorklinePriorityActionsHandler, []string{http.MethodPost}},
			{"/api/app/workline-observatory/status-actions", "workline_observatory.WorklineStatusActionsHandler", WorklineStatusActionsHandler, []string{http.MethodPost}},
			{"/api/app/workline-observatory/release-goals", "workline_observatory.ReleaseGoalsHandler", ReleaseGoalsHandler, []string{http.MethodPost, http.MethodPatch}},
			{"/api/app/workline-observatory/contracts", "workline_observatory.ReleaseContractsHandler", ReleaseContractsHandler, []string{http.MethodPut}},
		}
		for _, route := range routes {
			appregistry.RegisterRoute(route.path, route.handler, route.handlerName, route.methods...)
			pipeline.RegisterRouteProfile(route.handlerName, pipeline.AdminProfile)
		}
	})
}
