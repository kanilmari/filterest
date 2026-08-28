// runtime_roots_builder_test.go
// Verifies deterministic installation-root precedence and nested application-root detection.
// Exercises explicit hints, command arguments, environment fallback, and legacy flat layouts.
// Exists so the app-directory migration cannot reintroduce relative or cwd-dependent roots.
package application_runtime

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveRuntimeRootsInstallationPrecedence(t *testing.T) {
	workingDirectory := t.TempDir()
	tests := []struct {
		name             string
		explicitRoot     string
		arguments        []string
		environmentRoot  string
		wantRelativeRoot string
		wantExplicit     bool
	}{
		{
			name:             "explicit option wins over argument and environment",
			explicitRoot:     "explicit-install",
			arguments:        []string{"--root", "argument-install"},
			environmentRoot:  "environment-install",
			wantRelativeRoot: "explicit-install",
			wantExplicit:     true,
		},
		{
			name:             "separate command argument wins over environment",
			arguments:        []string{"serve", "--root", "argument-install"},
			environmentRoot:  "environment-install",
			wantRelativeRoot: "argument-install",
			wantExplicit:     true,
		},
		{
			name:             "equals command argument wins over environment",
			arguments:        []string{"--root=equals-install"},
			environmentRoot:  "environment-install",
			wantRelativeRoot: "equals-install",
			wantExplicit:     true,
		},
		{
			name:             "environment wins over cwd compatibility",
			environmentRoot:  "environment-install",
			wantRelativeRoot: "environment-install",
			wantExplicit:     true,
		},
		{
			name: "cwd remains the compatibility fallback",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			roots, err := resolveRuntimeRootsFromSources(
				test.explicitRoot,
				"",
				runtimeRootSources{
					arguments:        test.arguments,
					environmentRoot:  test.environmentRoot,
					workingDirectory: workingDirectory,
				},
			)
			if err != nil {
				t.Fatalf("resolveRuntimeRootsFromSources() error = %v", err)
			}

			wantRoot := workingDirectory
			if test.wantRelativeRoot != "" {
				wantRoot = filepath.Join(workingDirectory, test.wantRelativeRoot)
			}
			if roots.installationRoot != wantRoot {
				t.Fatalf("installation root = %q, want %q", roots.installationRoot, wantRoot)
			}
			if roots.applicationRoot != wantRoot {
				t.Fatalf("legacy application root = %q, want %q", roots.applicationRoot, wantRoot)
			}
			if !filepath.IsAbs(roots.installationRoot) || !filepath.IsAbs(roots.applicationRoot) {
				t.Fatalf("roots must be absolute: %#v", roots)
			}
			if roots.installationRootExplicit != test.wantExplicit {
				t.Fatalf(
					"installation root explicit = %t, want %t",
					roots.installationRootExplicit,
					test.wantExplicit,
				)
			}
		})
	}
}

func TestResolveRuntimeRootsNormalizesDotArgument(t *testing.T) {
	workingDirectory := t.TempDir()

	roots, err := resolveRuntimeRootsFromSources(
		"",
		"",
		runtimeRootSources{
			arguments:        []string{"--root", "."},
			environmentRoot:  filepath.Join(t.TempDir(), "ignored"),
			workingDirectory: workingDirectory,
		},
	)
	if err != nil {
		t.Fatalf("resolveRuntimeRootsFromSources() error = %v", err)
	}
	if roots.installationRoot != workingDirectory {
		t.Fatalf("installation root = %q, want absolute cwd %q", roots.installationRoot, workingDirectory)
	}
}

func TestResolveRuntimeRootsExplicitHintDoesNotConsultLowerPriorityArgument(t *testing.T) {
	workingDirectory := t.TempDir()

	roots, err := resolveRuntimeRootsFromSources(
		"explicit-install",
		"",
		runtimeRootSources{
			arguments:        []string{"--root"},
			environmentRoot:  "environment-install",
			workingDirectory: workingDirectory,
		},
	)
	if err != nil {
		t.Fatalf("resolveRuntimeRootsFromSources() error = %v", err)
	}
	wantRoot := filepath.Join(workingDirectory, "explicit-install")
	if roots.installationRoot != wantRoot {
		t.Fatalf("installation root = %q, want %q", roots.installationRoot, wantRoot)
	}
}

