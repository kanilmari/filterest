// public_bootstrap_media_creator_test.go
// Verifies safe missing-only installation of the reviewed public starter media.
// Covers exact bytes, idempotence, immutable app boundaries, and path attacks.
// Exists to protect one-time revision semantics and operator data ownership.
package startup

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

const testPublicBootstrapSource = "docs/source.bin"

func TestCanonicalPublicBootstrapMediaManifestMaterializesTwentyOneExactFiles(t *testing.T) {
	canonicalFixtureRoot := canonicalPublicBootstrapFixtureRoot(t)
	manifestBytes, err := os.ReadFile(
		filepath.Join(canonicalFixtureRoot, publicBootstrapMediaManifestName),
	)
	if err != nil {
		t.Fatalf("os.ReadFile(canonical manifest) error = %v", err)
	}
	var manifest publicBootstrapMediaManifest
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
		t.Fatalf("json.Unmarshal(canonical manifest) error = %v", err)
	}

	sourceFiles := make(map[string][]byte, len(manifest.Assets))
	destinationSources := make(map[string]string, publicBootstrapMediaAssetCount)
	for _, asset := range manifest.Assets {
		contents, err := os.ReadFile(filepath.Join(canonicalFixtureRoot, filepath.FromSlash(asset.Source)))
		if err != nil {
			t.Fatalf("os.ReadFile(%s) error = %v", asset.Source, err)
		}
		sourceFiles[asset.Source] = contents
		for _, destination := range asset.Destinations {
			destinationSources[destination] = asset.Source
		}
	}
	if got := len(destinationSources); got != publicBootstrapMediaAssetCount {
		t.Fatalf("canonical manifest destination count = %d, want %d", got, publicBootstrapMediaAssetCount)
	}

	paths := newPublicBootstrapMediaInstallation(t, manifest, sourceFiles)
	created, err := MaterializePublicBootstrapMedia(paths)
	if err != nil {
		t.Fatalf("MaterializePublicBootstrapMedia() error = %v", err)
	}
	if created != publicBootstrapMediaAssetCount {
		t.Fatalf("created file count = %d, want %d", created, publicBootstrapMediaAssetCount)
	}

	for destination, source := range destinationSources {
		got, err := os.ReadFile(filepath.Join(paths.StorageRoot, filepath.FromSlash(destination)))
		if err != nil {
			t.Fatalf("os.ReadFile(materialized %s) error = %v", destination, err)
		}
		if !bytes.Equal(got, sourceFiles[source]) {
			t.Errorf("materialized %s bytes differ from immutable source %s", destination, source)
		}
	}
	assertStorageHasNoBootstrapTemporaryFiles(t, paths.StorageRoot)
}

func TestPublicBootstrapMediaIsIdempotentAndLeavesExistingOperatorFileUntouched(t *testing.T) {
	manifest := syntheticPublicBootstrapMediaManifest(syntheticPublicBootstrapDestinations())
	paths := newPublicBootstrapMediaInstallation(
		t,
		manifest,
		map[string][]byte{testPublicBootstrapSource: []byte("immutable fixture bytes\n")},
	)

	existingRelativePath := manifest.Assets[0].Destinations[0]
	existingPath := filepath.Join(paths.StorageRoot, filepath.FromSlash(existingRelativePath))
	if err := os.MkdirAll(filepath.Dir(existingPath), 0o755); err != nil {
		t.Fatalf("os.MkdirAll(existing parent) error = %v", err)
	}
	sentinel := []byte("operator-owned replacement\n")
	if err := os.WriteFile(existingPath, sentinel, 0o600); err != nil {
		t.Fatalf("os.WriteFile(existing operator file) error = %v", err)
	}
	fixedTime := time.Unix(1_700_000_000, 123_456_789)
	if err := os.Chtimes(existingPath, fixedTime, fixedTime); err != nil {
		t.Fatalf("os.Chtimes(existing operator file) error = %v", err)
	}
	beforeInfo, err := os.Stat(existingPath)
	if err != nil {
		t.Fatalf("os.Stat(existing operator file) error = %v", err)
	}

	created, err := MaterializePublicBootstrapMedia(paths)
	if err != nil {
		t.Fatalf("first MaterializePublicBootstrapMedia() error = %v", err)
	}
	if created != publicBootstrapMediaAssetCount-1 {
		t.Fatalf("first created file count = %d, want %d", created, publicBootstrapMediaAssetCount-1)
	}
	assertOperatorFileUnchanged(t, existingPath, sentinel, beforeInfo)

	storageBefore := snapshotFilesystemTree(t, paths.StorageRoot)
	created, err = MaterializePublicBootstrapMedia(paths)
	if err != nil {
		t.Fatalf("second MaterializePublicBootstrapMedia() error = %v", err)
	}
	if created != 0 {
		t.Fatalf("second created file count = %d, want 0", created)
	}
	storageAfter := snapshotFilesystemTree(t, paths.StorageRoot)
	if !reflect.DeepEqual(storageAfter, storageBefore) {
		t.Fatal("idempotent second materialization changed installation storage")
	}
	assertOperatorFileUnchanged(t, existingPath, sentinel, beforeInfo)
	assertStorageHasNoBootstrapTemporaryFiles(t, paths.StorageRoot)
}

