// storage_archive_path_mover.go
// Moves media from active storage into the recoverable deleted-media archive.
// Bridges ordinary same-filesystem renames and safe cross-filesystem copy fallback.
// Exists so Docker bind mounts cannot turn a committed row deletion into lost media.
package storagecleanup

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

var storagePathRename = renameStoragePathNoReplace
var storageArchiveInstallRename = renameStoragePathNoReplace
var storageRegularFileCopier = copyStorageRegularFile

// MovePathToDeletedStorage moves one file or directory from storage/ to storage_deleted/.
// It keeps the source untouched until a cross-filesystem copy is complete and durable.
func MovePathToDeletedStorage(sourcePath, destinationPath string) error {
	sourceRelativePath, err := storageRelativePath(StorageRootDir, sourcePath, "source")
	if err != nil {
		return err
	}
	destinationRelativePath, err := storageRelativePath(
		StorageDeletedRootDir,
		destinationPath,
		"destination",
	)
	if err != nil {
		return err
	}
	sourceRoot, err := resolveStorageRootDirectory(StorageRootDir, false)
	if err != nil {
		return err
	}
	destinationRoot, err := resolveStorageRootDirectory(StorageDeletedRootDir, true)
	if err != nil {
		return err
	}
	resolvedSourcePath := filepath.Join(sourceRoot, sourceRelativePath)
	resolvedDestinationPath := filepath.Join(destinationRoot, destinationRelativePath)

	if err := rejectStoragePathSymlinks(sourceRoot, resolvedSourcePath); err != nil {
		return err
	}

	sourceInfo, err := os.Lstat(resolvedSourcePath)
	if err != nil {
		return fmt.Errorf("inspect storage source %s: %w", sourcePath, err)
	}
	if sourceInfo.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("storage source must not be a symbolic link: %s", sourcePath)
	}

	destinationParent := filepath.Dir(resolvedDestinationPath)
	if err := ensureStorageDirectoryComponents(destinationRoot, destinationParent, 0755); err != nil {
		return fmt.Errorf("create deleted-storage destination parent %s: %w", destinationParent, err)
	}
	if _, destinationErr := os.Lstat(resolvedDestinationPath); destinationErr == nil {
		return fmt.Errorf("deleted-storage destination already exists: %s", destinationPath)
	} else if !os.IsNotExist(destinationErr) {
		return fmt.Errorf("inspect deleted-storage destination %s: %w", destinationPath, destinationErr)
	}

	if err := storagePathRename(resolvedSourcePath, resolvedDestinationPath); err == nil {
		return nil
	} else if !errors.Is(err, syscall.EXDEV) {
		return fmt.Errorf("move %s -> %s: %w", sourcePath, destinationPath, err)
	}

	if err := copyStoragePathThenRemoveSource(
		resolvedSourcePath,
		resolvedDestinationPath,
		sourceInfo,
	); err != nil {
		return fmt.Errorf("copy cross-filesystem storage path %s -> %s: %w", sourcePath, destinationPath, err)
	}
	return nil
}

func storageRelativePath(rootPath, candidatePath, label string) (string, error) {
	rootAbsolute, err := filepath.Abs(rootPath)
	if err != nil {
		return "", fmt.Errorf("resolve %s storage root: %w", label, err)
	}
	candidateAbsolute, err := filepath.Abs(candidatePath)
	if err != nil {
		return "", fmt.Errorf("resolve %s storage path: %w", label, err)
	}
	relativePath, err := filepath.Rel(rootAbsolute, candidateAbsolute)
	if err != nil {
		return "", fmt.Errorf("compare %s storage path: %w", label, err)
	}
	if relativePath == "." || relativePath == ".." || strings.HasPrefix(relativePath, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("%s storage path escapes its root: %s", label, candidatePath)
	}
	return relativePath, nil
}

