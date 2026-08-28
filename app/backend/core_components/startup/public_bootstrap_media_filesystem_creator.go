// public_bootstrap_media_filesystem_creator.go
// Creates and verifies contained mutable paths without following symbolic links.
// Connects immutable media streams to operator storage and durable directory entries.
// Exists so bootstrap writes cannot replace files or escape the installation root.
package startup

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync/atomic"

	"easelect/backend/core_components/runtimepaths"
)

var publicBootstrapTemporaryFileSequence atomic.Uint64

// openVerifiedRealRoot opens a stable contained filesystem capability only for
// a real directory. It compares the pathname before and after opening so root
// replacement cannot silently redirect bootstrap reads or operator-state writes.
func openVerifiedRealRoot(rootPath string, label string) (*os.Root, error) {
	beforeInfo, err := os.Lstat(rootPath)
	if err != nil {
		return nil, fmt.Errorf("inspect %s %s: %w", label, rootPath, err)
	}
	if beforeInfo.Mode()&os.ModeSymlink != 0 || !beforeInfo.IsDir() {
		return nil, fmt.Errorf("%s must be a real directory, not a symlink: %s", label, rootPath)
	}

	root, err := os.OpenRoot(rootPath)
	if err != nil {
		return nil, fmt.Errorf("open %s %s: %w", label, rootPath, err)
	}
	openedInfo, err := root.Stat(".")
	if err != nil {
		root.Close()
		return nil, fmt.Errorf("inspect opened %s %s: %w", label, rootPath, err)
	}
	afterInfo, err := os.Lstat(rootPath)
	if err != nil || afterInfo.Mode()&os.ModeSymlink != 0 ||
		!afterInfo.IsDir() || !os.SameFile(openedInfo, afterInfo) {
		root.Close()
		if err != nil {
			return nil, fmt.Errorf("reinspect %s %s: %w", label, rootPath, err)
		}
		return nil, fmt.Errorf("%s changed or became a symlink while opening: %s", label, rootPath)
	}

	return root, nil
}

func inspectRealRelativePath(
	root *os.Root,
	relativePath string,
	requireRegularFile bool,
	label string,
) error {
	validatedPath, err := validateManifestRelativePath(filepath.ToSlash(relativePath))
	if err != nil {
		return fmt.Errorf("%s path: %w", label, err)
	}
	components := strings.Split(validatedPath, "/")
	currentPath := ""
	for index, component := range components {
		currentPath = path.Join(currentPath, component)
		info, err := root.Lstat(filepath.FromSlash(currentPath))
		if err != nil {
			return fmt.Errorf("inspect %s %s: %w", label, validatedPath, err)
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("%s must not contain symbolic links: %s", label, currentPath)
		}
		isFinal := index == len(components)-1
		if !isFinal && !info.IsDir() {
			return fmt.Errorf("%s parent component is not a directory: %s", label, currentPath)
		}
		if isFinal && requireRegularFile && !info.Mode().IsRegular() {
			return fmt.Errorf("%s must be a regular file: %s", label, validatedPath)
		}
	}
	return nil
}

// openVerifiedRegularFile rejects symlink components and verifies that the
// opened descriptor still names the inspected regular file. It keeps manifest,
// source, and marker reads inside their already-opened filesystem capability.
func openVerifiedRegularFile(
	root *os.Root,
	relativePath string,
	label string,
) (*os.File, error) {
	if err := inspectRealRelativePath(root, relativePath, true, label); err != nil {
		return nil, err
	}
	osRelativePath := filepath.FromSlash(relativePath)
	file, err := root.Open(osRelativePath)
	if err != nil {
		return nil, fmt.Errorf("open %s %s: %w", label, relativePath, err)
	}
	openedInfo, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, fmt.Errorf("inspect opened %s %s: %w", label, relativePath, err)
	}
	pathInfo, err := root.Lstat(osRelativePath)
	if err != nil || pathInfo.Mode()&os.ModeSymlink != 0 ||
		!pathInfo.Mode().IsRegular() || !os.SameFile(openedInfo, pathInfo) {
		file.Close()
		if err != nil {
			return nil, fmt.Errorf("reinspect %s %s: %w", label, relativePath, err)
		}
		return nil, fmt.Errorf("%s changed or became a symlink while opening: %s", label, relativePath)
	}
	return file, nil
}

