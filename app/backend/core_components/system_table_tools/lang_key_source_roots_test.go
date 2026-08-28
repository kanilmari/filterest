// lang_key_source_roots_test.go
// Verifies canonical language-source roots and fail-closed scan maintenance.
// Bridges nested public app sources with explicitly configured private sources.
// Exists so incomplete scans cannot age or delete still-active language keys.
package system_table_tools

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/runtimepaths"
)

func createLangKeySourceRoot(t *testing.T, root string, applicationRoot bool) {
	t.Helper()
	for _, directory := range []string{"frontend", "backend"} {
		if err := os.MkdirAll(filepath.Join(root, directory), 0o755); err != nil {
			t.Fatalf("os.MkdirAll(%q) error = %v", directory, err)
		}
	}
	if !applicationRoot {
		return
	}
	for _, marker := range []string{"go.mod", "VERSION_APP"} {
		if err := os.WriteFile(filepath.Join(root, marker), []byte("test\n"), 0o644); err != nil {
			t.Fatalf("os.WriteFile(%q) error = %v", marker, err)
		}
	}
}

func langKeyRuntimePaths(installationRoot string, applicationRoot string) runtimepaths.Paths {
	return runtimepaths.Paths{
		InstallationRoot: installationRoot,
		ApplicationRoot:  applicationRoot,
	}
}

func replaceLangKeyRuntimePathsForTest(t *testing.T, paths runtimepaths.Paths) {
	t.Helper()
	previousResolver := currentLangKeyRuntimePaths
	currentLangKeyRuntimePaths = func() runtimepaths.Paths { return paths }
	t.Cleanup(func() {
		currentLangKeyRuntimePaths = previousResolver
	})
}

func replaceAdditionalLangKeySourceRootsForTest(t *testing.T, sourceRoots []string) {
	t.Helper()
	previousRoots := configuredAdditionalLangKeySourceRoots()
	if err := ConfigureAdditionalLangKeySourceRoots(sourceRoots); err != nil {
		t.Fatalf("ConfigureAdditionalLangKeySourceRoots() error = %v", err)
	}
	t.Cleanup(func() {
		if err := ConfigureAdditionalLangKeySourceRoots(previousRoots); err != nil {
			t.Errorf("restore ConfigureAdditionalLangKeySourceRoots() error = %v", err)
		}
	})
}

func markSourceScanFreshForTest(t *testing.T) {
	t.Helper()
	lastSourceScanMu.Lock()
	previousScan := lastSourceScan
	lastSourceScan = time.Now()
	lastSourceScanMu.Unlock()
	t.Cleanup(func() {
		lastSourceScanMu.Lock()
		lastSourceScan = previousScan
		lastSourceScanMu.Unlock()
	})
}

func assertFailedPopulationDidNotRunDestructiveMaintenance(
	t *testing.T,
	populateErr error,
	total int,
) {
	t.Helper()
	if populateErr == nil {
		t.Fatal("PopulateLangKeySources() error = nil, want scan failure")
	}
	if total != 0 {
		t.Fatalf("PopulateLangKeySources() total = %d, want 0", total)
	}
	if SourceScanIsFresh() {
		t.Fatal("SourceScanIsFresh() = true after failed scan")
	}
	if deletedRows := cleanupStaleLangKeySources(); deletedRows != 0 {
		t.Fatalf("cleanupStaleLangKeySources() = %d, want 0", deletedRows)
	}
	orphanCount, deOrphanedCount := MarkOrphanLangKeys()
	if orphanCount != 0 || deOrphanedCount != 0 {
		t.Fatalf(
			"MarkOrphanLangKeys() = (%d, %d), want (0, 0)",
			orphanCount,
			deOrphanedCount,
		)
	}
	for _, call := range snapshotOrphanCalls() {
		if strings.Contains(strings.ToUpper(call), "DELETE") {
			t.Fatalf("failed scan executed destructive SQL: %q", call)
		}
	}
	if calls := snapshotOrphanCalls(); len(calls) != 0 {
		t.Fatalf("failed scan reached database, calls = %v", calls)
	}
}

