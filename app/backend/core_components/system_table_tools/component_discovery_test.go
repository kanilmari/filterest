// component_discovery_test.go
// Proves component-only language keys survive source discovery and population.
// Connects one shared temporary canary to the real scanner and fake database driver.
// Prevents orphan retirement from treating undiscovered components as unused keys.
package system_table_tools

import (
	"database/sql/driver"
	"os"
	"path/filepath"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/testing/componentfixture"
)

func TestComponentCanaryLanguageSourceAndOrphanProof(t *testing.T) {
	root := componentfixture.Write(t)
	replaceLangKeyRuntimePathsForTest(t, langKeyRuntimePaths(root, filepath.Join(root, "app")))
	replaceAdditionalLangKeySourceRootsForTest(t, nil)
	path := "app/components/canary/frontend/index.js"
	hasKey := func() bool {
		entries, err := scanCodebaseForLangKeySources()
		if err != nil {
			t.Fatal(err)
		}
		for _, entry := range entries {
			if entry.langKey == "component_canary_label" && entry.filePath == path {
				return true
			}
		}
		return false
	}
	if !hasKey() {
		t.Fatal("correct component-only key appears orphaned")
	}
	if err := os.WriteFile(filepath.Join(root, filepath.FromSlash(path)), []byte("// orphaned key: no reference\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if hasKey() {
		t.Fatal("orphaned-key canary break was not detected")
	}
}

func TestComponentCanaryLanguagePopulation(t *testing.T) {
	root := componentfixture.Write(t)
	replaceLangKeyRuntimePathsForTest(t, langKeyRuntimePaths(root, filepath.Join(root, "app")))
	replaceAdditionalLangKeySourceRootsForTest(t, nil)
	resetOrphanQueues()
	t.Cleanup(resetOrphanQueues)
	markSourceScanFreshForTest(t)
	db := newSystemTableToolsTestDB(t)
	defer db.Close()
	previous := backend.Db
	backend.Db = db
	t.Cleanup(func() { backend.Db = previous })
	pushOrphanQuery(orphanQueuedQuery{cols: []string{"id", "lang_key"}, rows: [][]driver.Value{{int64(1), "component_canary_label"}}})
	// Schema, views, groups, folders, foreign keys and key-valued columns are
	// empty in this fixture. Only the component's code source is populated.
	for _, columns := range [][]string{{"column_name", "table_name"}, {"table_name"}, {"name"}, {"name"}, {"folder_name"}, {"schema", "table", "column"}, {"column_name", "table_name"}} {
		pushOrphanQuery(orphanQueuedQuery{cols: columns})
	}
	pushOrphanExec(orphanQueuedExec{rowsAffected: 1})
	pushOrphanExec(orphanQueuedExec{rowsAffected: 1}) // Existing-key literal evidence.
	queueCodeSourceHistory(nil)
	pushOrphanExec(orphanQueuedExec{rowsAffected: 0}) // No stale sources to remove.
	total, err := PopulateLangKeySources()
	if err != nil || total != 2 || !SourceScanIsFresh() {
		t.Fatalf("population=%d err=%v fresh=%v", total, err, SourceScanIsFresh())
	}
}

func TestComponentLanguageTreeRefusesEscapingOrBrokenLinks(t *testing.T) {
	for _, broken := range []bool{false, true} {
		t.Run(map[bool]string{false: "escaping", true: "dangling"}[broken], func(t *testing.T) {
			root := componentfixture.Write(t)
			components := filepath.Join(root, "app", "components")
			if err := os.RemoveAll(components); err != nil {
				t.Fatal(err)
			}
			target := t.TempDir()
			if broken {
				target = filepath.Join(target, "missing")
			}
			if err := os.Symlink(target, components); err != nil {
				t.Fatal(err)
			}
			replaceLangKeyRuntimePathsForTest(t, langKeyRuntimePaths(root, filepath.Join(root, "app")))
			replaceAdditionalLangKeySourceRootsForTest(t, nil)
			if _, err := scanCodebaseForLangKeySources(); err == nil {
				t.Fatal("unsafe component source tree was accepted")
			}
		})
	}
}