func preparePublicBootstrapDataRoot(paths runtimepaths.Paths) (*os.Root, error) {
	installationRoot, err := openVerifiedRealRoot(paths.InstallationRoot, "installation root")
	if err != nil {
		return nil, err
	}
	defer installationRoot.Close()

	if err := ensureRealDirectory(installationRoot, "data", 0o700); err != nil {
		return nil, fmt.Errorf("prepare public bootstrap data root: %w", err)
	}

	return openVerifiedRealRoot(paths.DataRoot, "data root")
}

func openExistingPublicBootstrapRoot(
	paths runtimepaths.Paths,
) (*os.Root, bool, error) {
	installationRoot, err := openVerifiedRealRoot(paths.InstallationRoot, "installation root")
	if err != nil {
		return nil, false, err
	}
	defer installationRoot.Close()

	for _, directory := range []string{"data", path.Join("data", "bootstrap")} {
		info, inspectErr := installationRoot.Lstat(filepath.FromSlash(directory))
		if errors.Is(inspectErr, fs.ErrNotExist) {
			return nil, false, nil
		}
		if inspectErr != nil {
			return nil, false, fmt.Errorf(
				"inspect public bootstrap completion directory %s: %w",
				directory,
				inspectErr,
			)
		}
		if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
			return nil, false, fmt.Errorf(
				"public bootstrap completion directory must be a real directory: %s",
				directory,
			)
		}
	}
	bootstrapRoot, err := openVerifiedRealRoot(
		filepath.Join(paths.DataRoot, "bootstrap"),
		"bootstrap root",
	)
	if err != nil {
		return nil, false, err
	}
	return bootstrapRoot, true, nil
}

func preparePublicBootstrapChildRoot(
	dataRoot *os.Root,
	dataRootPath string,
	childName string,
	mode fs.FileMode,
) (*os.Root, error) {
	if err := ensureRealDirectory(dataRoot, childName, mode); err != nil {
		return nil, err
	}
	return openVerifiedRealRoot(filepath.Join(dataRootPath, childName), childName+" root")
}

// ensureRealDirectory creates only missing real directories below an os.Root.
// Existing operator-owned directory permissions stay untouched, while every
// path component is rejected if it becomes a symlink or non-directory.
func ensureRealDirectory(root *os.Root, relativePath string, mode fs.FileMode) error {
	validatedPath, err := validateManifestRelativePath(filepath.ToSlash(relativePath))
	if err != nil {
		return err
	}
	currentPath := ""
	for _, component := range strings.Split(validatedPath, "/") {
		currentPath = path.Join(currentPath, component)
		osCurrentPath := filepath.FromSlash(currentPath)
		created := false
		info, err := root.Lstat(osCurrentPath)
		if errors.Is(err, fs.ErrNotExist) {
			mkdirErr := root.Mkdir(osCurrentPath, mode)
			if mkdirErr == nil {
				created = true
			} else if !errors.Is(mkdirErr, fs.ErrExist) {
				return fmt.Errorf("create directory %s: %w", currentPath, mkdirErr)
			}
			info, err = root.Lstat(osCurrentPath)
		}
		if err != nil {
			return fmt.Errorf("inspect directory %s: %w", currentPath, err)
		}
		if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
			return fmt.Errorf("directory component must be a real directory: %s", currentPath)
		}
		if created {
			if err := syncVerifiedRealDirectory(
				root,
				path.Dir(currentPath),
				"public bootstrap directory parent",
			); err != nil {
				return fmt.Errorf("persist directory %s: %w", currentPath, err)
			}
		}
	}
	return nil
}

