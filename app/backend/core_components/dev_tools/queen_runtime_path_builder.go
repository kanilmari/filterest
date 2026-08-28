// queen_runtime_path_builder.go
// Resolves the shared mutable filesystem root for Queen runtime state.
// Bridges standalone installation paths, explicit operator overrides, and legacy flat projects.
// Exists so browser, API, and Python Queen flows never split one session across different trees.
package devtools

import (
	"os"
	"path/filepath"
	"strings"

	"easelect/backend/core_components/runtimepaths"
)

var queenRuntimePathsResolver = runtimepaths.Current

// resolveQueenStateRoot selects the one mutable root for all Queen state.
// Between explicit process configuration and the shared application runtime
// snapshot, it prefers installation-owned data while retaining legacy .queen.
func resolveQueenStateRoot(projectRoot string) string {
	if configuredRoot := strings.TrimSpace(os.Getenv("FILTEREST_QUEEN_STATE_ROOT")); configuredRoot != "" {
		absoluteRoot, err := filepath.Abs(configuredRoot)
		if err == nil {
			return filepath.Clean(absoluteRoot)
		}
		return filepath.Clean(configuredRoot)
	}

	paths := queenRuntimePathsResolver()
	if !paths.LegacyFlat && strings.TrimSpace(paths.RuntimeRoot) != "" {
		return filepath.Join(paths.RuntimeRoot, "queen")
	}

	return filepath.Join(projectRoot, ".queen")
}

// resolveConfiguredQueenStateRoot reports only installation-aware state roots.
// Between transcript discovery and the shared runtime contract, it distinguishes
// an explicit/nested boundary from legacy cwd-based .queen probing.
func resolveConfiguredQueenStateRoot() (string, bool) {
	if configuredRoot := strings.TrimSpace(os.Getenv("FILTEREST_QUEEN_STATE_ROOT")); configuredRoot != "" {
		return resolveQueenStateRoot(""), true
	}

	paths := queenRuntimePathsResolver()
	if !paths.LegacyFlat && strings.TrimSpace(paths.RuntimeRoot) != "" {
		return filepath.Join(paths.RuntimeRoot, "queen"), true
	}

	return "", false
}
