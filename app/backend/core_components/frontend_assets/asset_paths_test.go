// asset_paths_test.go
// Verifies frontend asset path resolution for dev and built bundle modes.
// Bridges temp dist directories and the resolver used by Go HTML templates.
// Exists to prevent Docker/prod regressions where templates point to stale Vite hash names.
package frontendassets

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestResolveReturnsDevPathsWhenMinifiedDisabled(t *testing.T) {
	got := Resolve(t.TempDir(), false)
	want := DevPaths()

	if got != want {
		t.Fatalf("Resolve(..., false) = %+v, want %+v", got, want)
	}
}

func TestResolveUsesNewestDistAssetsWhenAvailable(t *testing.T) {
	frontendDir := t.TempDir()
	distDir := filepath.Join(frontendDir, "dist")
	if err := os.MkdirAll(distDir, 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}

	oldMain := filepath.Join(distDir, "main.old.min.js")
	newMain := filepath.Join(distDir, "main.new.min.js")
	imports := filepath.Join(distDir, "imports.hash.min.css")
	login := filepath.Join(distDir, "login.hash.min.js")

	for _, file := range []string{oldMain, newMain, imports, login} {
		if err := os.WriteFile(file, []byte("asset"), 0o644); err != nil {
			t.Fatalf("WriteFile(%q) error = %v", file, err)
		}
	}

	oldTime := time.Now().Add(-1 * time.Hour)
	if err := os.Chtimes(oldMain, oldTime, oldTime); err != nil {
		t.Fatalf("Chtimes(oldMain) error = %v", err)
	}

	got := Resolve(frontendDir, true)

	if got.ImportsCSSPath != "/frontend/dist/imports.hash.min.css" {
		t.Fatalf("ImportsCSSPath = %q", got.ImportsCSSPath)
	}
	if got.MainBundlePath != "/frontend/dist/main.new.min.js" {
		t.Fatalf("MainBundlePath = %q", got.MainBundlePath)
	}
	if got.LoginBundlePath != "/frontend/dist/login.hash.min.js" {
		t.Fatalf("LoginBundlePath = %q", got.LoginBundlePath)
	}
}

func TestResolveFallsBackWhenDistAssetsMissing(t *testing.T) {
	got := Resolve(t.TempDir(), true)
	want := DevPaths()

	if got != want {
		t.Fatalf("Resolve(..., true) fallback = %+v, want %+v", got, want)
	}
}