func TestCodebaseSourceRootsUsesNestedApplicationRoot(t *testing.T) {
	installationRoot := t.TempDir()
	applicationRoot := filepath.Join(installationRoot, "app")
	createLangKeySourceRoot(t, applicationRoot, true)
	replaceAdditionalLangKeySourceRootsForTest(t, nil)

	got, err := codebaseSourceRoots(langKeyRuntimePaths(installationRoot, applicationRoot))
	if err != nil {
		t.Fatalf("codebaseSourceRoots() error = %v", err)
	}
	if want := []string{applicationRoot}; !reflect.DeepEqual(got, want) {
		t.Fatalf("codebaseSourceRoots() = %v, want %v", got, want)
	}
}

func TestCodebaseSourceRootsIncludesOnlyExplicitPrivateCompositionRoot(t *testing.T) {
	installationRoot := t.TempDir()
	applicationRoot := filepath.Join(installationRoot, "filterest", "app")
	privateRoot := filepath.Join(installationRoot, "filterest_private")
	createLangKeySourceRoot(t, applicationRoot, true)
	createLangKeySourceRoot(t, privateRoot, false)
	replaceAdditionalLangKeySourceRootsForTest(t, []string{privateRoot})

	got, err := codebaseSourceRoots(langKeyRuntimePaths(installationRoot, applicationRoot))
	if err != nil {
		t.Fatalf("codebaseSourceRoots() error = %v", err)
	}
	want := []string{applicationRoot, privateRoot}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("codebaseSourceRoots() = %v, want %v", got, want)
	}
}

func TestPopulateLangKeySourcesMissingApplicationRootFailsClosed(t *testing.T) {
	resetOrphanQueues()
	t.Cleanup(resetOrphanQueues)
	replaceAdditionalLangKeySourceRootsForTest(t, nil)
	markSourceScanFreshForTest(t)

	installationRoot := t.TempDir()
	replaceLangKeyRuntimePathsForTest(
		t,
		langKeyRuntimePaths(installationRoot, filepath.Join(installationRoot, "app")),
	)

	testDB := newSystemTableToolsTestDB(t)
	defer testDB.Close()
	previousDB := backend.Db
	backend.Db = testDB
	t.Cleanup(func() { backend.Db = previousDB })

	total, err := PopulateLangKeySources()
	assertFailedPopulationDidNotRunDestructiveMaintenance(t, err, total)
}

func TestPopulateLangKeySourcesWalkFailureFailsClosed(t *testing.T) {
	resetOrphanQueues()
	t.Cleanup(resetOrphanQueues)
	replaceAdditionalLangKeySourceRootsForTest(t, nil)
	markSourceScanFreshForTest(t)

	installationRoot := t.TempDir()
	applicationRoot := filepath.Join(installationRoot, "app")
	createLangKeySourceRoot(t, applicationRoot, true)
	replaceLangKeyRuntimePathsForTest(
		t,
		langKeyRuntimePaths(installationRoot, applicationRoot),
	)

	forcedWalkError := errors.New("forced source walk failure")
	previousWalk := walkLangKeySourceTree
	walkLangKeySourceTree = func(string, filepath.WalkFunc) error {
		return forcedWalkError
	}
	t.Cleanup(func() { walkLangKeySourceTree = previousWalk })

	testDB := newSystemTableToolsTestDB(t)
	defer testDB.Close()
	previousDB := backend.Db
	backend.Db = testDB
	t.Cleanup(func() { backend.Db = previousDB })

	total, err := PopulateLangKeySources()
	if !errors.Is(err, forcedWalkError) {
		t.Fatalf("PopulateLangKeySources() error = %v, want %v", err, forcedWalkError)
	}
	assertFailedPopulationDidNotRunDestructiveMaintenance(t, err, total)
}
