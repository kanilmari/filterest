// storage_archive_path_mover_test.go
// Verifies recoverable media moves across Docker-style filesystem boundaries.
// Bridges simulated cross-device errors, copy safety, and storage root containment.
// Exists so committed database deletions cannot silently lose their media archive.
package storagecleanup

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

func forceCrossFilesystemRename(t *testing.T) {
	t.Helper()
	originalRename := storagePathRename
	storagePathRename = func(oldPath, newPath string) error {
		return &os.LinkError{
			Op:  "rename",
			Old: oldPath,
			New: newPath,
			Err: syscall.EXDEV,
		}
	}
	t.Cleanup(func() {
		storagePathRename = originalRename
	})
}

func TestMovePathToDeletedStorageCopiesDirectoryAcrossFilesystems(t *testing.T) {
	withWorkingDirectory(t)
	forceCrossFilesystemRename(t)

	sourceFile := filepath.Join(StorageRootDir, "104", "41", "original", "photo.jpg")
	destinationFile := filepath.Join(StorageDeletedRootDir, "104", "41", "original", "photo.jpg")
	if err := os.MkdirAll(filepath.Dir(sourceFile), 0750); err != nil {
		t.Fatalf("os.MkdirAll source: %v", err)
	}
	if err := os.WriteFile(sourceFile, []byte("recoverable bytes"), 0640); err != nil {
		t.Fatalf("os.WriteFile source: %v", err)
	}

	if err := MovePathToDeletedStorage(
		filepath.Join(StorageRootDir, "104", "41"),
		filepath.Join(StorageDeletedRootDir, "104", "41"),
	); err != nil {
		t.Fatalf("MovePathToDeletedStorage returned error: %v", err)
	}

	if _, err := os.Stat(filepath.Join(StorageRootDir, "104", "41")); !os.IsNotExist(err) {
		t.Fatalf("source should be removed after verified copy, got: %v", err)
	}
	contents, err := os.ReadFile(destinationFile)
	if err != nil {
		t.Fatalf("os.ReadFile destination: %v", err)
	}
	if string(contents) != "recoverable bytes" {
		t.Fatalf("destination contents = %q", contents)
	}
	if mode := fileMode(t, destinationFile); mode != 0640 {
		t.Fatalf("destination mode = %o, want 640", mode)
	}
}

func TestMovePathToDeletedStorageKeepsSourceWhenCopyFails(t *testing.T) {
	withWorkingDirectory(t)
	forceCrossFilesystemRename(t)

	sourceFile := filepath.Join(StorageRootDir, "104", "41", "original", "photo.jpg")
	destinationPath := filepath.Join(StorageDeletedRootDir, "104", "41")
	if err := os.MkdirAll(filepath.Dir(sourceFile), 0755); err != nil {
		t.Fatalf("os.MkdirAll source: %v", err)
	}
	if err := os.WriteFile(sourceFile, []byte("keep me"), 0644); err != nil {
		t.Fatalf("os.WriteFile source: %v", err)
	}

	originalCopier := storageRegularFileCopier
	storageRegularFileCopier = func(string, string, fs.FileInfo) error {
		return errors.New("forced copy failure")
	}
	t.Cleanup(func() {
		storageRegularFileCopier = originalCopier
	})

	err := MovePathToDeletedStorage(filepath.Join(StorageRootDir, "104", "41"), destinationPath)
	if err == nil {
		t.Fatal("MovePathToDeletedStorage should fail when the copy fails")
	}
	if _, statErr := os.Stat(sourceFile); statErr != nil {
		t.Fatalf("source must remain after failed copy: %v", statErr)
	}
	if _, statErr := os.Stat(destinationPath); !os.IsNotExist(statErr) {
		t.Fatalf("destination must not be installed after failed copy: %v", statErr)
	}
}

func TestMovePathToDeletedStorageRejectsSymlinks(t *testing.T) {
	tempRoot := withWorkingDirectory(t)
	forceCrossFilesystemRename(t)

	outsideFile := filepath.Join(tempRoot, "outside.txt")
	if err := os.WriteFile(outsideFile, []byte("outside"), 0644); err != nil {
		t.Fatalf("os.WriteFile outside: %v", err)
	}
	sourceDirectory := filepath.Join(StorageRootDir, "104", "41")
	if err := os.MkdirAll(sourceDirectory, 0755); err != nil {
		t.Fatalf("os.MkdirAll source: %v", err)
	}
	if err := os.Symlink(outsideFile, filepath.Join(sourceDirectory, "linked.txt")); err != nil {
		t.Fatalf("os.Symlink: %v", err)
	}

	err := MovePathToDeletedStorage(
		sourceDirectory,
		filepath.Join(StorageDeletedRootDir, "104", "41"),
	)
	if err == nil {
		t.Fatal("MovePathToDeletedStorage should reject source symlinks")
	}
	if _, statErr := os.Lstat(filepath.Join(sourceDirectory, "linked.txt")); statErr != nil {
		t.Fatalf("source symlink must remain after rejection: %v", statErr)
	}
	contents, readErr := os.ReadFile(outsideFile)
	if readErr != nil || string(contents) != "outside" {
		t.Fatalf("outside file changed: contents=%q err=%v", contents, readErr)
	}
}