// syncVerifiedRealDirectory makes directory-entry ordering durable without
// following symlinks. The completion marker is meaningful only when every
// directory entry it attests to has reached stable storage first.
func syncVerifiedRealDirectory(root *os.Root, relativePath string, label string) error {
	osRelativePath := "."
	if relativePath != "." {
		validatedPath, err := validateManifestRelativePath(filepath.ToSlash(relativePath))
		if err != nil {
			return fmt.Errorf("%s path: %w", label, err)
		}
		if err := inspectRealRelativePath(root, validatedPath, false, label); err != nil {
			return err
		}
		osRelativePath = filepath.FromSlash(validatedPath)
	}

	beforeInfo, err := root.Lstat(osRelativePath)
	if err != nil {
		return fmt.Errorf("inspect %s %s: %w", label, relativePath, err)
	}
	if beforeInfo.Mode()&os.ModeSymlink != 0 || !beforeInfo.IsDir() {
		return fmt.Errorf("%s must be a real directory: %s", label, relativePath)
	}
	directory, err := root.Open(osRelativePath)
	if err != nil {
		return fmt.Errorf("open %s %s: %w", label, relativePath, err)
	}
	openedInfo, statErr := directory.Stat()
	afterInfo, lstatErr := root.Lstat(osRelativePath)
	if statErr != nil || lstatErr != nil || afterInfo.Mode()&os.ModeSymlink != 0 ||
		!afterInfo.IsDir() || !os.SameFile(openedInfo, afterInfo) {
		_ = directory.Close()
		if statErr != nil {
			return fmt.Errorf("inspect opened %s %s: %w", label, relativePath, statErr)
		}
		if lstatErr != nil {
			return fmt.Errorf("reinspect %s %s: %w", label, relativePath, lstatErr)
		}
		return fmt.Errorf("%s changed or became a symlink while opening: %s", label, relativePath)
	}
	if err := directory.Sync(); err != nil {
		_ = directory.Close()
		return fmt.Errorf("sync %s %s: %w", label, relativePath, err)
	}
	if err := directory.Close(); err != nil {
		return fmt.Errorf("close %s %s: %w", label, relativePath, err)
	}
	return nil
}

func realDestinationExists(root *os.Root, destination string) (bool, error) {
	validatedPath, err := validateManifestRelativePath(destination)
	if err != nil {
		return false, err
	}
	components := strings.Split(validatedPath, "/")
	currentPath := ""
	for index, component := range components {
		currentPath = path.Join(currentPath, component)
		info, err := root.Lstat(filepath.FromSlash(currentPath))
		if errors.Is(err, fs.ErrNotExist) {
			return false, nil
		}
		if err != nil {
			return false, fmt.Errorf("inspect storage destination %s: %w", currentPath, err)
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return false, fmt.Errorf("storage destination must not contain symbolic links: %s", currentPath)
		}
		if index < len(components)-1 && !info.IsDir() {
			return false, fmt.Errorf("storage destination parent is not a directory: %s", currentPath)
		}
		if index == len(components)-1 {
			if !info.Mode().IsRegular() {
				return false, fmt.Errorf(
					"existing storage destination must be a regular operator file: %s",
					currentPath,
				)
			}
			// Existing operator-owned paths are deliberately not opened, read,
			// compared, timestamped, chmodded, or replaced.
			return true, nil
		}
	}
	return false, nil
}

