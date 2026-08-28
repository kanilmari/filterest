// asset_paths.go
// Resolves the current frontend bundle URLs for Go-rendered HTML templates.
// Bridges Vite's hashed dist output and the backend templates that must point to the active assets.
// Exists so Docker/prod instances do not depend on stale hardcoded hash names in HTML templates.
package frontendassets

import (
	"os"
	"path/filepath"
	"time"
)

// Paths keeps the stable frontend asset URLs used by backend-rendered templates.
type Paths struct {
	ImportsCSSPath  string
	MainBundlePath  string
	LoginBundlePath string
}

// Resolve returns active frontend asset URLs for either dev-source or built dist mode.
func Resolve(frontendDir string, useMinified bool) Paths {
	devPaths := DevPaths()
	if !useMinified {
		return devPaths
	}

	return Paths{
		ImportsCSSPath:  resolveDistAssetPath(frontendDir, "imports.*.min.css", devPaths.ImportsCSSPath),
		MainBundlePath:  resolveDistAssetPath(frontendDir, "main.*.min.js", devPaths.MainBundlePath),
		LoginBundlePath: resolveDistAssetPath(frontendDir, "login.*.min.js", devPaths.LoginBundlePath),
	}
}

// DevPaths returns the raw-source asset URLs used by the Vite dev server.
func DevPaths() Paths {
	return Paths{
		ImportsCSSPath:  "/frontend/styles/imports.css",
		MainBundlePath:  "/frontend/main.js",
		LoginBundlePath: "/frontend/core_components/auth/login_page_builder.js",
	}
}

func resolveDistAssetPath(frontendDir string, pattern string, fallback string) string {
	if frontendDir == "" {
		return fallback
	}

	matches, err := filepath.Glob(filepath.Join(frontendDir, "dist", pattern))
	if err != nil || len(matches) == 0 {
		return fallback
	}

	var newestMatch string
	var newestTime time.Time

	for _, match := range matches {
		info, statErr := os.Stat(match)
		if statErr != nil {
			continue
		}
		if newestMatch == "" || info.ModTime().After(newestTime) {
			newestMatch = match
			newestTime = info.ModTime()
		}
	}

	if newestMatch == "" {
		return fallback
	}

	return "/frontend/dist/" + filepath.Base(newestMatch)
}
