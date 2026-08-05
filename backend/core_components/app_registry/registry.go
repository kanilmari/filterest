// registry.go
// Keeps optional application startup hooks and HTTP routes out of core imports.
// Bridges private Easelect apps with core startup/router code through explicit registration.
// Exists so the Filterest public export can build without the private apps/ tree.
package appregistry

import (
	"net/http"
	"sync"
)

// StartupFunc initializes an optional app after core database setup is ready.
type StartupFunc func(port string, envType string)

// RouteRegistrar is the small route-registration surface optional apps need.
type RouteRegistrar func(pattern string, handler http.HandlerFunc, handlerName string)

type startupRegistration struct {
	name string
	fn   StartupFunc
}

type routeRegistration struct {
	pattern     string
	handler     http.HandlerFunc
	handlerName string
}

var (
	mu       sync.RWMutex
	startups []startupRegistration
	routes   []routeRegistration
)

// RegisterStartup adds an optional app startup hook. It is normally called from
// private app activation packages during init().
func RegisterStartup(name string, fn StartupFunc) {
	if fn == nil {
		panic("app registry startup function cannot be nil")
	}

	mu.Lock()
	defer mu.Unlock()
	startups = append(startups, startupRegistration{name: name, fn: fn})
}

// StartAll runs registered optional app startup hooks in registration order.
func StartAll(port string, envType string) {
	for _, startup := range registeredStartups() {
		startup.fn(port, envType)
	}
}

// RegisterRoute adds an optional app route. It is normally called from private
// app activation packages during init().
func RegisterRoute(pattern string, handler http.HandlerFunc, handlerName string) {
	if handler == nil {
		panic("app registry route handler cannot be nil")
	}

	mu.Lock()
	defer mu.Unlock()
	routes = append(routes, routeRegistration{
		pattern:     pattern,
		handler:     handler,
		handlerName: handlerName,
	})
}

// RegisterRoutes replays optional app routes into the core router.
func RegisterRoutes(register RouteRegistrar) {
	if register == nil {
		panic("app registry route registrar cannot be nil")
	}

	for _, route := range registeredRoutes() {
		register(route.pattern, route.handler, route.handlerName)
	}
}

func registeredStartups() []startupRegistration {
	mu.RLock()
	defer mu.RUnlock()
	return append([]startupRegistration(nil), startups...)
}

func registeredRoutes() []routeRegistration {
	mu.RLock()
	defer mu.RUnlock()
	return append([]routeRegistration(nil), routes...)
}
