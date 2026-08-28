// application_runner_test.go
// Verifies the shared Filterest runtime's compile-time environment safety rule.
// Exercises executable build intent against loaded and process environment values.
// Exists so an imported private launcher cannot downgrade a production build.
package application_runtime

import (
	"os"
	"path/filepath"
	"testing"
)

func TestEffectiveEnvironmentType(t *testing.T) {
	tests := []struct {
		name               string
		buildEnvironment   string
		loadedEnvironment  string
		runtimeEnvironment string
		want               string
	}{
		{
			name:               "production build cannot be downgraded",
			buildEnvironment:   "prod",
			loadedEnvironment:  "dev",
			runtimeEnvironment: "dev",
			want:               "prod",
		},
		{
			name:               "development build accepts explicit runtime production",
			buildEnvironment:   "dev",
			loadedEnvironment:  "dev",
			runtimeEnvironment: "prod",
			want:               "prod",
		},
		{
			name:              "loaded development environment remains available",
			buildEnvironment:  "dev",
			loadedEnvironment: "dev",
			want:              "dev",
		},
		{
			name:             "missing environment fails closed to production",
			buildEnvironment: "dev",
			want:             "prod",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := effectiveEnvironmentType(
				test.buildEnvironment,
				test.loadedEnvironment,
				test.runtimeEnvironment,
			)
			if got != test.want {
				t.Fatalf("effectiveEnvironmentType() = %q, want %q", got, test.want)
			}
		})
	}
}

func TestUseInstallationRuntimeLayoutRequiresExplicitNestedRoot(t *testing.T) {
	tests := []struct {
		name  string
		roots runtimeRoots
		want  bool
	}{
		{
			name: "legacy cwd remains flat",
			roots: runtimeRoots{
				installationRoot: "/workspace/filterest",
				applicationRoot:  "/workspace/filterest",
			},
		},
		{
			name: "explicit flat root remains compatible before move",
			roots: runtimeRoots{
				installationRoot:         "/workspace/filterest",
				applicationRoot:          "/workspace/filterest",
				installationRootExplicit: true,
			},
		},
		{
			name: "explicit nested app activates installation data layout",
			roots: runtimeRoots{
				installationRoot:         "/workspace/filterest",
				applicationRoot:          "/workspace/filterest/app",
				installationRootExplicit: true,
			},
			want: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := useInstallationRuntimeLayout(test.roots); got != test.want {
				t.Fatalf("useInstallationRuntimeLayout() = %t, want %t", got, test.want)
			}
		})
	}
}

func TestResolveFrontendDirectoryUsesExplicitRelocatedRoot(t *testing.T) {
	configuredRoot := t.TempDir()
	if err := os.WriteFile(filepath.Join(configuredRoot, "index.html"), []byte("ok\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile() error = %v", err)
	}
	executableRoot := t.TempDir()
	productRoot := t.TempDir()

	got, err := resolveFrontendDirectory(configuredRoot, executableRoot, productRoot)
	if err != nil {
		t.Fatalf("resolveFrontendDirectory() error = %v", err)
	}
	want, err := filepath.Abs(configuredRoot)
	if err != nil {
		t.Fatalf("filepath.Abs() error = %v", err)
	}
	if got != want {
		t.Fatalf("resolveFrontendDirectory() = %q, want %q", got, want)
	}
}

func TestResolveFrontendDirectoryFallsBackToProductRoot(t *testing.T) {
	executableRoot := t.TempDir()
	productRoot := t.TempDir()
	frontendRoot := filepath.Join(productRoot, "frontend")
	if err := os.Mkdir(frontendRoot, 0o755); err != nil {
		t.Fatalf("os.Mkdir() error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(frontendRoot, "index.html"), []byte("ok\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile() error = %v", err)
	}

	got, err := resolveFrontendDirectory("", executableRoot, productRoot)
	if err != nil {
		t.Fatalf("resolveFrontendDirectory() error = %v", err)
	}
	if got != frontendRoot {
		t.Fatalf("resolveFrontendDirectory() = %q, want %q", got, frontendRoot)
	}
}

func TestResolveFrontendDirectoryPrefersImmutableApplicationRoot(t *testing.T) {
	executableRoot := t.TempDir()
	applicationRoot := t.TempDir()
	for _, root := range []string{executableRoot, applicationRoot} {
		frontendRoot := filepath.Join(root, "frontend")
		if err := os.Mkdir(frontendRoot, 0o755); err != nil {
			t.Fatalf("os.Mkdir(frontend) error = %v", err)
		}
		if err := os.WriteFile(
			filepath.Join(frontendRoot, "index.html"),
			[]byte("ok\n"),
			0o644,
		); err != nil {
			t.Fatalf("os.WriteFile(index.html) error = %v", err)
		}
	}

	got, err := resolveFrontendDirectory("", executableRoot, applicationRoot)
	if err != nil {
		t.Fatalf("resolveFrontendDirectory() error = %v", err)
	}
	want := filepath.Join(applicationRoot, "frontend")
	if got != want {
		t.Fatalf("resolveFrontendDirectory() = %q, want immutable app %q", got, want)
	}
}

func TestResolveFrontendDirectoryFindsCanonicalNestedFrontend(t *testing.T) {
	executableRoot := t.TempDir()
	productRoot := t.TempDir()
	if err := os.Mkdir(filepath.Join(productRoot, "frontend"), 0o755); err != nil {
		t.Fatalf("os.Mkdir(private frontend) error = %v", err)
	}
	canonicalRoot := filepath.Join(productRoot, "filterest", "frontend")
	if err := os.MkdirAll(canonicalRoot, 0o755); err != nil {
		t.Fatalf("os.MkdirAll() error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(canonicalRoot, "index.html"), []byte("ok\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile() error = %v", err)
	}

	got, err := resolveFrontendDirectory("", executableRoot, productRoot)
	if err != nil {
		t.Fatalf("resolveFrontendDirectory() error = %v", err)
	}
	if got != canonicalRoot {
		t.Fatalf("resolveFrontendDirectory() = %q, want %q", got, canonicalRoot)
	}
}

func TestResolveFrontendDirectoryRejectsMissingConfiguredRoot(t *testing.T) {
	_, err := resolveFrontendDirectory(
		filepath.Join(t.TempDir(), "missing"),
		t.TempDir(),
		t.TempDir(),
	)
	if err == nil {
		t.Fatal("resolveFrontendDirectory() error = nil, want missing-root error")
	}
}
