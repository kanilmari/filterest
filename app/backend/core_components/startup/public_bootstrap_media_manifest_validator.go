// public_bootstrap_media_manifest_validator.go
// Validates public starter-media identity, hashes, counts, and relative paths.
// Connects immutable manifest declarations to safe source and destination rules.
// Exists so no mutable installation path is touched before the full contract passes.
package startup

import (
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
)

func validatePublicBootstrapMediaManifestIdentity(
	manifest publicBootstrapMediaManifest,
) error {
	if manifest.SchemaVersion != 1 {
		return fmt.Errorf(
			"public bootstrap media manifest schema_version = %d, want 1",
			manifest.SchemaVersion,
		)
	}
	if manifest.MaterializationRevision < 1 {
		return fmt.Errorf(
			"public bootstrap media manifest materialization_revision = %d, want a positive integer",
			manifest.MaterializationRevision,
		)
	}
	return nil
}

func validatePublicBootstrapMediaManifest(
	applicationRoot *os.Root,
	manifest publicBootstrapMediaManifest,
) error {
	if err := validatePublicBootstrapMediaManifestIdentity(manifest); err != nil {
		return err
	}
	if len(manifest.Assets) == 0 {
		return fmt.Errorf("public bootstrap media manifest has no assets")
	}

	destinationCount := 0
	seenSources := make(map[string]struct{}, len(manifest.Assets))
	seenDestinations := make(map[string]struct{}, publicBootstrapMediaAssetCount)
	for assetIndex, asset := range manifest.Assets {
		sourcePath, err := validateManifestRelativePath(asset.Source)
		if err != nil {
			return fmt.Errorf("public bootstrap media asset %d source: %w", assetIndex, err)
		}
		if _, duplicate := seenSources[sourcePath]; duplicate {
			return fmt.Errorf("public bootstrap media source is listed more than once: %s", sourcePath)
		}
		seenSources[sourcePath] = struct{}{}
		if !isLowerHexSHA256(asset.SourceSHA256) {
			return fmt.Errorf(
				"public bootstrap media source %s has invalid source_sha256",
				sourcePath,
			)
		}
		if len(asset.Destinations) == 0 {
			return fmt.Errorf("public bootstrap media source has no destinations: %s", sourcePath)
		}

		fullSourcePath := path.Join(publicBootstrapFixtureRootRelative, sourcePath)
		if err := inspectRealRelativePath(
			applicationRoot,
			fullSourcePath,
			true,
			"public bootstrap media source",
		); err != nil {
			return err
		}
		sourceFile, err := openVerifiedRegularFile(
			applicationRoot,
			fullSourcePath,
			"public bootstrap media source",
		)
		if err != nil {
			return err
		}
		sourceHasher := sha256.New()
		_, hashErr := io.Copy(sourceHasher, sourceFile)
		closeErr := sourceFile.Close()
		if hashErr != nil {
			return fmt.Errorf("hash public bootstrap media source %s: %w", sourcePath, hashErr)
		}
		if closeErr != nil {
			return fmt.Errorf("close public bootstrap media source %s: %w", sourcePath, closeErr)
		}
		if actualSHA256 := fmt.Sprintf("%x", sourceHasher.Sum(nil)); actualSHA256 != asset.SourceSHA256 {
			return fmt.Errorf(
				"public bootstrap media source %s sha256 = %s, want %s",
				sourcePath,
				actualSHA256,
				asset.SourceSHA256,
			)
		}

		for _, destination := range asset.Destinations {
			destinationPath, err := validateManifestRelativePath(destination)
			if err != nil {
				return fmt.Errorf(
					"public bootstrap media source %s destination: %w",
					sourcePath,
					err,
				)
			}
			if _, duplicate := seenDestinations[destinationPath]; duplicate {
				return fmt.Errorf(
					"public bootstrap media destination is listed more than once: %s",
					destinationPath,
				)
			}
			seenDestinations[destinationPath] = struct{}{}
			destinationCount++
		}
	}

	if destinationCount != publicBootstrapMediaAssetCount {
		return fmt.Errorf(
			"public bootstrap media manifest has %d destinations, want exactly %d",
			destinationCount,
			publicBootstrapMediaAssetCount,
		)
	}
	return nil
}

func isLowerHexSHA256(value string) bool {
	if len(value) != sha256.Size*2 {
		return false
	}
	for _, character := range value {
		if (character < '0' || character > '9') && (character < 'a' || character > 'f') {
			return false
		}
	}
	return true
}

func validateManifestRelativePath(value string) (string, error) {
	if value == "" {
		return "", fmt.Errorf("path must not be empty")
	}
	if strings.TrimSpace(value) != value {
		return "", fmt.Errorf("path must not have surrounding whitespace: %q", value)
	}
	if strings.Contains(value, "\\") {
		return "", fmt.Errorf("path must use forward slashes: %q", value)
	}
	if path.IsAbs(value) || filepath.IsAbs(filepath.FromSlash(value)) {
		return "", fmt.Errorf("path must be relative: %q", value)
	}
	if cleaned := path.Clean(value); cleaned != value || cleaned == "." {
		return "", fmt.Errorf("path must be canonical and contained: %q", value)
	}
	for _, component := range strings.Split(value, "/") {
		if component == "" || component == "." || component == ".." {
			return "", fmt.Errorf("path contains an unsafe component: %q", value)
		}
	}
	return value, nil
}
