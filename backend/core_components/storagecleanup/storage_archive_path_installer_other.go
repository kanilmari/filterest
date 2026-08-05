//go:build !linux

// storage_archive_path_installer_other.go
// Provides the portable fallback for recoverable media archive installation.
// Bridges non-Linux development systems to the shared storage move workflow.
// Exists so the package remains buildable outside the Linux deployment target.
package storagecleanup

import (
	"fmt"
	"os"
)

// renameStoragePathNoReplace preserves the portable pre-check used outside the
// Linux deployment target. Linux and WSL use the atomic renameat2 variant.
func renameStoragePathNoReplace(sourcePath, destinationPath string) error {
	if _, err := os.Lstat(destinationPath); err == nil {
		return fmt.Errorf("destination already exists: %s", destinationPath)
	} else if !os.IsNotExist(err) {
		return err
	}
	return os.Rename(sourcePath, destinationPath)
}
