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
		}{
			{"/api/app/workline-observatory/board", "workline_observatory.BoardHandler", BoardHandler},
			{"/api/app/workline-observatory/status-actions", "workline_observatory.WorklineStatusActionsHandler", WorklineStatusActionsHandler},
			{"/api/app/workline-observatory/release-goals", "workline_observatory.ReleaseGoalsHandler", ReleaseGoalsHandler},
			{"/api/app/workline-observatory/contracts", "workline_observatory.ReleaseContractsHandler", ReleaseContractsHandler},
		}
		for _, route := range routes {
			appregistry.RegisterRoute(route.path, route.handler, route.handlerName)
			pipeline.RegisterRouteProfile(route.handlerName, pipeline.AdminProfile)
		}
	})
}