func TestPublicBootstrapMediaCompletionPreservesDeletionWithinOneRevision(t *testing.T) {
	manifest := syntheticPublicBootstrapMediaManifest(syntheticPublicBootstrapDestinations())
	paths := newPublicBootstrapMediaInstallation(
		t,
		manifest,
		map[string][]byte{testPublicBootstrapSource: []byte("revision-one fixture\n")},
	)
	manifestPath := publicBootstrapMediaManifestPath(paths)
	manifestBytes, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatalf("os.ReadFile(manifest) error = %v", err)
	}
	initialManifestSHA256 := fmt.Sprintf("%x", sha256.Sum256(manifestBytes))

	created, err := MaterializePublicBootstrapMedia(paths)
	if err != nil {
		t.Fatalf("first MaterializePublicBootstrapMedia() error = %v", err)
	}
	if created != publicBootstrapMediaAssetCount {
		t.Fatalf("first created file count = %d, want %d", created, publicBootstrapMediaAssetCount)
	}
	removedPath := filepath.Join(
		paths.StorageRoot,
		filepath.FromSlash(manifest.Assets[0].Destinations[0]),
	)
	if err := os.Remove(removedPath); err != nil {
		t.Fatalf("os.Remove(materialized destination) error = %v", err)
	}

	if err := os.WriteFile(manifestPath, append(manifestBytes, '\n'), 0o644); err != nil {
		t.Fatalf("os.WriteFile(whitespace-only manifest change) error = %v", err)
	}

	created, err = MaterializePublicBootstrapMedia(paths)
	if err != nil {
		t.Fatalf("same-revision MaterializePublicBootstrapMedia() error = %v", err)
	}
	if created != 0 {
		t.Fatalf("same-revision created file count = %d, want 0", created)
	}
	if _, err := os.Lstat(removedPath); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("same revision restored an operator-removed destination: %v", err)
	}
	completion := assertPublicBootstrapCompletionMarker(
		t,
		paths,
		manifest.MaterializationRevision,
	)
	if completion.ManifestSHA256 != initialManifestSHA256 {
		t.Fatalf(
			"completion manifest sha256 = %s, want original materialized manifest %s",
			completion.ManifestSHA256,
			initialManifestSHA256,
		)
	}
}

