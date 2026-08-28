// public_bootstrap_media_creator.go
// Materializes reviewed public starter media into mutable installation storage.
// Bridges immutable app fixtures with revision-marked operator-owned data.
// Exists so starter images appear once without restoring deliberate deletions.
package startup

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"

	"easelect/backend/core_components/runtimepaths"
)

const (
	publicBootstrapFixtureRootRelative = "server_tools/public_bootstrap/source/fixtures"
	publicBootstrapMediaManifestName   = "runtime_media.v1.json"
	publicBootstrapMediaAssetCount     = 21
	publicBootstrapMarkerSchemaVersion = 1
	publicBootstrapMarkerPrefix        = "public-bootstrap-media-r"
	publicBootstrapMarkerSuffix        = ".complete.json"
)

type publicBootstrapMediaManifest struct {
	SchemaVersion           int                         `json:"schema_version"`
	MaterializationRevision int                         `json:"materialization_revision"`
	Assets                  []publicBootstrapMediaAsset `json:"assets"`
}

type publicBootstrapMediaAsset struct {
	Source       string   `json:"source"`
	SourceSHA256 string   `json:"source_sha256"`
	Destinations []string `json:"destinations"`
}

type publicBootstrapMediaManifestDocument struct {
	Manifest publicBootstrapMediaManifest
	SHA256   string
}

type publicBootstrapMediaCompletion struct {
	SchemaVersion           int    `json:"schema_version"`
	MaterializationRevision int    `json:"materialization_revision"`
	ManifestSHA256          string `json:"manifest_sha256"`
}

// MaterializePublicBootstrapMedia copies only missing reviewed starter media
// from the immutable app into installation-owned data/storage. It refuses the
// legacy flat layout so this startup task can never create mutable app/storage.
// A monotonic completion revision prevents later restarts from restoring deletions.
func MaterializePublicBootstrapMedia(paths runtimepaths.Paths) (int, error) {
	return materializePublicBootstrapMedia(paths, nil)
}

// materializePublicBootstrapMedia keeps a narrow post-validation callback so
// tests can deterministically prove that reopened source bytes are rechecked.
func materializePublicBootstrapMedia(
	paths runtimepaths.Paths,
	afterManifestValidation func() error,
) (int, error) {
	if err := validatePublicBootstrapMediaLayout(paths); err != nil {
		return 0, err
	}

	applicationRoot, err := openVerifiedRealRoot(paths.ApplicationRoot, "application root")
	if err != nil {
		return 0, err
	}
	defer applicationRoot.Close()

	document, err := loadPublicBootstrapMediaManifest(applicationRoot)
	if err != nil {
		return 0, err
	}
	if err := validatePublicBootstrapMediaManifestIdentity(document.Manifest); err != nil {
		return 0, err
	}
	existingBootstrapRoot, bootstrapRootExists, err := openExistingPublicBootstrapRoot(paths)
	if err != nil {
		return 0, err
	}
	if bootstrapRootExists {
		completed, completionErr := publicBootstrapMediaCompletionAtOrAboveExists(
			existingBootstrapRoot,
			document.Manifest.MaterializationRevision,
		)
		closeErr := existingBootstrapRoot.Close()
		if completionErr != nil {
			return 0, completionErr
		}
		if closeErr != nil {
			return 0, fmt.Errorf("close public bootstrap root: %w", closeErr)
		}
		if completed {
			return 0, nil
		}
	}
	if err := validatePublicBootstrapMediaManifest(applicationRoot, document.Manifest); err != nil {
		return 0, err
	}
	if afterManifestValidation != nil {
		if err := afterManifestValidation(); err != nil {
			return 0, fmt.Errorf("after public bootstrap media manifest validation: %w", err)
		}
	}

	dataRoot, err := preparePublicBootstrapDataRoot(paths)
	if err != nil {
		return 0, err
	}
	defer dataRoot.Close()
	bootstrapRoot, err := preparePublicBootstrapChildRoot(
		dataRoot,
		paths.DataRoot,
		"bootstrap",
		0o700,
	)
	if err != nil {
		return 0, fmt.Errorf("prepare public bootstrap completion state: %w", err)
	}
	defer bootstrapRoot.Close()

	completed, err := publicBootstrapMediaCompletionAtOrAboveExists(
		bootstrapRoot,
		document.Manifest.MaterializationRevision,
	)
	if err != nil {
		return 0, err
	}
	if completed {
		return 0, nil
	}

	storageRoot, err := preparePublicBootstrapChildRoot(
		dataRoot,
		paths.DataRoot,
		"storage",
		0o750,
	)
	if err != nil {
		return 0, fmt.Errorf("prepare public bootstrap media storage: %w", err)
	}
	defer storageRoot.Close()

	createdCount := 0
	for _, asset := range document.Manifest.Assets {
		createdForAsset, materializeErr := materializePublicBootstrapMediaAsset(
			applicationRoot,
			storageRoot,
			asset,
		)
		if materializeErr != nil {
			return createdCount, materializeErr
		}
		createdCount += createdForAsset
	}
	if err := verifyPublicBootstrapMediaDestinations(storageRoot, document.Manifest); err != nil {
		return createdCount, err
	}
	// Persist the data-root entries for bootstrap/ and storage/ before the
	// completion marker can become durable. Destination subtrees are synced by
	// verifyPublicBootstrapMediaDestinations after all 21 paths exist.
	if err := syncVerifiedRealDirectory(dataRoot, ".", "public bootstrap data root"); err != nil {
		return createdCount, err
	}
	if err := writePublicBootstrapMediaCompletion(
		bootstrapRoot,
		document.Manifest.MaterializationRevision,
		document.SHA256,
	); err != nil {
		return createdCount, err
	}

	return createdCount, nil
}

