// router_for_maintainer_tools.go
// Registers optional private maintainer-tool routes through a narrow registry.
// Bridges Easelect-only admin tooling and the shared router without importing private code.
// Exists so public Filterest builds can omit private maintainer implementations cleanly.
package router

import maintainertools "easelect/backend/core_components/maintainer_tools"

// RegisterMaintainerToolRoutes registers private maintainer routes when their
// activation package is present in the private Easelect build.
func RegisterMaintainerToolRoutes() {
	maintainertools.RegisterRoutes(functionRegisterHandler)
}
