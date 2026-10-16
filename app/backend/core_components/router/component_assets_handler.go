// component_assets_handler.go
// Serves the reserved feature-component browser asset namespace.
// Connects the resolved frontend sibling to the confined frontend asset server.
// Keeps component backend code and fixtures outside every served filesystem.
package router

import (
	"net/http"
	"path/filepath"

	frontendassets "easelect/backend/core_components/frontend_assets"
)

// handleComponents serves only regular public files under <name>/frontend/.
func handleComponents(w http.ResponseWriter, r *http.Request) {
	frontendassets.ComponentFileServer(filepath.Join(filepath.Dir(localFrontendDir), "components")).ServeHTTP(w, r)
}
