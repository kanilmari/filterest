// lang_key_source_roots.go
// Selects the source trees the language-key code scan reads and the paths it records.
// Bridges configured runtime roots with their link-resolved locations on disk.
// Exists so a scan that cannot read its whole tree fails instead of counting as complete.
package system_table_tools

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"easelect/backend/core_components/runtimepaths"
)

// langKeySourceRoot is one source tree the code scan reads. path is the root as
// configured and labelRoot the directory its recorded file paths are relative
// to; realPath is the same root with every link resolved, and the scan reads
// nothing outside it.
type langKeySourceRoot struct {
	path      string
	labelRoot string
	realPath  string
}

// codebaseSourceRoots returns the configured application and the composition's
// declared roots, or an error, never a partial list: an incomplete scan would let
// stale cleanup and orphan retirement remove keys that are still in use.
func codebaseSourceRoots(paths runtimepaths.Paths) ([]langKeySourceRoot, error) {
	installationRoot := strings.TrimSpace(paths.InstallationRoot)
	applicationRoot := strings.TrimSpace(paths.ApplicationRoot)
	if installationRoot == "" || !filepath.IsAbs(installationRoot) {
		return nil, fmt.Errorf("configured Filterest installation root is unresolved")
	}
	if applicationRoot == "" || !filepath.IsAbs(applicationRoot) {
		return nil, fmt.Errorf("configured Filterest application root is unresolved")
	}
	installationRoot = filepath.Clean(installationRoot)
	applicationRoot = filepath.Clean(applicationRoot)
	// The application may be reached through a link, as Easelect's composition
	// reaches its sibling checkout; where it really lies bounds what is read.
	realApplicationRoot, err := filepath.EvalSymlinks(applicationRoot)
	if err != nil {
		return nil, fmt.Errorf("resolve language-key application root %q: %w", applicationRoot, err)
	}
	if err := validateLangKeySourceRoot(realApplicationRoot, true); err != nil {
		return nil, err
	}
	realInstallationRoot, err := filepath.EvalSymlinks(installationRoot)
	if err != nil {
		return nil, fmt.Errorf("resolve Filterest installation root %q: %w", installationRoot, err)
	}

	// Stale cleanup compares the recorded paths, so none may climb out of its root.
	// An application outside the installation, such as Easelect's sibling
	// Filterest checkout, is recorded from the directory holding it and keeps
	// the app/... paths of a standalone installation.
	applicationLabelRoot := installationRoot
	if !pathIsInsideRoot(installationRoot, applicationRoot) {
		applicationLabelRoot = filepath.Dir(applicationRoot)
	}
	sourceRoots := []langKeySourceRoot{{path: applicationRoot, labelRoot: applicationLabelRoot, realPath: realApplicationRoot}}
	for _, sourceRoot := range configuredAdditionalLangKeySourceRoots() {
		// Composition-owned sources are named within the installation itself,
		// and a link must not carry them out of it.
		if !pathIsInsideRoot(installationRoot, sourceRoot) {
			return nil, fmt.Errorf("additional language-key source root %q is outside installation root %q", sourceRoot, installationRoot)
		}
		realSourceRoot, err := filepath.EvalSymlinks(sourceRoot)
		if err != nil {
			return nil, fmt.Errorf("resolve additional language-key source root %q: %w", sourceRoot, err)
		}
		if !pathIsInsideRoot(realInstallationRoot, realSourceRoot) {
			return nil, fmt.Errorf("additional language-key source root %q is outside installation root %q", sourceRoot, installationRoot)
		}
		if err := validateLangKeySourceRoot(realSourceRoot, false); err != nil {
			return nil, err
		}
		sourceRoots = append(sourceRoots, langKeySourceRoot{path: sourceRoot, labelRoot: installationRoot, realPath: realSourceRoot})
	}
	return sourceRoots, nil
}

// langKeyScanDirectory is one frontend or backend tree of a source root: the
// directory as configured, where it really lies, the directory its recorded
// paths are relative to, and the resolved source root no read may leave.
type langKeyScanDirectory struct {
	path         string
	realPath     string
	labelRoot    string
	rootRealPath string
}

// langKeyScanDirectories resolves the frontend and backend trees of each source
// root. filepath.Walk does not enter a directory link, so a linked tree is
// walked where it really lies, and one that leads out of its source root stops
// the scan instead of being skipped as an empty tree.
func langKeyScanDirectories(sourceRoots []langKeySourceRoot) ([]langKeyScanDirectory, error) {
	var scanDirectories []langKeyScanDirectory
	for _, sourceRoot := range sourceRoots {
		for _, sourceDirectory := range []string{"frontend", "backend"} {
			realDirectory, err := containedLangKeySourcePath(
				filepath.Join(sourceRoot.realPath, sourceDirectory),
				sourceRoot.realPath,
			)
			if err != nil {
				return nil, err
			}
			scanDirectories = append(scanDirectories, langKeyScanDirectory{
				path:         filepath.Join(sourceRoot.path, sourceDirectory),
				realPath:     realDirectory,
				labelRoot:    sourceRoot.labelRoot,
				rootRealPath: sourceRoot.realPath,
			})
		}
	}
	return scanDirectories, nil
}

// containedLangKeySourcePath resolves every link in path and refuses a location
// outside realRoot.
func containedLangKeySourcePath(path string, realRoot string) (string, error) {
	realPath, err := filepath.EvalSymlinks(path)
	if err != nil {
		return "", fmt.Errorf("resolve language-key source path %q: %w", path, err)
	}
	if !pathIsInsideRoot(realRoot, realPath) {
		return "", fmt.Errorf("language-key source path %q leads outside its source root %q", path, realRoot)
	}
	return realPath, nil
}

// fileToRead returns where the scan reads one walked entry that is not a
// directory, or "" for an entry it skips. A link must resolve inside the source
// root or the scan stops; a link to a file is read where it leads, and a link to
// a directory is not entered, just as filepath.Walk does not enter it.
func (scanDirectory langKeyScanDirectory) fileToRead(path string, info os.FileInfo) (string, error) {
	if info.Mode()&os.ModeSymlink == 0 {
		if !info.Mode().IsRegular() {
			return "", nil
		}
		return path, nil
	}
	target, err := containedLangKeySourcePath(path, scanDirectory.rootRealPath)
	if err != nil {
		return "", err
	}
	targetInfo, err := os.Stat(target)
	if err != nil {
		return "", fmt.Errorf("language-key source link %q: %w", path, err)
	}
	if !targetInfo.Mode().IsRegular() {
		return "", nil
	}
	return target, nil
}

// recordedPath returns the path one walked file is recorded under. It is taken
// through the directory as configured, so a linked tree keeps the paths of its
// configured location, and it never leaves the label root.
func (scanDirectory langKeyScanDirectory) recordedPath(walkedPath string) (string, error) {
	withinDirectory, err := filepath.Rel(scanDirectory.realPath, walkedPath)
	if err != nil {
		return "", err
	}
	configuredPath := filepath.Join(scanDirectory.path, withinDirectory)
	if !pathIsInsideRoot(scanDirectory.labelRoot, configuredPath) {
		return "", fmt.Errorf("language-key source file %q is outside its source root %q", configuredPath, scanDirectory.labelRoot)
	}
	recordedPath, err := filepath.Rel(scanDirectory.labelRoot, configuredPath)
	if err != nil {
		return "", err
	}
	return filepath.ToSlash(recordedPath), nil
}
