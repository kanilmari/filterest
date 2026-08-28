// public_bootstrap_media_test_support_test.go
// Provides isolated installation fixtures and filesystem assertions for media tests.
// Connects synthetic manifests and immutable sources to observable operator storage.
// Exists so runtime-media tests share one concise, security-aware test vocabulary.
package startup

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"easelect/backend/core_components/runtimepaths"
)

func canonicalPublicBootstrapFixtureRoot(t *testing.T) string {
	t.Helper()
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller() did not return the test file path")
	}
	applicationRoot := filepath.Clean(filepath.Join(filepath.Dir(currentFile), "..", "..", ".."))
	return filepath.Join(applicationRoot, filepath.FromSlash(publicBootstrapFixtureRootRelative))
}

func syntheticPublicBootstrapDestinations() []string {
	destinations := make([]string, 0, publicBootstrapMediaAssetCount)
	destinations = append(destinations, "9/1/original/9_1_1.bin")
	for index := 1; index < publicBootstrapMediaAssetCount; index++ {
		destinations = append(
			destinations,
			fmt.Sprintf("test/1/variant-%02d/test_1_%02d.bin", index, index),
		)
	}
	return destinations
}

func syntheticPublicBootstrapMediaManifest(
	destinations []string,
) publicBootstrapMediaManifest {
	return publicBootstrapMediaManifest{
		SchemaVersion:           1,
		MaterializationRevision: 1,
		Assets: []publicBootstrapMediaAsset{
			{
				Source:       testPublicBootstrapSource,
				SourceSHA256: strings.Repeat("0", sha256.Size*2),
				Destinations: append([]string(nil), destinations...),
			},
		},
	}
}

func newPublicBootstrapMediaInstallation(
	t *testing.T,
	manifest publicBootstrapMediaManifest,
	sourceFiles map[string][]byte,
) runtimepaths.Paths {
	t.Helper()
	manifest.Assets = append([]publicBootstrapMediaAsset(nil), manifest.Assets...)
	for assetIndex := range manifest.Assets {
		manifest.Assets[assetIndex].Destinations = append(
			[]string(nil),
			manifest.Assets[assetIndex].Destinations...,
		)
		if sourceContents, exists := sourceFiles[manifest.Assets[assetIndex].Source]; exists {
			manifest.Assets[assetIndex].SourceSHA256 = fmt.Sprintf(
				"%x",
				sha256.Sum256(sourceContents),
			)
		}
	}
	installationRoot := t.TempDir()
	applicationRoot := filepath.Join(installationRoot, "app")
	fixtureRoot := filepath.Join(
		applicationRoot,
		filepath.FromSlash(publicBootstrapFixtureRootRelative),
	)
	if err := os.MkdirAll(fixtureRoot, 0o755); err != nil {
		t.Fatalf("os.MkdirAll(fixture root) error = %v", err)
	}
	for source, contents := range sourceFiles {
		sourcePath := filepath.Join(fixtureRoot, filepath.FromSlash(source))
		if err := os.MkdirAll(filepath.Dir(sourcePath), 0o755); err != nil {
			t.Fatalf("os.MkdirAll(source parent %s) error = %v", source, err)
		}
		if err := os.WriteFile(sourcePath, contents, 0o644); err != nil {
			t.Fatalf("os.WriteFile(source %s) error = %v", source, err)
		}
	}
	writePublicBootstrapMediaManifest(
		t,
		filepath.Join(fixtureRoot, publicBootstrapMediaManifestName),
		manifest,
	)

	paths, err := runtimepaths.Resolve(applicationRoot, installationRoot, true)
	if err != nil {
		t.Fatalf("runtimepaths.Resolve() error = %v", err)
	}
	return paths
}

func publicBootstrapMediaManifestPath(paths runtimepaths.Paths) string {
	return filepath.Join(
		paths.ApplicationRoot,
		filepath.FromSlash(publicBootstrapFixtureRootRelative),
		publicBootstrapMediaManifestName,
	)
}

func writePublicBootstrapMediaManifest(
	t *testing.T,
	manifestPath string,
	manifest publicBootstrapMediaManifest,
) {
	t.Helper()
	manifestBytes, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		t.Fatalf("json.MarshalIndent(manifest) error = %v", err)
	}
	manifestBytes = append(manifestBytes, '\n')
	if err := os.WriteFile(manifestPath, manifestBytes, 0o644); err != nil {
		t.Fatalf("os.WriteFile(manifest) error = %v", err)
	}
}