func TestMovePathToDeletedStorageRejectsTraversal(t *testing.T) {
	tempRoot := withWorkingDirectory(t)
	outsideFile := filepath.Join(tempRoot, "outside.txt")
	if err := os.WriteFile(outsideFile, []byte("outside"), 0644); err != nil {
		t.Fatalf("os.WriteFile outside: %v", err)
	}

	err := MovePathToDeletedStorage(
		filepath.Join(StorageRootDir, "..", "outside.txt"),
		filepath.Join(StorageDeletedRootDir, "outside.txt"),
	)
	if err == nil {
		t.Fatal("MovePathToDeletedStorage should reject a source outside storage/")
	}
	if _, statErr := os.Stat(outsideFile); statErr != nil {
		t.Fatalf("outside source must remain: %v", statErr)
	}
}

func TestMovePathToDeletedStorageAllowsCanonicalRootSymlinks(t *testing.T) {
	tempRoot := withWorkingDirectory(t)
	activeRoot := filepath.Join(tempRoot, "persistent-active")
	deletedRoot := filepath.Join(tempRoot, "persistent-deleted")
	if err := os.MkdirAll(filepath.Join(activeRoot, "104", "41"), 0755); err != nil {
		t.Fatalf("os.MkdirAll active root: %v", err)
	}
	if err := os.MkdirAll(deletedRoot, 0755); err != nil {
		t.Fatalf("os.MkdirAll deleted root: %v", err)
	}
	if err := os.WriteFile(
		filepath.Join(activeRoot, "104", "41", "photo.jpg"),
		[]byte("persistent"),
		0644,
	); err != nil {
		t.Fatalf("os.WriteFile source: %v", err)
	}
	if err := os.Symlink(activeRoot, StorageRootDir); err != nil {
		t.Fatalf("os.Symlink active root: %v", err)
	}
	if err := os.Symlink(deletedRoot, StorageDeletedRootDir); err != nil {
		t.Fatalf("os.Symlink deleted root: %v", err)
	}

	if err := MovePathToDeletedStorage(
		filepath.Join(StorageRootDir, "104", "41"),
		filepath.Join(StorageDeletedRootDir, "104", "41"),
	); err != nil {
		t.Fatalf("MovePathToDeletedStorage returned error: %v", err)
	}
	if _, err := os.Stat(filepath.Join(activeRoot, "104", "41")); !os.IsNotExist(err) {
		t.Fatalf("persistent source should be removed, got: %v", err)
	}
	if _, err := os.Stat(filepath.Join(deletedRoot, "104", "41", "photo.jpg")); err != nil {
		t.Fatalf("persistent destination missing: %v", err)
	}
}

func TestMovePathToDeletedStorageRejectsDestinationParentSymlinkBeforeCreating(t *testing.T) {
	tempRoot := withWorkingDirectory(t)
	sourcePath := filepath.Join(StorageRootDir, "104", "41")
	outsideRoot := filepath.Join(tempRoot, "outside")
	if err := os.MkdirAll(sourcePath, 0755); err != nil {
		t.Fatalf("os.MkdirAll source: %v", err)
	}
	if err := os.MkdirAll(StorageDeletedRootDir, 0755); err != nil {
		t.Fatalf("os.MkdirAll deleted root: %v", err)
	}
	if err := os.MkdirAll(outsideRoot, 0755); err != nil {
		t.Fatalf("os.MkdirAll outside root: %v", err)
	}
	if err := os.Symlink(outsideRoot, filepath.Join(StorageDeletedRootDir, "104")); err != nil {
		t.Fatalf("os.Symlink destination parent: %v", err)
	}

	err := MovePathToDeletedStorage(
		sourcePath,
		filepath.Join(StorageDeletedRootDir, "104", "41"),
	)
	if err == nil {
		t.Fatal("MovePathToDeletedStorage should reject a destination parent symlink")
	}
	if _, statErr := os.Stat(filepath.Join(outsideRoot, "41")); !os.IsNotExist(statErr) {
		t.Fatalf("outside directory must not be created, got: %v", statErr)
	}
	if _, statErr := os.Stat(sourcePath); statErr != nil {
		t.Fatalf("source must remain after destination rejection: %v", statErr)
	}
}

