// queen_runtime_path_builder_test.go
// Verifies the shared mutable filesystem boundary for every Queen runtime consumer.
// Bridges synthetic nested installations and legacy projects with browser and managed-session paths.
// Exists so future path changes cannot split one Queen conversation or write into immutable app source.
package devtools

import (
	"easelect/backend/core_components/runtimepaths"
	"os"
	"path/filepath"
	"testing"
)

func useQueenRuntimePaths(t *testing.T, paths runtimepaths.Paths) {
	t.Helper()
	originalResolver := queenRuntimePathsResolver
	queenRuntimePathsResolver = func() runtimepaths.Paths { return paths }
	t.Cleanup(func() {
		queenRuntimePathsResolver = originalResolver
	})
}

func TestResolveQueenStateRootUsesExplicitEnvironment(t *testing.T) {
	explicitRoot := filepath.Join(t.TempDir(), "operator-queen-state")
	t.Setenv("FILTEREST_QUEEN_STATE_ROOT", explicitRoot)
	useQueenRuntimePaths(t, runtimepaths.Paths{
		RuntimeRoot: filepath.Join(t.TempDir(), "data", "runtime"),
		LegacyFlat:  false,
	})

	if got := resolveQueenStateRoot(t.TempDir()); got != explicitRoot {
		t.Fatalf("resolveQueenStateRoot() = %q, want explicit root %q", got, explicitRoot)
	}
}

func TestResolveQueenStateRootUsesNestedRuntimeRoot(t *testing.T) {
	t.Setenv("FILTEREST_QUEEN_STATE_ROOT", "")
	installationRoot := t.TempDir()
	useQueenRuntimePaths(t, runtimepaths.Paths{
		ApplicationRoot: filepath.Join(installationRoot, "app"),
		RuntimeRoot:     filepath.Join(installationRoot, "data", "runtime"),
		LegacyFlat:      false,
	})

	want := filepath.Join(installationRoot, "data", "runtime", "queen")
	if got := resolveQueenStateRoot(filepath.Join(installationRoot, "app")); got != want {
		t.Fatalf("resolveQueenStateRoot() = %q, want nested state root %q", got, want)
	}
}

func TestResolveQueenStateRootPreservesLegacyProjectTree(t *testing.T) {
	t.Setenv("FILTEREST_QUEEN_STATE_ROOT", "")
	projectRoot := t.TempDir()
	useQueenRuntimePaths(t, runtimepaths.Paths{LegacyFlat: true})

	want := filepath.Join(projectRoot, ".queen")
	if got := resolveQueenStateRoot(projectRoot); got != want {
		t.Fatalf("resolveQueenStateRoot() = %q, want legacy state root %q", got, want)
	}
}

func TestQueenRuntimeConsumersShareNestedStateRoot(t *testing.T) {
	t.Setenv("FILTEREST_QUEEN_STATE_ROOT", "")
	t.Setenv("QUEEN_TRANSCRIPT_DIR", "")
	installationRoot := t.TempDir()
	applicationRoot := filepath.Join(installationRoot, "app")
	stateRoot := filepath.Join(installationRoot, "data", "runtime", "queen")
	useQueenRuntimePaths(t, runtimepaths.Paths{
		ApplicationRoot: applicationRoot,
		RuntimeRoot:     filepath.Dir(stateRoot),
		LegacyFlat:      false,
	})

	transcriptPath, logPath, inboxPath, sessionStatePath, err := prepareQueenSessionFiles(
		applicationRoot,
		"nested-runtime",
		nil,
	)
	if err != nil {
		t.Fatalf("prepareQueenSessionFiles() error = %v", err)
	}

	wants := map[string]string{
		"browser transcripts": resolveQueenTranscriptDir(),
		"session registry":    queenSessionRegistryDir(applicationRoot),
		"thread registry":     queenThreadRegistryDir(applicationRoot),
		"managed transcript":  filepath.Dir(transcriptPath),
		"managed log":         filepath.Dir(logPath),
		"managed inbox":       filepath.Dir(inboxPath),
		"managed state":       filepath.Dir(sessionStatePath),
	}
	expected := map[string]string{
		"browser transcripts": filepath.Join(stateRoot, "transcripts"),
		"session registry":    filepath.Join(stateRoot, "session_registry"),
		"thread registry":     filepath.Join(stateRoot, "thread_registry"),
		"managed transcript":  filepath.Join(stateRoot, "transcripts"),
		"managed log":         filepath.Join(stateRoot, "session_logs"),
		"managed inbox":       filepath.Join(stateRoot, "session_inputs"),
		"managed state":       filepath.Join(stateRoot, "session_state"),
	}
	for label, got := range wants {
		if got != expected[label] {
			t.Errorf("%s path = %q, want %q", label, got, expected[label])
		}
	}
	if _, err := os.Stat(filepath.Join(applicationRoot, ".queen")); !os.IsNotExist(err) {
		t.Fatalf("immutable app .queen stat error = %v, want not-exist", err)
	}
}

func TestResolveQueenTranscriptDirPreservesExplicitCompatibilityOverride(t *testing.T) {
	explicitTranscriptDir := filepath.Join(t.TempDir(), "legacy-transcripts")
	t.Setenv("QUEEN_TRANSCRIPT_DIR", explicitTranscriptDir)
	t.Setenv("FILTEREST_QUEEN_STATE_ROOT", filepath.Join(t.TempDir(), "queen-state"))

	if got := resolveQueenTranscriptDir(); got != explicitTranscriptDir {
		t.Fatalf("resolveQueenTranscriptDir() = %q, want explicit override %q", got, explicitTranscriptDir)
	}
}

func TestResolveQueenProjectRootUsesNestedApplicationRoot(t *testing.T) {
	t.Setenv("QUEEN_PROJECT_ROOT", "")
	installationRoot := t.TempDir()
	applicationRoot := filepath.Join(installationRoot, "app")
	useQueenRuntimePaths(t, runtimepaths.Paths{
		ApplicationRoot: applicationRoot,
		RuntimeRoot:     filepath.Join(installationRoot, "data", "runtime"),
		LegacyFlat:      false,
	})

	got, err := resolveQueenProjectRoot()
	if err != nil {
		t.Fatalf("resolveQueenProjectRoot() error = %v", err)
	}
	if got != applicationRoot {
		t.Fatalf("resolveQueenProjectRoot() = %q, want application root %q", got, applicationRoot)
	}
}
