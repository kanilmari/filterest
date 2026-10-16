// component_asset_path_checker.go
// Recognizes literal public feature asset paths for serving and startup admission.
// Shares one path policy between the asset filesystem and the request barrier.
// Keeps component API routes and malformed paths subject to normal admission.
package middlewares

import (
	"net/http"
	"path"
	"regexp"
	"strings"
)

var componentName = regexp.MustCompile(`^[a-z][a-z0-9_]*$`)

// ComponentAssetPath recognizes only literal browser-asset paths. Encoded paths
// are refused before ServeMux can normalize traversal into another namespace.
func ComponentAssetPath(r *http.Request) bool {
	if strings.ContainsAny(r.URL.EscapedPath(), "%\\") {
		return false
	}
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/components/"), "/")
	return strings.HasPrefix(r.URL.Path, "/components/") && len(parts) >= 3 &&
		componentName.MatchString(parts[0]) && parts[1] == "frontend" &&
		ComponentAssetFile(strings.Join(parts[2:], "/"))
}

// ComponentAssetFile recognizes public browser filenames beneath a frontend root.
func ComponentAssetFile(name string) bool {
	for _, part := range strings.Split(name, "/") {
		if part == "" || strings.HasPrefix(part, ".") || part == "backend" || part == "tests" ||
			strings.ContainsAny(part, "%\\") || strings.Contains(part, "_test.") ||
			strings.Contains(part, ".spec.") || strings.Contains(part, ".test.") {
			return false
		}
	}
	// An allowlist prevents a future source/configuration format from becoming public.
	switch strings.ToLower(path.Ext(name)) {
	case ".js", ".mjs", ".css", ".json", ".html", ".svg", ".png", ".jpg", ".jpeg",
		".gif", ".webp", ".avif", ".ico", ".woff", ".woff2", ".ttf", ".otf", ".wasm",
		".mp3", ".mp4", ".webm", ".ogg", ".wav":
		return true
	}
	return false
}
