//go:build linux

// storage_archive_path_installer_linux.go
// Installs a recoverable media archive without replacing an existing path.
// Bridges the storage move workflow to Linux and WSL renameat2 semantics.
// Exists so concurrent deletes cannot overwrite an earlier recovery copy.
package storagecleanup

import "golang.org/x/sys/unix"

// renameStoragePathNoReplace atomically installs one source path only when the
// destination is absent. It connects verified archive preparation to the Linux
// filesystem boundary so an earlier recovery copy always wins a race.
func renameStoragePathNoReplace(sourcePath, destinationPath string) error {
	return unix.Renameat2(
		unix.AT_FDCWD,
		sourcePath,
		unix.AT_FDCWD,
		destinationPath,
		unix.RENAME_NOREPLACE,
	)
}