func assertPublicBootstrapCompletionMarker(
	t *testing.T,
	paths runtimepaths.Paths,
	materializationRevision int,
) publicBootstrapMediaCompletion {
	t.Helper()
	markerPath := filepath.Join(
		paths.DataRoot,
		"bootstrap",
		publicBootstrapMediaCompletionName(materializationRevision),
	)
	markerBytes, err := os.ReadFile(markerPath)
	if err != nil {
		t.Fatalf("os.ReadFile(completion marker) error = %v", err)
	}
	var completion publicBootstrapMediaCompletion
	if err := json.Unmarshal(markerBytes, &completion); err != nil {
		t.Fatalf("json.Unmarshal(completion marker) error = %v", err)
	}
	if completion.SchemaVersion != publicBootstrapMarkerSchemaVersion ||
		completion.MaterializationRevision != materializationRevision ||
		!isLowerHexSHA256(completion.ManifestSHA256) {
		t.Fatalf("completion marker = %#v, want revision %d", completion, materializationRevision)
	}
	return completion
}

func assertModeNoBroaderThan(t *testing.T, path string, wanted fs.FileMode) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("os.Stat(%s) error = %v", path, err)
	}
	actual := info.Mode().Perm()
	if actual&^wanted != 0 || actual&0o700 != wanted&0o700 {
		t.Fatalf("mode for %s = %#o, want no broader than %#o", path, actual, wanted)
	}
}

func assertExactMode(t *testing.T, path string, wanted fs.FileMode) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("os.Stat(%s) error = %v", path, err)
	}
	if actual := info.Mode().Perm(); actual != wanted {
		t.Fatalf("mode for %s = %#o, want %#o", path, actual, wanted)
	}
}

type filesystemSnapshotEntry struct {
	Mode            fs.FileMode
	ModificationNS  int64
	RegularContents []byte
}

func snapshotFilesystemTree(t *testing.T, root string) map[string]filesystemSnapshotEntry {
	t.Helper()
	snapshot := make(map[string]filesystemSnapshotEntry)
	err := filepath.WalkDir(root, func(currentPath string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		relativePath, err := filepath.Rel(root, currentPath)
		if err != nil {
			return err
		}
		snapshotEntry := filesystemSnapshotEntry{
			Mode:           info.Mode(),
			ModificationNS: info.ModTime().UnixNano(),
		}
		if info.Mode().IsRegular() {
			snapshotEntry.RegularContents, err = os.ReadFile(currentPath)
			if err != nil {
				return err
			}
		}
		snapshot[relativePath] = snapshotEntry
		return nil
	})
	if err != nil {
		t.Fatalf("filepath.WalkDir(%s) error = %v", root, err)
	}
	return snapshot
}

func makeFilesystemTreeReadOnly(t *testing.T, root string) {
	t.Helper()
	t.Cleanup(func() {
		_ = filepath.WalkDir(root, func(currentPath string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return nil
			}
			if entry.IsDir() {
				_ = os.Chmod(currentPath, 0o755)
			} else {
				_ = os.Chmod(currentPath, 0o644)
			}
			return nil
		})
	})
	if err := filepath.WalkDir(root, func(currentPath string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return os.Chmod(currentPath, 0o555)
		}
		return os.Chmod(currentPath, 0o444)
	}); err != nil {
		t.Fatalf("make application tree read-only: %v", err)
	}
}

func assertOperatorFileUnchanged(
	t *testing.T,
	path string,
	wantContents []byte,
	beforeInfo fs.FileInfo,
) {
	t.Helper()
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("os.ReadFile(operator file) error = %v", err)
	}
	if !bytes.Equal(contents, wantContents) {
		t.Fatalf("operator file contents = %q, want %q", contents, wantContents)
	}
	afterInfo, err := os.Stat(path)
	if err != nil {
		t.Fatalf("os.Stat(operator file) error = %v", err)
	}
	if !os.SameFile(beforeInfo, afterInfo) {
		t.Fatal("operator file inode changed")
	}
	if afterInfo.Mode() != beforeInfo.Mode() {
		t.Fatalf("operator file mode = %v, want %v", afterInfo.Mode(), beforeInfo.Mode())
	}
	if !afterInfo.ModTime().Equal(beforeInfo.ModTime()) {
		t.Fatalf("operator file modification time = %v, want %v", afterInfo.ModTime(), beforeInfo.ModTime())
	}
}

func assertStorageHasNoBootstrapTemporaryFiles(t *testing.T, storageRoot string) {
	t.Helper()
	err := filepath.WalkDir(storageRoot, func(_ string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if strings.HasPrefix(entry.Name(), ".filterest-bootstrap-media-") {
			t.Errorf("temporary bootstrap media file remains in storage: %s", entry.Name())
		}
		return nil
	})
	if err != nil {
		t.Fatalf("filepath.WalkDir(storage) error = %v", err)
	}
}
