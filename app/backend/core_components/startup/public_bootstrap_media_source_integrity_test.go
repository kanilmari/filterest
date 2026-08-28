// public_bootstrap_media_source_integrity_test.go
// Verifies reopened starter-media bytes cannot change after manifest validation.
// Connects the private validation seam to destination and completion-marker checks.
// Exists to prevent time-of-check/time-of-use publication of unreviewed media.
package startup

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPublicBootstrapMediaRejectsSourceChangeBetweenValidationAndMaterialization(t *testing.T) {
	manifest := syntheticPublicBootstrapMediaManifest(syntheticPublicBootstrapDestinations())
	paths := newPublicBootstrapMediaInstallation(
		t,
		manifest,
		map[string][]byte{testPublicBootstrapSource: []byte("reviewed fixture bytes\n")},
	)
	sourcePath := filepath.Join(
		paths.ApplicationRoot,
		filepath.FromSlash(publicBootstrapFixtureRootRelative),
		filepath.FromSlash(testPublicBootstrapSource),
	)

	created, err := materializePublicBootstrapMedia(paths, func() error {
		return os.WriteFile(sourcePath, []byte("changed after validation\n"), 0o644)
	})
	if err == nil || !strings.Contains(err.Error(), "sha256 changed before materialization") {
		t.Fatalf("changed-source materialization error = %v", err)
	}
	if created != 0 {
		t.Fatalf("changed-source created file count = %d, want 0", created)
	}
	for _, destination := range manifest.Assets[0].Destinations {
		if _, err := os.Lstat(filepath.Join(paths.StorageRoot, filepath.FromSlash(destination))); !os.IsNotExist(err) {
			t.Fatalf("unverified destination %s was published: %v", destination, err)
		}
	}
	markerPath := filepath.Join(
		paths.DataRoot,
		"bootstrap",
		publicBootstrapMediaCompletionName(manifest.MaterializationRevision),
	)
	if _, err := os.Lstat(markerPath); !os.IsNotExist(err) {
		t.Fatalf("completion marker was published for changed source: %v", err)
	}
}