func TestResolveRuntimeRootsUsesRecognizableNestedApplication(t *testing.T) {
	installationRoot := t.TempDir()
	applicationRoot := filepath.Join(installationRoot, "app")
	if err := os.Mkdir(applicationRoot, 0o755); err != nil {
		t.Fatalf("os.Mkdir(app) error = %v", err)
	}
	for _, marker := range []string{"go.mod", "VERSION_APP"} {
		if err := os.WriteFile(filepath.Join(applicationRoot, marker), []byte("marker\n"), 0o644); err != nil {
			t.Fatalf("os.WriteFile(%s) error = %v", marker, err)
		}
	}

	roots, err := resolveRuntimeRootsFromSources(
		installationRoot,
		"",
		runtimeRootSources{workingDirectory: t.TempDir()},
	)
	if err != nil {
		t.Fatalf("resolveRuntimeRootsFromSources() error = %v", err)
	}
	if roots.installationRoot != installationRoot {
		t.Fatalf("installation root = %q, want %q", roots.installationRoot, installationRoot)
	}
	if roots.applicationRoot != applicationRoot {
		t.Fatalf("application root = %q, want %q", roots.applicationRoot, applicationRoot)
	}
}

func TestResolveRuntimeRootsKeepsLegacyFlatRootForIncompleteApp(t *testing.T) {
	installationRoot := t.TempDir()
	applicationRoot := filepath.Join(installationRoot, "app")
	if err := os.Mkdir(applicationRoot, 0o755); err != nil {
		t.Fatalf("os.Mkdir(app) error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(applicationRoot, "go.mod"), []byte("module example\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(go.mod) error = %v", err)
	}

	roots, err := resolveRuntimeRootsFromSources(
		installationRoot,
		"",
		runtimeRootSources{workingDirectory: t.TempDir()},
	)
	if err != nil {
		t.Fatalf("resolveRuntimeRootsFromSources() error = %v", err)
	}
	if roots.applicationRoot != installationRoot {
		t.Fatalf("application root = %q, want legacy root %q", roots.applicationRoot, installationRoot)
	}
}

func TestResolveRuntimeRootsExplicitApplicationHintWins(t *testing.T) {
	installationRoot := t.TempDir()
	nestedApplicationRoot := filepath.Join(installationRoot, "app")
	if err := os.Mkdir(nestedApplicationRoot, 0o755); err != nil {
		t.Fatalf("os.Mkdir(app) error = %v", err)
	}
	for _, marker := range []string{"go.mod", "VERSION_APP"} {
		if err := os.WriteFile(filepath.Join(nestedApplicationRoot, marker), []byte("marker\n"), 0o644); err != nil {
			t.Fatalf("os.WriteFile(%s) error = %v", marker, err)
		}
	}

	roots, err := resolveRuntimeRootsFromSources(
		installationRoot,
		"explicit-app",
		runtimeRootSources{workingDirectory: t.TempDir()},
	)
	if err != nil {
		t.Fatalf("resolveRuntimeRootsFromSources() error = %v", err)
	}
	wantApplicationRoot := filepath.Join(installationRoot, "explicit-app")
	if roots.applicationRoot != wantApplicationRoot {
		t.Fatalf("application root = %q, want %q", roots.applicationRoot, wantApplicationRoot)
	}
	if !filepath.IsAbs(roots.applicationRoot) {
		t.Fatalf("application root must be absolute: %q", roots.applicationRoot)
	}
}

func TestResolveRuntimeRootsRejectsInvalidRootArguments(t *testing.T) {
	tests := []struct {
		name      string
		arguments []string
	}{
		{name: "missing separate value", arguments: []string{"--root"}},
		{name: "empty equals value", arguments: []string{"--root="}},
		{name: "duplicate values", arguments: []string{"--root=first", "--root", "second"}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := resolveRuntimeRootsFromSources(
				"",
				"",
				runtimeRootSources{
					arguments:        test.arguments,
					workingDirectory: t.TempDir(),
				},
			)
			if err == nil {
				t.Fatal("resolveRuntimeRootsFromSources() error = nil, want argument error")
			}
		})
	}
}

func TestResolveRuntimeRootsIgnoresArgumentsAfterSeparator(t *testing.T) {
	workingDirectory := t.TempDir()

	roots, err := resolveRuntimeRootsFromSources(
		"",
		"",
		runtimeRootSources{
			arguments:        []string{"serve", "--", "--root", "child-command-root"},
			environmentRoot:  "environment-install",
			workingDirectory: workingDirectory,
		},
	)
	if err != nil {
		t.Fatalf("resolveRuntimeRootsFromSources() error = %v", err)
	}
	wantRoot := filepath.Join(workingDirectory, "environment-install")
	if roots.installationRoot != wantRoot {
		t.Fatalf("installation root = %q, want %q", roots.installationRoot, wantRoot)
	}
}