func TestPublicBootstrapMediaNewRevisionCompletesOnlyMissingDestinations(t *testing.T) {
	manifest := syntheticPublicBootstrapMediaManifest(syntheticPublicBootstrapDestinations())
	paths := newPublicBootstrapMediaInstallation(
		t,
		manifest,
		map[string][]byte{testPublicBootstrapSource: []byte("revision bump fixture\n")},
	)
	if _, err := MaterializePublicBootstrapMedia(paths); err != nil {
		t.Fatalf("revision-one MaterializePublicBootstrapMedia() error = %v", err)
	}
	removedPath := filepath.Join(
		paths.StorageRoot,
		filepath.FromSlash(manifest.Assets[0].Destinations[0]),
	)
	if err := os.Remove(removedPath); err != nil {
		t.Fatalf("os.Remove(materialized destination) error = %v", err)
	}

	manifestPath := publicBootstrapMediaManifestPath(paths)
	manifestBytes, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatalf("os.ReadFile(manifest) error = %v", err)
	}
	var revisedManifest publicBootstrapMediaManifest
	if err := json.Unmarshal(manifestBytes, &revisedManifest); err != nil {
		t.Fatalf("json.Unmarshal(manifest) error = %v", err)
	}
	revisedManifest.MaterializationRevision++
	writePublicBootstrapMediaManifest(t, manifestPath, revisedManifest)

	created, err := MaterializePublicBootstrapMedia(paths)
	if err != nil {
		t.Fatalf("revision-two MaterializePublicBootstrapMedia() error = %v", err)
	}
	if created != 1 {
		t.Fatalf("revision-two created file count = %d, want 1", created)
	}
	if _, err := os.Stat(removedPath); err != nil {
		t.Fatalf("new revision did not complete missing destination: %v", err)
	}
	assertPublicBootstrapCompletionMarker(t, paths, manifest.MaterializationRevision)
	assertPublicBootstrapCompletionMarker(t, paths, revisedManifest.MaterializationRevision)
}

func TestPublicBootstrapMediaDoesNotReplayAfterManifestRevisionDowngrade(t *testing.T) {
	manifest := syntheticPublicBootstrapMediaManifest(syntheticPublicBootstrapDestinations())
	manifest.MaterializationRevision = 2
	paths := newPublicBootstrapMediaInstallation(
		t,
		manifest,
		map[string][]byte{testPublicBootstrapSource: []byte("downgrade fixture\n")},
	)
	if _, err := MaterializePublicBootstrapMedia(paths); err != nil {
		t.Fatalf("revision-two MaterializePublicBootstrapMedia() error = %v", err)
	}
	removedPath := filepath.Join(
		paths.StorageRoot,
		filepath.FromSlash(manifest.Assets[0].Destinations[0]),
	)
	if err := os.Remove(removedPath); err != nil {
		t.Fatalf("os.Remove(materialized destination) error = %v", err)
	}

	manifestPath := publicBootstrapMediaManifestPath(paths)
	manifestBytes, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatalf("os.ReadFile(manifest) error = %v", err)
	}
	var downgradedManifest publicBootstrapMediaManifest
	if err := json.Unmarshal(manifestBytes, &downgradedManifest); err != nil {
		t.Fatalf("json.Unmarshal(manifest) error = %v", err)
	}
	downgradedManifest.MaterializationRevision = 1
	writePublicBootstrapMediaManifest(t, manifestPath, downgradedManifest)

	created, err := MaterializePublicBootstrapMedia(paths)
	if err != nil {
		t.Fatalf("downgraded MaterializePublicBootstrapMedia() error = %v", err)
	}
	if created != 0 {
		t.Fatalf("downgraded created file count = %d, want 0", created)
	}
	if _, err := os.Lstat(removedPath); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("downgrade restored an operator-removed destination: %v", err)
	}
	assertPublicBootstrapCompletionMarker(t, paths, 2)
}

