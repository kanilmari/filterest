// maintainer_tool_registry.go
// Keeps optional private maintainer-tool HTTP routes out of core imports.
// Bridges private Easelect-only admin tooling and the shared core router.
// Exists so Filterest can omit maintainer implementations at source level.
package maintainertools

import (
	"net/http"
	"sync"
)

// RouteRegistrar is the small route-registration surface maintainer tools need.
type RouteRegistrar func(pattern string, handler http.HandlerFunc, handlerName string)

type routeRegistration struct {
	pattern     string
	handler     http.HandlerFunc
	handlerName string
}

var (
	mu     sync.RWMutex
	routes []routeRegistration
)

// RegisterRoute adds an optional private maintainer route during package init.
// Between private activation packages and core route registration, it avoids a
// hard import from public core into Easelect-only tooling.
func RegisterRoute(pattern string, handler http.HandlerFunc, handlerName string) {
	if handler == nil {
		panic("maintainer tool route handler cannot be nil")
	}

	mu.Lock()
	defer mu.Unlock()
	routes = append(routes, routeRegistration{
		pattern:     pattern,
		handler:     handler,
		handlerName: handlerName,
	})
}

// RegisterRoutes replays optional maintainer routes into the core router.
func RegisterRoutes(register RouteRegistrar) {
	if register == nil {
		panic("maintainer tool route registrar cannot be nil")
	}

	for _, route := range registeredRoutes() {
		register(route.pattern, route.handler, route.handlerName)
	}
}

func registeredRoutes() []routeRegistration {
	mu.RLock()
	defer mu.RUnlock()
	return append([]routeRegistration(nil), routes...)
}