func resolveStorageRootDirectory(rootPath string, create bool) (string, error) {
	rootInfo, err := os.Lstat(rootPath)
	if os.IsNotExist(err) && create {
		if mkdirErr := os.MkdirAll(rootPath, 0755); mkdirErr != nil {
			return "", fmt.Errorf("create storage root %s: %w", rootPath, mkdirErr)
		}
		rootInfo, err = os.Lstat(rootPath)
	}
	if err != nil {
		return "", fmt.Errorf("inspect storage root %s: %w", rootPath, err)
	}
	if rootInfo.Mode()&os.ModeSymlink == 0 && !rootInfo.IsDir() {
		return "", fmt.Errorf("storage root must be a directory or a directory symlink: %s", rootPath)
	}
	resolvedRoot, err := filepath.EvalSymlinks(rootPath)
	if err != nil {
		return "", fmt.Errorf("resolve storage root symlink %s: %w", rootPath, err)
	}
	resolvedRoot, err = filepath.Abs(resolvedRoot)
	if err != nil {
		return "", fmt.Errorf("resolve absolute storage root %s: %w", rootPath, err)
	}
	resolvedInfo, err := os.Stat(resolvedRoot)
	if err != nil {
		return "", fmt.Errorf("inspect resolved storage root %s: %w", resolvedRoot, err)
	}
	if !resolvedInfo.IsDir() {
		return "", fmt.Errorf("resolved storage root is not a directory: %s", resolvedRoot)
	}
	return resolvedRoot, nil
}

func ensureStorageDirectoryComponents(rootPath, directoryPath string, mode fs.FileMode) error {
	relativePath, err := filepath.Rel(rootPath, directoryPath)
	if err != nil {
		return err
	}
	if relativePath == ".." || strings.HasPrefix(relativePath, ".."+string(filepath.Separator)) {
		return fmt.Errorf("storage directory escapes its root: %s", directoryPath)
	}
	if relativePath == "." {
		return nil
	}

	currentPath := rootPath
	for _, pathPart := range strings.Split(relativePath, string(filepath.Separator)) {
		currentPath = filepath.Join(currentPath, pathPart)
		pathInfo, pathErr := os.Lstat(currentPath)
		if os.IsNotExist(pathErr) {
			if mkdirErr := os.Mkdir(currentPath, mode); mkdirErr != nil {
				return mkdirErr
			}
			pathInfo, pathErr = os.Lstat(currentPath)
		}
		if pathErr != nil {
			return pathErr
		}
		if pathInfo.Mode()&os.ModeSymlink != 0 || !pathInfo.IsDir() {
			return fmt.Errorf("storage directory component must be a real directory: %s", currentPath)
		}
	}
	return nil
}

func rejectStoragePathSymlinks(rootPath, candidatePath string) error {
	rootAbsolute, err := filepath.Abs(rootPath)
	if err != nil {
		return err
	}
	candidateAbsolute, err := filepath.Abs(candidatePath)
	if err != nil {
		return err
	}
	relativePath, err := filepath.Rel(rootAbsolute, candidateAbsolute)
	if err != nil {
		return err
	}

	currentPath := rootAbsolute
	for _, pathPart := range strings.Split(relativePath, string(filepath.Separator)) {
		currentPath = filepath.Join(currentPath, pathPart)
		pathInfo, pathErr := os.Lstat(currentPath)
		if os.IsNotExist(pathErr) {
			return nil
		}
		if pathErr != nil {
			return fmt.Errorf("inspect storage path component %s: %w", currentPath, pathErr)
		}
		if pathInfo.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("storage path must not cross a symbolic link: %s", currentPath)
		}
	}
	return nil
}