func TestPublicBootstrapMediaCreatesRestrictedModesWithoutChangingExistingRoots(t *testing.T) {
	t.Run("new paths", func(t *testing.T) {
		manifest := syntheticPublicBootstrapMediaManifest(syntheticPublicBootstrapDestinations())
		paths := newPublicBootstrapMediaInstallation(
			t,
			manifest,
			map[string][]byte{testPublicBootstrapSource: []byte("restricted fixture\n")},
		)
		if _, err := MaterializePublicBootstrapMedia(paths); err != nil {
			t.Fatalf("MaterializePublicBootstrapMedia() error = %v", err)
		}

		destinationPath := filepath.Join(
			paths.StorageRoot,
			filepath.FromSlash(manifest.Assets[0].Destinations[0]),
		)
		assertModeNoBroaderThan(t, paths.DataRoot, 0o700)
		assertModeNoBroaderThan(t, filepath.Join(paths.DataRoot, "bootstrap"), 0o700)
		assertModeNoBroaderThan(t, paths.StorageRoot, 0o750)
		assertModeNoBroaderThan(t, filepath.Dir(destinationPath), 0o750)
		assertModeNoBroaderThan(t, destinationPath, 0o640)
		assertModeNoBroaderThan(
			t,
			filepath.Join(
				paths.DataRoot,
				"bootstrap",
				publicBootstrapMediaCompletionName(manifest.MaterializationRevision),
			),
			0o600,
		)
	})

	t.Run("existing roots", func(t *testing.T) {
		manifest := syntheticPublicBootstrapMediaManifest(syntheticPublicBootstrapDestinations())
		paths := newPublicBootstrapMediaInstallation(
			t,
			manifest,
			map[string][]byte{testPublicBootstrapSource: []byte("existing roots fixture\n")},
		)
		if err := os.MkdirAll(paths.StorageRoot, 0o755); err != nil {
			t.Fatalf("os.MkdirAll(existing storage) error = %v", err)
		}
		if err := os.Chmod(paths.DataRoot, 0o711); err != nil {
			t.Fatalf("os.Chmod(existing data) error = %v", err)
		}
		if err := os.Chmod(paths.StorageRoot, 0o701); err != nil {
			t.Fatalf("os.Chmod(existing storage) error = %v", err)
		}

		if _, err := MaterializePublicBootstrapMedia(paths); err != nil {
			t.Fatalf("MaterializePublicBootstrapMedia() error = %v", err)
		}
		assertExactMode(t, paths.DataRoot, 0o711)
		assertExactMode(t, paths.StorageRoot, 0o701)
	})
}

func TestPublicBootstrapMediaReadsReadOnlyApplicationWithoutWritingIt(t *testing.T) {
	manifest := syntheticPublicBootstrapMediaManifest(syntheticPublicBootstrapDestinations())
	paths := newPublicBootstrapMediaInstallation(
		t,
		manifest,
		map[string][]byte{testPublicBootstrapSource: []byte("read-only fixture\n")},
	)
	makeFilesystemTreeReadOnly(t, paths.ApplicationRoot)
	applicationBefore := snapshotFilesystemTree(t, paths.ApplicationRoot)

	created, err := MaterializePublicBootstrapMedia(paths)
	if err != nil {
		t.Fatalf("MaterializePublicBootstrapMedia() error = %v", err)
	}
	if created != publicBootstrapMediaAssetCount {
		t.Fatalf("created file count = %d, want %d", created, publicBootstrapMediaAssetCount)
	}
	applicationAfter := snapshotFilesystemTree(t, paths.ApplicationRoot)
	if !reflect.DeepEqual(applicationAfter, applicationBefore) {
		t.Fatal("materialization changed the immutable application tree")
	}
	for _, forbidden := range []string{"data", "storage"} {
		if _, err := os.Lstat(filepath.Join(paths.ApplicationRoot, forbidden)); !os.IsNotExist(err) {
			t.Fatalf("immutable app unexpectedly contains %s after startup: %v", forbidden, err)
		}
	}
}

func TestPublicBootstrapMediaRejectsLegacyFlatLayout(t *testing.T) {
	manifest := syntheticPublicBootstrapMediaManifest(syntheticPublicBootstrapDestinations())
	paths := newPublicBootstrapMediaInstallation(
		t,
		manifest,
		map[string][]byte{testPublicBootstrapSource: []byte("fixture\n")},
	)
	paths.LegacyFlat = true
	paths.DataRoot = paths.ApplicationRoot
	paths.StorageRoot = filepath.Join(paths.ApplicationRoot, "storage")

	if _, err := MaterializePublicBootstrapMedia(paths); err == nil ||
		!strings.Contains(err.Error(), "legacy flat storage") {
		t.Fatalf("legacy-flat MaterializePublicBootstrapMedia() error = %v", err)
	}
	if _, err := os.Lstat(paths.StorageRoot); !os.IsNotExist(err) {
		t.Fatalf("legacy-flat startup created app/storage: %v", err)
	}
}

