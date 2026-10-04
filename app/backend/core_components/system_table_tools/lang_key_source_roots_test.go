// lang_key_source_roots_test.go
// Verifies canonical language-source roots and fail-closed scan maintenance.
// Bridges nested public app sources and sibling composition apps with explicitly configured private sources.
// Exists so incomplete scans cannot age or delete still-active language keys.
package system_table_tools

import (
	"database/sql/driver"
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

// realPathForTest resolves a fixture path the way the scan does, so the
// expectations also hold where the temporary directory itself is a link.
func realPathForTest(t *testing.T, path string) string {
	t.Helper()
	realPath, err := filepath.EvalSymlinks(path)
	if err != nil {
		t.Fatalf("filepath.EvalSymlinks(%q) error = %v", path, err)
	}
	return realPath
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
	want := []langKeySourceRoot{
		{path: applicationRoot, labelRoot: installationRoot, realPath: realPathForTest(t, applicationRoot)},
	}
	if !reflect.DeepEqual(got, want) {
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
	want := []langKeySourceRoot{
		{path: applicationRoot, labelRoot: installationRoot, realPath: realPathForTest(t, applicationRoot)},
		{path: privateRoot, labelRoot: installationRoot, realPath: realPathForTest(t, privateRoot)},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("codebaseSourceRoots() = %v, want %v", got, want)
	}
}

// siblingCompositionLayout builds Easelect's current shape: the composition's
// own workspace with its private sources, and a Filterest checkout beside it.
func siblingCompositionLayout(t *testing.T) (installationRoot string, applicationRoot string, privateRoot string) {
	t.Helper()
	workspace := t.TempDir()
	installationRoot = filepath.Join(workspace, "easelect")
	applicationRoot = filepath.Join(workspace, "filterest", "app")
	privateRoot = filepath.Join(installationRoot, "filterest_private")
	createLangKeySourceRoot(t, applicationRoot, true)
	createLangKeySourceRoot(t, privateRoot, false)
	return installationRoot, applicationRoot, privateRoot
}

func TestCodebaseSourceRootsAcceptsSiblingCompositionApplication(t *testing.T) {
	installationRoot, applicationRoot, privateRoot := siblingCompositionLayout(t)
	replaceAdditionalLangKeySourceRootsForTest(t, []string{privateRoot})

	got, err := codebaseSourceRoots(langKeyRuntimePaths(installationRoot, applicationRoot))
	if err != nil {
		t.Fatalf("codebaseSourceRoots() error = %v", err)
	}
	want := []langKeySourceRoot{
		{path: applicationRoot, labelRoot: filepath.Dir(applicationRoot), realPath: realPathForTest(t, applicationRoot)},
		{path: privateRoot, labelRoot: installationRoot, realPath: realPathForTest(t, privateRoot)},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("codebaseSourceRoots() = %v, want %v", got, want)
	}
}

func TestCodebaseSourceRootsRejectsUnmarkedApplicationOutsideInstallation(t *testing.T) {
	workspace := t.TempDir()
	installationRoot := filepath.Join(workspace, "easelect")
	applicationRoot := filepath.Join(workspace, "unrelated", "app")
	createLangKeySourceRoot(t, applicationRoot, false)
	replaceAdditionalLangKeySourceRootsForTest(t, nil)

	_, err := codebaseSourceRoots(langKeyRuntimePaths(installationRoot, applicationRoot))
	if err == nil || !strings.Contains(err.Error(), "application root marker") {
		t.Fatalf("codebaseSourceRoots() error = %v, want missing application marker", err)
	}
}

func TestCodebaseSourceRootsRejectsCompositionRootOutsideInstallation(t *testing.T) {
	installationRoot, applicationRoot, _ := siblingCompositionLayout(t)
	outsideRoot := filepath.Join(filepath.Dir(installationRoot), "elsewhere")
	createLangKeySourceRoot(t, outsideRoot, false)
	replaceAdditionalLangKeySourceRootsForTest(t, []string{outsideRoot})

	_, err := codebaseSourceRoots(langKeyRuntimePaths(installationRoot, applicationRoot))
	if err == nil || !strings.Contains(err.Error(), "outside installation root") {
		t.Fatalf("codebaseSourceRoots() error = %v, want outside-installation refusal", err)
	}
}

func writeLangKeyReference(t *testing.T, path string, langKey string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("os.MkdirAll(%q) error = %v", filepath.Dir(path), err)
	}
	reference := "element.dataset.langKey = \"" + langKey + "\";\n"
	if err := os.WriteFile(path, []byte(reference), 0o644); err != nil {
		t.Fatalf("os.WriteFile(%q) error = %v", path, err)
	}
}

func TestScanCodebaseForLangKeySourcesRecordsTheSameAppPathsInEitherLayout(t *testing.T) {
	standaloneRoot := filepath.Join(t.TempDir(), "filterest")
	standaloneApplication := filepath.Join(standaloneRoot, "app")
	createLangKeySourceRoot(t, standaloneApplication, true)
	compositionRoot, compositionApplication, privateRoot := siblingCompositionLayout(t)

	for _, layout := range []struct {
		name             string
		installationRoot string
		applicationRoot  string
		privateRoots     []string
		want             []sourceEntry
	}{
		{
			name:             "standalone nested installation",
			installationRoot: standaloneRoot,
			applicationRoot:  standaloneApplication,
			want: []sourceEntry{
				{langKey: "wl45_frontend_key", filePath: "app/frontend/views/view_builder.js"},
				{langKey: "wl45_backend_key", filePath: "app/backend/handlers/handler.go"},
			},
		},
		{
			name:             "composition with a sibling Filterest checkout",
			installationRoot: compositionRoot,
			applicationRoot:  compositionApplication,
			privateRoots:     []string{privateRoot},
			want: []sourceEntry{
				{langKey: "wl45_frontend_key", filePath: "app/frontend/views/view_builder.js"},
				{langKey: "wl45_backend_key", filePath: "app/backend/handlers/handler.go"},
				{langKey: "wl45_private_key", filePath: "filterest_private/frontend/private_tools/tool.js"},
			},
		},
	} {
		t.Run(layout.name, func(t *testing.T) {
			writeLangKeyReference(t, filepath.Join(layout.applicationRoot, "frontend", "views", "view_builder.js"), "wl45_frontend_key")
			writeLangKeyReference(t, filepath.Join(layout.applicationRoot, "backend", "handlers", "handler.go"), "wl45_backend_key")
			for _, privateRoot := range layout.privateRoots {
				writeLangKeyReference(t, filepath.Join(privateRoot, "frontend", "private_tools", "tool.js"), "wl45_private_key")
			}
			replaceLangKeyRuntimePathsForTest(t, langKeyRuntimePaths(layout.installationRoot, layout.applicationRoot))
			replaceAdditionalLangKeySourceRootsForTest(t, layout.privateRoots)

			got, err := scanCodebaseForLangKeySources()
			if err != nil {
				t.Fatalf("scanCodebaseForLangKeySources() error = %v", err)
			}
			if !reflect.DeepEqual(got, layout.want) {
				t.Fatalf("scanCodebaseForLangKeySources() = %v, want %v", got, layout.want)
			}
		})
	}
}

func TestPopulateLangKeySourcesSavesSiblingCompositionSources(t *testing.T) {
	resetOrphanQueues()
	t.Cleanup(resetOrphanQueues)
	lastSourceScanMu.Lock()
	previousScan := lastSourceScan
	lastSourceScan = time.Time{}
	lastSourceScanMu.Unlock()
	t.Cleanup(func() {
		lastSourceScanMu.Lock()
		lastSourceScan = previousScan
		lastSourceScanMu.Unlock()
	})

	installationRoot, applicationRoot, privateRoot := siblingCompositionLayout(t)
	writeLangKeyReference(t, filepath.Join(applicationRoot, "frontend", "view_builder.js"), "wl45_frontend_key")
	writeLangKeyReference(t, filepath.Join(privateRoot, "frontend", "tool.js"), "wl45_private_key")
	replaceLangKeyRuntimePathsForTest(t, langKeyRuntimePaths(installationRoot, applicationRoot))
	replaceAdditionalLangKeySourceRootsForTest(t, []string{privateRoot})

	testDB := newSystemTableToolsTestDB(t)
	defer testDB.Close()
	previousDB := backend.Db
	backend.Db = testDB
	t.Cleanup(func() { backend.Db = previousDB })

	// The key registry and one saved code source per scanned file. The schema
	// and database readers that follow find nothing queued and contribute none.
	pushOrphanQuery(orphanQueuedQuery{
		cols: []string{"id", "lang_key"},
		rows: [][]driver.Value{{int64(1), "wl45_frontend_key"}, {int64(2), "wl45_private_key"}},
	})
	pushOrphanExec(orphanQueuedExec{rowsAffected: 1})
	pushOrphanExec(orphanQueuedExec{rowsAffected: 1})

	total, err := PopulateLangKeySources()
	if err != nil {
		t.Fatalf("PopulateLangKeySources() error = %v", err)
	}
	if total != 2 {
		t.Fatalf("PopulateLangKeySources() total = %d, want 2", total)
	}
	if !SourceScanIsFresh() {
		t.Fatal("SourceScanIsFresh() = false after a complete scan")
	}
	savedCodeSources := 0
	for _, call := range snapshotOrphanCalls() {
		if strings.Contains(call, "INSERT INTO system_lang_key_sources") {
			savedCodeSources++
		}
	}
	if savedCodeSources != 2 {
		t.Fatalf("saved code sources = %d, want 2", savedCodeSources)
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

func linkForTest(t *testing.T, target string, link string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(link), 0o755); err != nil {
		t.Fatalf("os.MkdirAll(%q) error = %v", filepath.Dir(link), err)
	}
	if err := os.Symlink(target, link); err != nil {
		t.Fatalf("os.Symlink(%q, %q) error = %v", target, link, err)
	}
}

// assertLinkedSourceRefused checks that the scan stops on a link leading out of
// its source root, and that population then reaches no database at all.
func assertLinkedSourceRefused(t *testing.T, installationRoot string, applicationRoot string) {
	t.Helper()
	resetOrphanQueues()
	t.Cleanup(resetOrphanQueues)
	replaceAdditionalLangKeySourceRootsForTest(t, nil)
	replaceLangKeyRuntimePathsForTest(t, langKeyRuntimePaths(installationRoot, applicationRoot))

	entries, err := scanCodebaseForLangKeySources()
	if err == nil || !strings.Contains(err.Error(), "leads outside its source root") {
		t.Fatalf("scanCodebaseForLangKeySources() = %v, %v; want a refused link", entries, err)
	}

	markSourceScanFreshForTest(t)
	testDB := newSystemTableToolsTestDB(t)
	defer testDB.Close()
	previousDB := backend.Db
	backend.Db = testDB
	t.Cleanup(func() { backend.Db = previousDB })

	total, err := PopulateLangKeySources()
	assertFailedPopulationDidNotRunDestructiveMaintenance(t, err, total)
}

func TestScanCodebaseForLangKeySourcesRefusesARequiredDirectoryLinkedOutside(t *testing.T) {
	workspace := t.TempDir()
	installationRoot := filepath.Join(workspace, "filterest")
	applicationRoot := filepath.Join(installationRoot, "app")
	createLangKeySourceRoot(t, applicationRoot, true)
	outsideFrontend := filepath.Join(workspace, "elsewhere", "frontend")
	writeLangKeyReference(t, filepath.Join(outsideFrontend, "view_builder.js"), "wl45_outside_key")
	if err := os.Remove(filepath.Join(applicationRoot, "frontend")); err != nil {
		t.Fatalf("os.Remove(frontend) error = %v", err)
	}
	linkForTest(t, outsideFrontend, filepath.Join(applicationRoot, "frontend"))

	assertLinkedSourceRefused(t, installationRoot, applicationRoot)
}

func TestScanCodebaseForLangKeySourcesRefusesAFileLinkedOutside(t *testing.T) {
	workspace := t.TempDir()
	installationRoot := filepath.Join(workspace, "filterest")
	applicationRoot := filepath.Join(installationRoot, "app")
	createLangKeySourceRoot(t, applicationRoot, true)
	outsideFile := filepath.Join(workspace, "outside", "settings.js")
	writeLangKeyReference(t, outsideFile, "wl45_outside_key")
	linkForTest(t, outsideFile, filepath.Join(applicationRoot, "frontend", "linked_settings.js"))

	assertLinkedSourceRefused(t, installationRoot, applicationRoot)
}

func TestCodebaseSourceRootsRejectsCompositionRootLinkedOutsideInstallation(t *testing.T) {
	installationRoot, applicationRoot, _ := siblingCompositionLayout(t)
	outsideRoot := filepath.Join(filepath.Dir(installationRoot), "elsewhere")
	createLangKeySourceRoot(t, outsideRoot, false)
	linkedRoot := filepath.Join(installationRoot, "linked_private")
	linkForTest(t, outsideRoot, linkedRoot)
	replaceAdditionalLangKeySourceRootsForTest(t, []string{linkedRoot})

	_, err := codebaseSourceRoots(langKeyRuntimePaths(installationRoot, applicationRoot))
	if err == nil || !strings.Contains(err.Error(), "outside installation root") {
		t.Fatalf("codebaseSourceRoots() error = %v, want outside-installation refusal", err)
	}
}

func TestScanCodebaseForLangKeySourcesFollowsLinksThatStayInside(t *testing.T) {
	installationRoot := filepath.Join(t.TempDir(), "filterest")
	applicationRoot := filepath.Join(installationRoot, "app")
	createLangKeySourceRoot(t, applicationRoot, true)
	// frontend is a link to a tree inside the application, and that tree holds
	// a dependency link out of it, which is skipped like a dependency folder.
	frontendSource := filepath.Join(applicationRoot, "frontend_source")
	writeLangKeyReference(t, filepath.Join(frontendSource, "views", "view_builder.js"), "wl45_frontend_key")
	outsideModules := filepath.Join(filepath.Dir(installationRoot), "node_modules")
	if err := os.MkdirAll(outsideModules, 0o755); err != nil {
		t.Fatalf("os.MkdirAll(%q) error = %v", outsideModules, err)
	}
	linkForTest(t, outsideModules, filepath.Join(frontendSource, "node_modules"))
	if err := os.Remove(filepath.Join(applicationRoot, "frontend")); err != nil {
		t.Fatalf("os.Remove(frontend) error = %v", err)
	}
	linkForTest(t, "frontend_source", filepath.Join(applicationRoot, "frontend"))
	// A file link inside the tree is read where it leads.
	writeLangKeyReference(t, filepath.Join(applicationRoot, "backend", "handlers", "handler.go"), "wl45_backend_key")
	linkForTest(t, filepath.Join("handlers", "handler.go"), filepath.Join(applicationRoot, "backend", "linked_handler.go"))
	replaceAdditionalLangKeySourceRootsForTest(t, nil)
	replaceLangKeyRuntimePathsForTest(t, langKeyRuntimePaths(installationRoot, applicationRoot))

	got, err := scanCodebaseForLangKeySources()
	if err != nil {
		t.Fatalf("scanCodebaseForLangKeySources() error = %v", err)
	}
	want := []sourceEntry{
		{langKey: "wl45_frontend_key", filePath: "app/frontend/views/view_builder.js"},
		{langKey: "wl45_backend_key", filePath: "app/backend/handlers/handler.go"},
		{langKey: "wl45_backend_key", filePath: "app/backend/linked_handler.go"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("scanCodebaseForLangKeySources() = %v, want %v", got, want)
	}
}

func TestScanCodebaseForLangKeySourcesAcceptsAnApplicationReachedThroughALink(t *testing.T) {
	// Easelect's workspace links filterest -> ../filterest, its sibling checkout.
	workspace := t.TempDir()
	installationRoot := filepath.Join(workspace, "easelect")
	checkoutApplication := filepath.Join(workspace, "filterest", "app")
	createLangKeySourceRoot(t, checkoutApplication, true)
	writeLangKeyReference(t, filepath.Join(checkoutApplication, "frontend", "view_builder.js"), "wl45_frontend_key")
	linkForTest(t, filepath.Join("..", "filterest"), filepath.Join(installationRoot, "filterest"))
	applicationRoot := filepath.Join(installationRoot, "filterest", "app")
	replaceAdditionalLangKeySourceRootsForTest(t, nil)
	replaceLangKeyRuntimePathsForTest(t, langKeyRuntimePaths(installationRoot, applicationRoot))

	got, err := scanCodebaseForLangKeySources()
	if err != nil {
		t.Fatalf("scanCodebaseForLangKeySources() error = %v", err)
	}
	want := []sourceEntry{{langKey: "wl45_frontend_key", filePath: "filterest/app/frontend/view_builder.js"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("scanCodebaseForLangKeySources() = %v, want %v", got, want)
	}
}
