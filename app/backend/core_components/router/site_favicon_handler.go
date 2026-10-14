// site_favicon_handler.go
// Serves the current site's icon for documents without HTML favicon links.
// Connects the public fallback and legacy alias to the shell's shared resolver.
// Revalidates by content so changing a selection never reuses another icon's bytes.
package router

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	backend "easelect/backend/core_components"
	frontendassets "easelect/backend/core_components/frontend_assets"
)

// faviconHandler serves the exact resolved PNG, even at the browser's .ico URL.
// It reads the administrator's selection on every request, without a session or
// browse-policy check. ETags cover both selection changes and replaced bytes;
// modification times cannot distinguish two selected files with the same date.
func faviconHandler(w http.ResponseWriter, r *http.Request) {
	iconPath := frontendassets.SiteFaviconPath(localFrontendDir, resolvePageSiteName(r), configuredFaviconReader(r.Context(), backend.Db))
	content, err := os.ReadFile(filepath.Join(localFrontendDir, "icons", "site_favicons", filepath.Base(iconPath)))
	if err != nil {
		w.Header().Set("Cache-Control", "no-store")
		http.Error(w, "site icon unavailable", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "public, no-cache")
	w.Header().Set("ETag", fmt.Sprintf(`"%x"`, sha256.Sum256(content)))
	http.ServeContent(w, r, filepath.Base(iconPath), time.Time{}, bytes.NewReader(content))
}