func TestPublicBootstrapMediaManifestRequiresExactlyTwentyOneDestinations(t *testing.T) {
	destinations := syntheticPublicBootstrapDestinations()[:publicBootstrapMediaAssetCount-1]
	manifest := syntheticPublicBootstrapMediaManifest(destinations)
	paths := newPublicBootstrapMediaInstallation(
		t,
		manifest,
		map[string][]byte{testPublicBootstrapSource: []byte("fixture\n")},
	)

	if _, err := MaterializePublicBootstrapMedia(paths); err == nil ||
		!strings.Contains(err.Error(), "want exactly 21") {
		t.Fatalf("short manifest MaterializePublicBootstrapMedia() error = %v", err)
	}
	if _, err := os.Lstat(paths.DataRoot); !os.IsNotExist(err) {
		t.Fatalf("invalid manifest created mutable data before failing: %v", err)
	}
}

func TestPublicBootstrapMediaRejectsSourceHashMismatchBeforeMutableWrites(t *testing.T) {
	manifest := syntheticPublicBootstrapMediaManifest(syntheticPublicBootstrapDestinations())
	paths := newPublicBootstrapMediaInstallation(
		t,
		manifest,
		map[string][]byte{testPublicBootstrapSource: []byte("reviewed fixture\n")},
	)
	manifestPath := publicBootstrapMediaManifestPath(paths)
	manifestBytes, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatalf("os.ReadFile(manifest) error = %v", err)
	}
	var corruptedManifest publicBootstrapMediaManifest
	if err := json.Unmarshal(manifestBytes, &corruptedManifest); err != nil {
		t.Fatalf("json.Unmarshal(manifest) error = %v", err)
	}
	corruptedManifest.Assets[0].SourceSHA256 = strings.Repeat("f", sha256.Size*2)
	writePublicBootstrapMediaManifest(t, manifestPath, corruptedManifest)

	if _, err := MaterializePublicBootstrapMedia(paths); err == nil ||
		!strings.Contains(err.Error(), "sha256") {
		t.Fatalf("hash-mismatch MaterializePublicBootstrapMedia() error = %v", err)
	}
	if _, err := os.Lstat(paths.DataRoot); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("hash mismatch created mutable data before failing: %v", err)
	}
}

func TestPublicBootstrapMediaRejectsTraversalPaths(t *testing.T) {
	t.Run("source", func(t *testing.T) {
		manifest := syntheticPublicBootstrapMediaManifest(syntheticPublicBootstrapDestinations())
		manifest.Assets[0].Source = "../outside.bin"
		paths := newPublicBootstrapMediaInstallation(t, manifest, nil)

		if _, err := MaterializePublicBootstrapMedia(paths); err == nil ||
			!strings.Contains(err.Error(), "unsafe component") {
			t.Fatalf("source traversal MaterializePublicBootstrapMedia() error = %v", err)
		}
	})

	t.Run("destination", func(t *testing.T) {
		destinations := syntheticPublicBootstrapDestinations()
		destinations[0] = "../outside.bin"
		manifest := syntheticPublicBootstrapMediaManifest(destinations)
		paths := newPublicBootstrapMediaInstallation(
			t,
			manifest,
			map[string][]byte{testPublicBootstrapSource: []byte("fixture\n")},
		)

		if _, err := MaterializePublicBootstrapMedia(paths); err == nil ||
			!strings.Contains(err.Error(), "unsafe component") {
			t.Fatalf("destination traversal MaterializePublicBootstrapMedia() error = %v", err)
		}
		outsidePath := filepath.Join(paths.InstallationRoot, "data", "outside.bin")
		if _, err := os.Lstat(outsidePath); !os.IsNotExist(err) {
			t.Fatalf("destination traversal created an escaping file: %v", err)
		}
	})
}

