// table_csv_runtime_paths_test.go
// Verifies CSV import and export share the approved mutable runtime directory.
// Bridges synthetic nested installations and legacy roots with table CSV path selection.
// Exists so neither the install root nor immutable app gains an unmanaged tables_data tree.
package devtools

import (
	"os"
	"path/filepath"
	"testing"

	"easelect/backend/core_components/runtimepaths"
)

func configureTableCSVRuntimePathsForTest(t *testing.T, paths runtimepaths.Paths) {
	t.Helper()
	original := runtimepaths.Current()
	workingDirectory, err := os.Getwd()
	if err != nil {
		t.Fatalf("read working directory: %v", err)
	}
	if err := runtimepaths.Configure(paths); err != nil {
		t.Fatalf("configure CSV runtime paths: %v", err)
	}
	t.Cleanup(func() {
		if err := runtimepaths.Configure(original); err == nil {
			return
		}
		legacy, resolveErr := runtimepaths.Resolve(
			workingDirectory,
			workingDirectory,
			false,
		)
		if resolveErr == nil {
			_ = runtimepaths.Configure(legacy)
		}
	})
}

func TestTableCSVDataDirUsesNestedRuntimeRoot(t *testing.T) {
	installationRoot := t.TempDir()
	applicationRoot := filepath.Join(installationRoot, "app")
	paths, err := runtimepaths.Resolve(applicationRoot, installationRoot, true)
	if err != nil {
		t.Fatalf("resolve nested runtime paths: %v", err)
	}
	configureTableCSVRuntimePathsForTest(t, paths)

	want := filepath.Join(installationRoot, "data", "runtime", "tables_data")
	if got := tableCSVDataDir(); got != want {
		t.Fatalf("tableCSVDataDir() = %q, want %q", got, want)
	}
	if got := tableCSVFilePath("app_demo"); got != filepath.Join(want, "app_demo.csv") {
		t.Fatalf("tableCSVFilePath() = %q", got)
	}
	if err := os.MkdirAll(tableCSVDataDir(), 0o755); err != nil {
		t.Fatalf("create nested CSV runtime directory: %v", err)
	}
	for _, forbidden := range []string{
		filepath.Join(applicationRoot, "tables_data"),
		filepath.Join(installationRoot, "tables_data"),
	} {
		if _, err := os.Stat(forbidden); !os.IsNotExist(err) {
			t.Fatalf("forbidden CSV directory stat = %v for %s", err, forbidden)
		}
	}
}
