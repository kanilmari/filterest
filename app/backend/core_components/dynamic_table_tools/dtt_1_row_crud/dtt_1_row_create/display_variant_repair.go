// display_variant_repair.go
// Replaces stored 300/1000/2160 display variants that are larger than their original image,
// in pixels or in bytes.
// Runs between startup maintenance and every media layout below the storage root.
// Exists because variant generation before 9.3.12 upscaled small originals, and sized
// catalog/background slots now request those heavier files instead of the original.
// Variants encoded before 9.3.13 at JPEG quality 95 could also outweigh a strongly
// compressed original despite having fewer pixels.

package dtt_1_row_create

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

var displayVariantFolders = []string{"300", "1000", "2160"}

// DisplayVariantRepairResult summarizes one storage scan.
type DisplayVariantRepairResult struct {
	CheckedVariants  int
	ReplacedVariants int
	FailedVariants   int
}

// RepairUpscaledDisplayVariants scans storageRoot for folders that hold an
// "original" subfolder and replaces each sibling display variant whose width,
// height or file size exceeds its original with a copy of that original. Only image
// headers are read, symlinks are not followed, and unreadable formats (SVG,
// AVIF, corrupt files) are left untouched. Re-running the scan is harmless.
func RepairUpscaledDisplayVariants(storageRoot string) (DisplayVariantRepairResult, error) {
	var result DisplayVariantRepairResult
	// Docker and native installs may mount storage through a symlink; WalkDir
	// does not descend into a symlinked root, so resolve it once.
	if resolved, resolveErr := filepath.EvalSymlinks(storageRoot); resolveErr == nil {
		storageRoot = resolved
	}
	info, err := os.Stat(storageRoot)
	if errors.Is(err, fs.ErrNotExist) {
		return result, nil
	}
	if err != nil {
		return result, fmt.Errorf("inspect storage root: %w", err)
	}
	if !info.IsDir() {
		return result, fmt.Errorf("storage root is not a directory: %s", storageRoot)
	}

	walkErr := filepath.WalkDir(storageRoot, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			// Keep scanning past unreadable subtrees; one folder must not block the rest.
			if entry != nil && entry.IsDir() && path != storageRoot {
				return fs.SkipDir
			}
			return nil
		}
		if !entry.IsDir() || entry.Name() != "original" {
			return nil
		}
		parent := filepath.Dir(path)
		originals, readErr := os.ReadDir(path)
		if readErr != nil {
			return fs.SkipDir
		}
		for _, original := range originals {
			if !original.Type().IsRegular() {
				continue
			}
			originalPath := filepath.Join(path, original.Name())
			originalConfig, configErr := readImageConfig(originalPath)
			if configErr != nil {
				continue
			}
			for _, folder := range displayVariantFolders {
				variantPath := filepath.Join(parent, folder, original.Name())
				variantInfo, statErr := os.Lstat(variantPath)
				if statErr != nil || !variantInfo.Mode().IsRegular() {
					continue
				}
				variantConfig, variantErr := readImageConfig(variantPath)
				if variantErr != nil {
					continue
				}
				result.CheckedVariants++
				if variantConfig.Width <= originalConfig.Width && variantConfig.Height <= originalConfig.Height &&
					!fileLargerThan(variantPath, originalPath) {
					continue
				}
				if repairErr := publishDisplayVariantAtomically(variantPath, func(temporaryPath string) error {
					return copySourceAsDisplayVariant(originalPath, temporaryPath)
				}); repairErr != nil {
					result.FailedVariants++
					continue
				}
				result.ReplacedVariants++
			}
		}
		return fs.SkipDir
	})
	if walkErr != nil {
		return result, fmt.Errorf("scan storage for display variants: %w", walkErr)
	}
	return result, nil
}