// installAtomicMissingFile publishes one fully synced missing file by exclusive
// hard link. It never replaces an existing operator path and cleans its private
// temporary link on every success or failure path.
func installAtomicMissingFile(
	storageRoot *os.Root,
	destination string,
	source io.Reader,
	mode fs.FileMode,
) (created bool, returnError error) {
	if exists, err := realDestinationExists(storageRoot, destination); err != nil {
		return false, err
	} else if exists {
		return false, nil
	}

	temporaryPath, temporaryFile, err := createExclusiveTemporaryFile(
		storageRoot,
		path.Dir(destination),
	)
	if err != nil {
		return false, err
	}
	temporaryOpen := true
	temporaryRemoved := false
	defer func() {
		if temporaryOpen {
			if closeErr := temporaryFile.Close(); returnError == nil && closeErr != nil {
				returnError = closeErr
			}
		}
		if !temporaryRemoved {
			removeErr := storageRoot.Remove(filepath.FromSlash(temporaryPath))
			if returnError == nil && removeErr != nil && !errors.Is(removeErr, fs.ErrNotExist) {
				returnError = removeErr
			}
			if removeErr == nil {
				if syncErr := syncVerifiedRealDirectory(
					storageRoot,
					path.Dir(temporaryPath),
					"public bootstrap temporary-file directory",
				); returnError == nil && syncErr != nil {
					returnError = syncErr
				}
			}
		}
	}()

	if _, err := io.Copy(temporaryFile, source); err != nil {
		return false, fmt.Errorf("copy temporary media file: %w", err)
	}
	if err := temporaryFile.Chmod(mode); err != nil {
		return false, fmt.Errorf("set temporary media permissions: %w", err)
	}
	if err := temporaryFile.Sync(); err != nil {
		return false, fmt.Errorf("sync temporary media file: %w", err)
	}
	if err := temporaryFile.Close(); err != nil {
		return false, fmt.Errorf("close temporary media file: %w", err)
	}
	temporaryOpen = false

	if exists, err := realDestinationExists(storageRoot, destination); err != nil {
		return false, err
	} else if exists {
		return false, nil
	}
	if err := storageRoot.Link(
		filepath.FromSlash(temporaryPath),
		filepath.FromSlash(destination),
	); err != nil {
		if errors.Is(err, fs.ErrExist) {
			return false, requireDestinationAfterExclusivePublishConflict(
				storageRoot,
				destination,
			)
		}
		return false, fmt.Errorf("publish media file exclusively: %w", err)
	}
	if err := storageRoot.Remove(filepath.FromSlash(temporaryPath)); err != nil {
		return true, fmt.Errorf("remove published media temporary link: %w", err)
	}
	temporaryRemoved = true
	if err := syncVerifiedRealDirectory(
		storageRoot,
		path.Dir(destination),
		"public bootstrap published-file directory",
	); err != nil {
		return true, err
	}
	return true, nil
}

func requireDestinationAfterExclusivePublishConflict(
	root *os.Root,
	destination string,
) error {
	exists, err := realDestinationExists(root, destination)
	if err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf(
			"exclusive publish conflict for %s, but the destination disappeared before verification",
			destination,
		)
	}
	return nil
}

func createExclusiveTemporaryFile(
	storageRoot *os.Root,
	parentDirectory string,
) (string, *os.File, error) {
	for attempt := 0; attempt < 100; attempt++ {
		sequence := publicBootstrapTemporaryFileSequence.Add(1)
		name := fmt.Sprintf(".filterest-bootstrap-media-%d-%d.tmp", os.Getpid(), sequence)
		temporaryPath := name
		if parentDirectory != "." {
			temporaryPath = path.Join(parentDirectory, name)
		}
		file, err := storageRoot.OpenFile(
			filepath.FromSlash(temporaryPath),
			os.O_WRONLY|os.O_CREATE|os.O_EXCL,
			0o600,
		)
		if errors.Is(err, fs.ErrExist) {
			continue
		}
		if err != nil {
			return "", nil, fmt.Errorf("create exclusive temporary media file: %w", err)
		}
		return temporaryPath, file, nil
	}
	return "", nil, fmt.Errorf("create exclusive temporary media file: too many name collisions")
}
