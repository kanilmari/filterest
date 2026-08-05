// version_check_test.go
// Tests startup version marker selection for private and public checkouts.
// Bridges temporary project roots and version logging helpers.
// Exists so Filterest can use VERSION_APP without regressing private Easelect.
package startup

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadApplicationVersionFilePrefersEaselectMarker(t *testing.T) {
	root := t.TempDir()
	mustWriteVersionFile(t, root, "VERSION_EASELECT", "8.0.17\n")
	mustWriteVersionFile(t, root, "VERSION_APP", "8.0.16\n")

	version, fileName, err := readApplicationVersionFile(root)
	if err != nil {
		t.Fatal(err)
	}
	if version != "8.0.17" || fileName != "VERSION_EASELECT" {
		t.Fatalf("version/file = %q/%q, want 8.0.17/VERSION_EASELECT", version, fileName)
	}
}

func TestReadApplicationVersionFileFallsBackToPublicMarker(t *testing.T) {
	root := t.TempDir()
	mustWriteVersionFile(t, root, "VERSION_APP", "8.0.17\n")

	version, fileName, err := readApplicationVersionFile(root)
	if err != nil {
		t.Fatal(err)
	}
	if version != "8.0.17" || fileName != "VERSION_APP" {
		t.Fatalf("version/file = %q/%q, want 8.0.17/VERSION_APP", version, fileName)
	}
}

func TestDatabaseCompatibilityUsesFullTrackedVersion(t *testing.T) {
	tests := []struct {
		name     string
		required string
		actual   string
		want     bool
	}{
		{name: "older patch is rejected", required: "8.0.57", actual: "8.0.30", want: false},
		{name: "same version is accepted", required: "8.0.57", actual: "8.0.57", want: true},
		{name: "newer patch is accepted", required: "8.0.57", actual: "8.0.58", want: true},
		{name: "newer minor is accepted", required: "8.0.57", actual: "8.1.0", want: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isCompatible(test.required, test.actual); got != test.want {
				t.Fatalf("isCompatible(%q, %q) = %v, want %v", test.required, test.actual, got, test.want)
			}
		})
	}
}

func mustWriteVersionFile(t *testing.T, root string, fileName string, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(root, fileName), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}