func TestPublicBootstrapMediaRejectsApplicationAndStorageSymlinks(t *testing.T) {
	t.Run("application root", func(t *testing.T) {
		manifest := syntheticPublicBootstrapMediaManifest(syntheticPublicBootstrapDestinations())
		paths := newPublicBootstrapMediaInstallation(
			t,
			manifest,
			map[string][]byte{testPublicBootstrapSource: []byte("fixture\n")},
		)
		realApplicationRoot := filepath.Join(t.TempDir(), "real-app")
		if err := os.Rename(paths.ApplicationRoot, realApplicationRoot); err != nil {
			t.Fatalf("os.Rename(application root) error = %v", err)
		}
		if err := os.Symlink(realApplicationRoot, paths.ApplicationRoot); err != nil {
			t.Skipf("symlinks unavailable: %v", err)
		}

		if _, err := MaterializePublicBootstrapMedia(paths); err == nil ||
			!strings.Contains(err.Error(), "not a symlink") {
			t.Fatalf("application-root symlink MaterializePublicBootstrapMedia() error = %v", err)
		}
	})

	t.Run("fixture source", func(t *testing.T) {
		manifest := syntheticPublicBootstrapMediaManifest(syntheticPublicBootstrapDestinations())
		paths := newPublicBootstrapMediaInstallation(t, manifest, nil)
		externalSource := filepath.Join(t.TempDir(), "outside.bin")
		if err := os.WriteFile(externalSource, []byte("outside\n"), 0o644); err != nil {
			t.Fatalf("os.WriteFile(external source) error = %v", err)
		}
		sourcePath := filepath.Join(
			paths.ApplicationRoot,
			filepath.FromSlash(publicBootstrapFixtureRootRelative),
			filepath.FromSlash(testPublicBootstrapSource),
		)
		if err := os.MkdirAll(filepath.Dir(sourcePath), 0o755); err != nil {
			t.Fatalf("os.MkdirAll(source parent) error = %v", err)
		}
		if err := os.Symlink(externalSource, sourcePath); err != nil {
			t.Skipf("symlinks unavailable: %v", err)
		}

		if _, err := MaterializePublicBootstrapMedia(paths); err == nil ||
			!strings.Contains(err.Error(), "symbolic links") {
			t.Fatalf("source symlink MaterializePublicBootstrapMedia() error = %v", err)
		}
	})

	t.Run("storage root", func(t *testing.T) {
		manifest := syntheticPublicBootstrapMediaManifest(syntheticPublicBootstrapDestinations())
		paths := newPublicBootstrapMediaInstallation(
			t,
			manifest,
			map[string][]byte{testPublicBootstrapSource: []byte("fixture\n")},
		)
		if err := os.MkdirAll(paths.DataRoot, 0o755); err != nil {
			t.Fatalf("os.MkdirAll(data root) error = %v", err)
		}
		externalStorage := t.TempDir()
		if err := os.Symlink(externalStorage, paths.StorageRoot); err != nil {
			t.Skipf("symlinks unavailable: %v", err)
		}

		if _, err := MaterializePublicBootstrapMedia(paths); err == nil ||
			!strings.Contains(err.Error(), "real directory") {
			t.Fatalf("storage-root symlink MaterializePublicBootstrapMedia() error = %v", err)
		}
		entries, err := os.ReadDir(externalStorage)
		if err != nil {
			t.Fatalf("os.ReadDir(external storage) error = %v", err)
		}
		if len(entries) != 0 {
			t.Fatalf("storage-root symlink target received %d entries", len(entries))
		}
	})

	t.Run("storage destination parent", func(t *testing.T) {
		manifest := syntheticPublicBootstrapMediaManifest(syntheticPublicBootstrapDestinations())
		paths := newPublicBootstrapMediaInstallation(
			t,
			manifest,
			map[string][]byte{testPublicBootstrapSource: []byte("fixture\n")},
		)
		if err := os.MkdirAll(paths.StorageRoot, 0o755); err != nil {
			t.Fatalf("os.MkdirAll(storage root) error = %v", err)
		}
		externalStorage := t.TempDir()
		if err := os.Symlink(externalStorage, filepath.Join(paths.StorageRoot, "9")); err != nil {
			t.Skipf("symlinks unavailable: %v", err)
		}

		if _, err := MaterializePublicBootstrapMedia(paths); err == nil ||
			!strings.Contains(err.Error(), "symbolic links") {
			t.Fatalf("destination-parent symlink MaterializePublicBootstrapMedia() error = %v", err)
		}
		entries, err := os.ReadDir(externalStorage)
		if err != nil {
			t.Fatalf("os.ReadDir(external destination) error = %v", err)
		}
		if len(entries) != 0 {
			t.Fatalf("destination-parent symlink target received %d entries", len(entries))
		}
	})
}

