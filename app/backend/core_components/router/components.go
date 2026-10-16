// components.go
// Lists compiled feature components and activates their existing registry entries.
// Connects RegisterRoutes and manifest generation to the same composition root.
// Only this core Go file may import a component's public backend package.
package router

// registerComponents calls each component's idempotent Register function.
// The list stays empty until a separately reviewed feature-component batch lands.
func registerComponents() {
}