func validatePublicBootstrapMediaLayout(paths runtimepaths.Paths) error {
	if paths.LegacyFlat {
		return fmt.Errorf(
			"public bootstrap media requires the immutable app layout; legacy flat storage beside the app is forbidden; set FILTEREST_ROOT or --root to the installation directory",
		)
	}

	expectedApplicationRoot := filepath.Join(paths.InstallationRoot, "app")
	expectedDataRoot := filepath.Join(paths.InstallationRoot, "data")
	expectedStorageRoot := filepath.Join(expectedDataRoot, "storage")
	if filepath.Clean(paths.ApplicationRoot) != filepath.Clean(expectedApplicationRoot) ||
		filepath.Clean(paths.DataRoot) != filepath.Clean(expectedDataRoot) ||
		filepath.Clean(paths.StorageRoot) != filepath.Clean(expectedStorageRoot) {
		return fmt.Errorf(
			"public bootstrap media requires immutable app/ and mutable data/storage below one installation root",
		)
	}
	return nil
}

func materializePublicBootstrapMediaAsset(
	applicationRoot *os.Root,
	storageRoot *os.Root,
	asset publicBootstrapMediaAsset,
) (int, error) {
	missingDestinations := make([]string, 0, len(asset.Destinations))
	for _, destination := range asset.Destinations {
		exists, err := realDestinationExists(storageRoot, destination)
		if err != nil {
			return 0, err
		}
		if !exists {
			missingDestinations = append(missingDestinations, destination)
		}
	}
	if len(missingDestinations) == 0 {
		return 0, nil
	}

	sourceRelativePath := path.Join(publicBootstrapFixtureRootRelative, asset.Source)
	sourceFile, err := openVerifiedRegularFile(
		applicationRoot,
		sourceRelativePath,
		"public bootstrap media source",
	)
	if err != nil {
		return 0, err
	}
	defer sourceFile.Close()
	sourceBytes, err := io.ReadAll(sourceFile)
	if err != nil {
		return 0, fmt.Errorf("read public bootstrap media source %s: %w", asset.Source, err)
	}
	if actualSHA256 := fmt.Sprintf("%x", sha256.Sum256(sourceBytes)); actualSHA256 != asset.SourceSHA256 {
		return 0, fmt.Errorf(
			"public bootstrap media source %s sha256 changed before materialization: got %s, want %s",
			asset.Source,
			actualSHA256,
			asset.SourceSHA256,
		)
	}

	createdCount := 0
	for _, destination := range missingDestinations {
		parentDirectory := path.Dir(destination)
		if parentDirectory != "." {
			if err := ensureRealDirectory(storageRoot, parentDirectory, 0o750); err != nil {
				return createdCount, fmt.Errorf(
					"prepare public bootstrap media destination %s: %w",
					destination,
					err,
				)
			}
		}
		created, err := installAtomicMissingFile(
			storageRoot,
			destination,
			bytes.NewReader(sourceBytes),
			0o640,
		)
		if err != nil {
			return createdCount, fmt.Errorf(
				"materialize public bootstrap media %s -> %s: %w",
				asset.Source,
				destination,
				err,
			)
		}
		if created {
			createdCount++
		}
	}
	return createdCount, nil
}

func verifyPublicBootstrapMediaDestinations(
	storageRoot *os.Root,
	manifest publicBootstrapMediaManifest,
) error {
	directoriesToSync := map[string]struct{}{".": {}}
	for _, asset := range manifest.Assets {
		for _, destination := range asset.Destinations {
			exists, err := realDestinationExists(storageRoot, destination)
			if err != nil {
				return err
			}
			if !exists {
				return fmt.Errorf(
					"public bootstrap media destination is missing after materialization: %s",
					destination,
				)
			}
			for directory := path.Dir(destination); directory != "."; directory = path.Dir(directory) {
				directoriesToSync[directory] = struct{}{}
			}
		}
	}
	directories := make([]string, 0, len(directoriesToSync))
	for directory := range directoriesToSync {
		directories = append(directories, directory)
	}
	sort.Strings(directories)
	for _, directory := range directories {
		if err := syncVerifiedRealDirectory(
			storageRoot,
			directory,
			"public bootstrap media destination directory",
		); err != nil {
			return err
		}
	}
	return nil
}