func TestPublicBootstrapMediaRejectsNonRegularExistingDestination(t *testing.T) {
	manifest := syntheticPublicBootstrapMediaManifest(syntheticPublicBootstrapDestinations())
	paths := newPublicBootstrapMediaInstallation(
		t,
		manifest,
		map[string][]byte{testPublicBootstrapSource: []byte("fixture\n")},
	)
	existingPath := filepath.Join(
		paths.StorageRoot,
		filepath.FromSlash(manifest.Assets[0].Destinations[0]),
	)
	if err := os.MkdirAll(existingPath, 0o755); err != nil {
		t.Fatalf("os.MkdirAll(non-regular destination) error = %v", err)
	}

	if _, err := MaterializePublicBootstrapMedia(paths); err == nil ||
		!strings.Contains(err.Error(), "regular operator file") {
		t.Fatalf("directory destination MaterializePublicBootstrapMedia() error = %v", err)
	}
	info, err := os.Lstat(existingPath)
	if err != nil || !info.IsDir() {
		t.Fatalf("non-regular operator path was changed: info=%v error=%v", info, err)
	}
}

func TestPublicBootstrapMediaConcurrentStartsCreateEachDestinationOnce(t *testing.T) {
	manifest := syntheticPublicBootstrapMediaManifest(syntheticPublicBootstrapDestinations())
	fixtureBytes := []byte("concurrent immutable fixture bytes\n")
	paths := newPublicBootstrapMediaInstallation(
		t,
		manifest,
		map[string][]byte{testPublicBootstrapSource: fixtureBytes},
	)

	type result struct {
		created int
		err     error
	}
	results := make(chan result, 2)
	var waitGroup sync.WaitGroup
	for worker := 0; worker < 2; worker++ {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			created, err := MaterializePublicBootstrapMedia(paths)
			results <- result{created: created, err: err}
		}()
	}
	waitGroup.Wait()
	close(results)

	totalCreated := 0
	for result := range results {
		if result.err != nil {
			t.Fatalf("concurrent MaterializePublicBootstrapMedia() error = %v", result.err)
		}
		totalCreated += result.created
	}
	if totalCreated != publicBootstrapMediaAssetCount {
		t.Fatalf("concurrent total created count = %d, want %d", totalCreated, publicBootstrapMediaAssetCount)
	}
	for _, destination := range manifest.Assets[0].Destinations {
		contents, err := os.ReadFile(filepath.Join(paths.StorageRoot, filepath.FromSlash(destination)))
		if err != nil {
			t.Fatalf("os.ReadFile(concurrent destination %s) error = %v", destination, err)
		}
		if !bytes.Equal(contents, fixtureBytes) {
			t.Errorf("concurrent destination %s has wrong bytes", destination)
		}
	}
	assertStorageHasNoBootstrapTemporaryFiles(t, paths.StorageRoot)
}

func TestExclusivePublishConflictRequiresDestinationToRemainPresent(t *testing.T) {
	storagePath := t.TempDir()
	storageRoot, err := os.OpenRoot(storagePath)
	if err != nil {
		t.Fatalf("os.OpenRoot(storage) error = %v", err)
	}
	defer storageRoot.Close()

	err = requireDestinationAfterExclusivePublishConflict(storageRoot, "missing.bin")
	if err == nil || !strings.Contains(err.Error(), "disappeared before verification") {
		t.Fatalf("missing conflict destination error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(storagePath, "present.bin"), []byte("present\n"), 0o600); err != nil {
		t.Fatalf("os.WriteFile(present destination) error = %v", err)
	}
	if err := requireDestinationAfterExclusivePublishConflict(storageRoot, "present.bin"); err != nil {
		t.Fatalf("present conflict destination error = %v", err)
	}
}