func TestMovePathToDeletedStorageDoesNotReplaceExistingArchive(t *testing.T) {
	withWorkingDirectory(t)
	sourceFile := filepath.Join(StorageRootDir, "104", "41", "photo.jpg")
	destinationFile := filepath.Join(StorageDeletedRootDir, "104", "41", "photo.jpg")
	if err := os.MkdirAll(filepath.Dir(sourceFile), 0755); err != nil {
		t.Fatalf("os.MkdirAll source: %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(destinationFile), 0755); err != nil {
		t.Fatalf("os.MkdirAll destination: %v", err)
	}
	if err := os.WriteFile(sourceFile, []byte("new"), 0644); err != nil {
		t.Fatalf("os.WriteFile source: %v", err)
	}
	if err := os.WriteFile(destinationFile, []byte("old archive"), 0644); err != nil {
		t.Fatalf("os.WriteFile destination: %v", err)
	}

	err := MovePathToDeletedStorage(sourceFile, destinationFile)
	if err == nil {
		t.Fatal("MovePathToDeletedStorage should refuse an existing archive destination")
	}
	sourceContents, _ := os.ReadFile(sourceFile)
	destinationContents, _ := os.ReadFile(destinationFile)
	if string(sourceContents) != "new" || string(destinationContents) != "old archive" {
		t.Fatalf(
			"collision changed files: source=%q destination=%q",
			sourceContents,
			destinationContents,
		)
	}
}

func TestMovePathToDeletedStorageDoesNotReplaceArchiveCreatedDuringRename(t *testing.T) {
	withWorkingDirectory(t)
	sourceFile := filepath.Join(StorageRootDir, "104", "41", "photo.jpg")
	destinationFile := filepath.Join(StorageDeletedRootDir, "104", "41", "photo.jpg")
	if err := os.MkdirAll(filepath.Dir(sourceFile), 0755); err != nil {
		t.Fatalf("os.MkdirAll source: %v", err)
	}
	if err := os.WriteFile(sourceFile, []byte("new"), 0644); err != nil {
		t.Fatalf("os.WriteFile source: %v", err)
	}

	originalRename := storagePathRename
	storagePathRename = func(oldPath, newPath string) error {
		if err := os.WriteFile(newPath, []byte("concurrent archive"), 0644); err != nil {
			return err
		}
		return renameStoragePathNoReplace(oldPath, newPath)
	}
	t.Cleanup(func() {
		storagePathRename = originalRename
	})

	err := MovePathToDeletedStorage(sourceFile, destinationFile)
	if err == nil {
		t.Fatal("MovePathToDeletedStorage should refuse a concurrently created archive")
	}
	sourceContents, _ := os.ReadFile(sourceFile)
	destinationContents, _ := os.ReadFile(destinationFile)
	if string(sourceContents) != "new" || string(destinationContents) != "concurrent archive" {
		t.Fatalf(
			"race changed files: source=%q destination=%q",
			sourceContents,
			destinationContents,
		)
	}
}

func TestMovePathToDeletedStorageDoesNotReplaceArchiveCreatedDuringCrossFilesystemCopy(t *testing.T) {
	withWorkingDirectory(t)
	forceCrossFilesystemRename(t)

	sourceFile := filepath.Join(StorageRootDir, "104", "41", "photo.jpg")
	destinationFile := filepath.Join(StorageDeletedRootDir, "104", "41", "photo.jpg")
	if err := os.MkdirAll(filepath.Dir(sourceFile), 0755); err != nil {
		t.Fatalf("os.MkdirAll source: %v", err)
	}
	if err := os.WriteFile(sourceFile, []byte("new"), 0644); err != nil {
		t.Fatalf("os.WriteFile source: %v", err)
	}

	originalInstallRename := storageArchiveInstallRename
	storageArchiveInstallRename = func(oldPath, newPath string) error {
		if err := os.WriteFile(newPath, []byte("concurrent archive"), 0644); err != nil {
			return err
		}
		return renameStoragePathNoReplace(oldPath, newPath)
	}
	t.Cleanup(func() {
		storageArchiveInstallRename = originalInstallRename
	})

	err := MovePathToDeletedStorage(sourceFile, destinationFile)
	if err == nil {
		t.Fatal("MovePathToDeletedStorage should refuse a concurrent cross-filesystem archive")
	}
	sourceContents, _ := os.ReadFile(sourceFile)
	destinationContents, _ := os.ReadFile(destinationFile)
	if string(sourceContents) != "new" || string(destinationContents) != "concurrent archive" {
		t.Fatalf(
			"cross-filesystem race changed files: source=%q destination=%q",
			sourceContents,
			destinationContents,
		)
	}
}

func fileMode(t *testing.T, path string) fs.FileMode {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("os.Stat(%s): %v", path, err)
	}
	return info.Mode().Perm()
}