func copyStoragePathThenRemoveSource(sourcePath, destinationPath string, sourceInfo fs.FileInfo) error {
	if _, err := os.Lstat(destinationPath); err == nil {
		return fmt.Errorf("destination already exists: %s", destinationPath)
	} else if !os.IsNotExist(err) {
		return err
	}

	destinationParent := filepath.Dir(destinationPath)
	temporaryPath := ""
	if sourceInfo.IsDir() {
		temporaryDirectory, err := os.MkdirTemp(destinationParent, "."+filepath.Base(destinationPath)+".archive-")
		if err != nil {
			return err
		}
		temporaryPath = temporaryDirectory
		if err := os.Chmod(temporaryPath, sourceInfo.Mode().Perm()); err != nil {
			_ = os.RemoveAll(temporaryPath)
			return err
		}
		if err := copyStorageDirectoryContents(sourcePath, temporaryPath); err != nil {
			_ = os.RemoveAll(temporaryPath)
			return err
		}
		if err := syncStorageDirectory(temporaryPath); err != nil {
			_ = os.RemoveAll(temporaryPath)
			return err
		}
	} else if sourceInfo.Mode().IsRegular() {
		temporaryFile, err := os.CreateTemp(destinationParent, "."+filepath.Base(destinationPath)+".archive-")
		if err != nil {
			return err
		}
		temporaryPath = temporaryFile.Name()
		if err := temporaryFile.Close(); err != nil {
			_ = os.Remove(temporaryPath)
			return err
		}
		if err := storageRegularFileCopier(sourcePath, temporaryPath, sourceInfo); err != nil {
			_ = os.Remove(temporaryPath)
			return err
		}
	} else {
		return fmt.Errorf("unsupported storage file type: %s", sourcePath)
	}

	if err := storageArchiveInstallRename(temporaryPath, destinationPath); err != nil {
		_ = os.RemoveAll(temporaryPath)
		return err
	}
	if err := syncStorageDirectory(destinationParent); err != nil {
		return err
	}

	if sourceInfo.IsDir() {
		if err := os.RemoveAll(sourcePath); err != nil {
			return err
		}
		return nil
	}
	return os.Remove(sourcePath)
}

func copyStorageDirectoryContents(sourceDirectory, destinationDirectory string) error {
	entries, err := os.ReadDir(sourceDirectory)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		sourcePath := filepath.Join(sourceDirectory, entry.Name())
		destinationPath := filepath.Join(destinationDirectory, entry.Name())
		sourceInfo, err := os.Lstat(sourcePath)
		if err != nil {
			return err
		}
		if sourceInfo.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("storage archive copy refuses symbolic link: %s", sourcePath)
		}
		if sourceInfo.IsDir() {
			if err := os.Mkdir(destinationPath, sourceInfo.Mode().Perm()); err != nil {
				return err
			}
			if err := copyStorageDirectoryContents(sourcePath, destinationPath); err != nil {
				return err
			}
			if err := syncStorageDirectory(destinationPath); err != nil {
				return err
			}
			continue
		}
		if !sourceInfo.Mode().IsRegular() {
			return fmt.Errorf("storage archive copy refuses non-regular file: %s", sourcePath)
		}
		if err := storageRegularFileCopier(sourcePath, destinationPath, sourceInfo); err != nil {
			return err
		}
	}
	return nil
}

func copyStorageRegularFile(sourcePath, destinationPath string, sourceInfo fs.FileInfo) error {
	sourceFile, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	defer sourceFile.Close()

	openedInfo, err := sourceFile.Stat()
	if err != nil {
		return err
	}
	if !os.SameFile(sourceInfo, openedInfo) {
		return fmt.Errorf("storage source changed while opening: %s", sourcePath)
	}

	destinationFile, err := os.OpenFile(
		destinationPath,
		os.O_CREATE|os.O_WRONLY|os.O_TRUNC,
		sourceInfo.Mode().Perm(),
	)
	if err != nil {
		return err
	}
	copiedBytes, copyErr := io.Copy(destinationFile, sourceFile)
	if copyErr == nil && copiedBytes != openedInfo.Size() {
		copyErr = fmt.Errorf("copied %d bytes, expected %d", copiedBytes, openedInfo.Size())
	}
	if copyErr == nil {
		copyErr = destinationFile.Sync()
	}
	closeErr := destinationFile.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
}

func syncStorageDirectory(directoryPath string) error {
	directory, err := os.Open(directoryPath)
	if err != nil {
		return err
	}
	defer directory.Close()
	if err := directory.Sync(); err != nil &&
		!errors.Is(err, syscall.EINVAL) &&
		!errors.Is(err, syscall.ENOTSUP) {
		return err
	}
	return nil
}
