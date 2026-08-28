// runtime_paths.go
// Resolves immutable application and mutable runtime filesystem boundaries.
// Bridges explicit installation roots with legacy flat-layout compatibility.
// Exists so storage and runtime consumers share one validated path snapshot.
package runtimepaths

import (
	"fmt"
	"os"
	"path/filepath"
	"sync/atomic"
)

// Paths contains the application-owned and mutable runtime filesystem roots.
// Between startup configuration and filesystem consumers, it carries one
// immutable snapshot so path selection cannot drift while the process runs.
type Paths struct {
	InstallationRoot   string
	ApplicationRoot    string
	DataRoot           string
	StorageRoot        string
	StorageDeletedRoot string
	RuntimeRoot        string
	LegacyFlat         bool
}

var configuredPaths atomic.Value

func init() {
	configuredPaths.Store(Paths{
		InstallationRoot:   ".",
		ApplicationRoot:    ".",
		DataRoot:           ".",
		StorageRoot:        "storage",
		StorageDeletedRoot: "storage_deleted",
		RuntimeRoot:        "runtime",
		LegacyFlat:         true,
	})
}

// Resolve builds one absolute runtime-path snapshot for the selected layout.
// Between explicit startup roots and runtime filesystem consumers, it preserves
// the flat legacy paths unless the caller explicitly selects installation mode.
func Resolve(applicationRoot, installationRoot string, explicitInstallation bool) (Paths, error) {
	normalizedApplicationRoot, err := normalizeAbsolutePath("application root", applicationRoot)
	if err != nil {
		return Paths{}, err
	}
	normalizedInstallationRoot, err := normalizeAbsolutePath("installation root", installationRoot)
	if err != nil {
		return Paths{}, err
	}

	paths := Paths{
		InstallationRoot: normalizedInstallationRoot,
		ApplicationRoot:  normalizedApplicationRoot,
		LegacyFlat:       !explicitInstallation,
	}
	if explicitInstallation {
		paths.DataRoot = filepath.Join(normalizedInstallationRoot, "data")
	} else {
		// Compatibility mode keeps existing Easelect-native storage relative to
		// its runtime root even when immutable Filterest source lives in app/.
		paths.DataRoot = normalizedInstallationRoot
	}
	paths.StorageRoot = filepath.Join(paths.DataRoot, "storage")
	paths.StorageDeletedRoot = filepath.Join(paths.DataRoot, "storage_deleted")
	paths.RuntimeRoot = filepath.Join(paths.DataRoot, "runtime")

	return validatePaths(paths)
}

// Configure publishes one validated absolute path snapshot for all consumers.
// Between startup resolution and concurrent request handling, atomic replacement
// keeps reads race-free while still allowing unit tests to reconfigure the package.
func Configure(paths Paths) error {
	validatedPaths, err := validatePaths(paths)
	if err != nil {
		return err
	}
	configuredPaths.Store(validatedPaths)
	return nil
}

// Current returns the most recently configured immutable path snapshot.
// Between concurrent filesystem consumers and startup configuration, it avoids
// repeated environment reads and retains relative legacy defaults before setup.
func Current() Paths {
	return configuredPaths.Load().(Paths)
}

func validatePaths(paths Paths) (Paths, error) {
	fields := []struct {
		label string
		value *string
	}{
		{label: "installation root", value: &paths.InstallationRoot},
		{label: "application root", value: &paths.ApplicationRoot},
		{label: "data root", value: &paths.DataRoot},
		{label: "storage root", value: &paths.StorageRoot},
		{label: "deleted storage root", value: &paths.StorageDeletedRoot},
		{label: "runtime root", value: &paths.RuntimeRoot},
	}
	for _, field := range fields {
		normalized, err := normalizeAbsolutePath(field.label, *field.value)
		if err != nil {
			return Paths{}, err
		}
		*field.value = normalized
	}

	if paths.LegacyFlat {
		return paths, nil
	}

	mutableRoots := []struct {
		label string
		path  string
	}{
		{label: "data root", path: paths.DataRoot},
		{label: "storage root", path: paths.StorageRoot},
		{label: "deleted storage root", path: paths.StorageDeletedRoot},
		{label: "runtime root", path: paths.RuntimeRoot},
	}
	for _, mutableRoot := range mutableRoots {
		overlaps, err := pathsOverlap(paths.ApplicationRoot, mutableRoot.path)
		if err != nil {
			return Paths{}, fmt.Errorf("compare application root with %s: %w", mutableRoot.label, err)
		}
		if overlaps {
			return Paths{}, fmt.Errorf("%s must not be inside or overlap the application root", mutableRoot.label)
		}
	}
	leafRoots := mutableRoots[1:]
	for first := 0; first < len(leafRoots); first++ {
		for second := first + 1; second < len(leafRoots); second++ {
			overlaps, err := pathsOverlap(leafRoots[first].path, leafRoots[second].path)
			if err != nil {
				return Paths{}, fmt.Errorf(
					"compare %s with %s: %w",
					leafRoots[first].label,
					leafRoots[second].label,
					err,
				)
			}
			if overlaps {
				return Paths{}, fmt.Errorf(
					"%s and %s must not overlap",
					leafRoots[first].label,
					leafRoots[second].label,
				)
			}
		}
	}

	return paths, nil
}

func normalizeAbsolutePath(label, path string) (string, error) {
	if path == "" {
		return "", fmt.Errorf("%s is required", label)
	}
	if !filepath.IsAbs(path) {
		return "", fmt.Errorf("%s must be absolute", label)
	}
	return filepath.Clean(path), nil
}

func pathsOverlap(first, second string) (bool, error) {
	resolvedFirst, err := resolvePathWithExistingSymlinks(first)
	if err != nil {
		return false, err
	}
	resolvedSecond, err := resolvePathWithExistingSymlinks(second)
	if err != nil {
		return false, err
	}
	return pathContainsPath(resolvedFirst, resolvedSecond) ||
		pathContainsPath(resolvedSecond, resolvedFirst), nil
}

func pathContainsPath(parent, child string) bool {
	relative, err := filepath.Rel(parent, child)
	if err != nil {
		return true
	}
	return relative == "." ||
		(relative != ".." && !filepath.IsAbs(relative) &&
			!hasParentPathPrefix(relative))
}

func hasParentPathPrefix(path string) bool {
	return len(path) > 3 && path[:3] == ".."+string(filepath.Separator)
}

func resolvePathWithExistingSymlinks(path string) (string, error) {
	cleaned := filepath.Clean(path)
	existing := cleaned
	missingParts := make([]string, 0)
	for {
		if _, err := os.Lstat(existing); err == nil {
			break
		} else if !os.IsNotExist(err) {
			return "", err
		}

		parent := filepath.Dir(existing)
		if parent == existing {
			break
		}
		missingParts = append(missingParts, filepath.Base(existing))
		existing = parent
	}

	resolvedExisting, err := filepath.EvalSymlinks(existing)
	if err != nil {
		return "", err
	}
	for index := len(missingParts) - 1; index >= 0; index-- {
		resolvedExisting = filepath.Join(resolvedExisting, missingParts[index])
	}
	return filepath.Clean(resolvedExisting), nil
}
