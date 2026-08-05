// optional_tasks.go
// Runs optional background tasks during server startup. Executes non-critical initialization
// steps such as cache warming and consistency checks that do not block startup.
// Exists to separate best-effort maintenance from the critical server boot path.
package startup

import (
	"log"
	"os"
	"path/filepath"

	backend "easelect/backend/core_components"
	dtt_system_table_folders "easelect/backend/core_components/dynamic_table_tools/dtt_table_folders"
	"easelect/backend/core_components/system_table_tools"
)

// RunOptionalTasks executes optional startup tasks.
func RunOptionalTasks(exeDir string) {
	projectRoot := resolveProjectRoot(exeDir)

	// Heal an inconsistent bootstrap (anonymous browsing on, but guest has no
	// dataset-read rights) before serving requests, so a fresh machine does not
	// 403-storm on its first page load.
	EnsureAnonymousBrowseConsistency(backend.Db)

	system_table_tools.StartAutomaticDataRetentionLoop(backend.Db)
	go runDeferredStartupMaintenance(projectRoot)
}

func runDeferredStartupMaintenance(projectRoot string) {
	log.Println("[STARTUP] Optional maintenance continues in background.")

	if cleanupResult, err := dtt_system_table_folders.ReconcileLegacyOtherTablesFolder(backend.Db); err != nil {
		log.Printf("\033[31merror: [STARTUP] legacy other_tables cleanup failed: %v\033[0m", err)
	} else if cleanupResult.DeletedFolderCount > 0 || cleanupResult.ReassignedTableCount > 0 || cleanupResult.ReparentedChildFolderCount > 0 {
		log.Printf(
			"[STARTUP] Reconciled legacy other_tables roots %v -> canonical folder %d (moved %d tables, reparented %d child folders, deleted %d legacy roots)",
			cleanupResult.LegacyRootFolderIDs,
			cleanupResult.CanonicalFolderID,
			cleanupResult.ReassignedTableCount,
			cleanupResult.ReparentedChildFolderCount,
			cleanupResult.DeletedFolderCount,
		)
	}

	if mirroredRows, err := SyncAppDBCompatibilityMirror(backend.Db, projectRoot); err != nil {
		log.Printf("\033[31merror: [STARTUP] app/db compatibility mirror sync failed: %v\033[0m", err)
	} else if mirroredRows > 0 {
		log.Printf("[STARTUP] App/DB compatibility mirror synced: %d row(s)", mirroredRows)
	}

	// Tarkistetaan käynnistyksessä, että jokaisella taululla on primary key.
	CheckAllTablesHavePrimaryKey(backend.Db)
	EnsurePrimaryKeyLangKeys(backend.Db)
	EnsureAppDBCompatibilityLangKeys(backend.Db)
	EnsureLoginPageLangKeys(backend.Db)
	EnsureViewSelectorLangKeys(backend.Db)
	EnsureFilterestBusinessID(backend.Db)

	EnsureLangEmbeddingTables()
	// Populoi lähdetiedot: skannaa koodipohja (JS/HTML/Go), skeema (sarakkeet/taulut)
	// ja tietokantapohjaiset avaimet (views, groups) system_lang_key_sources-tauluun.
	// Tämä pitää ajaa ENNEN MarkOrphanLangKeys():ta, koska orphan-tunnistus
	// perustuu nyt sources-taulun sisältöön (ei itsenäiseen skannaukseen).
	sourceCount := system_table_tools.PopulateLangKeySources()
	log.Printf("[STARTUP] Lang key sources: %d source(s) saved", sourceCount)

	// Merkitään orpoavaimet system_lang_key_sources-tauluun (source_type='orphan').
	// Orpo = avain jolla ei ole yhtään non-orphan-lähdettä sources-taulussa.
	orphanCount, deOrphaned := system_table_tools.MarkOrphanLangKeys()
	log.Printf("[STARTUP] Orphan lang keys: %d orphans, %d de-orphaned", orphanCount, deOrphaned)
	log.Println("[STARTUP] Optional maintenance completed.")
}

func resolveProjectRoot(exeDir string) string {
	candidate := exeDir
	if _, err := os.Stat(filepath.Join(candidate, "VERSION_EASELECT")); err == nil {
		return candidate
	}

	cwd, err := os.Getwd()
	if err == nil {
		return cwd
	}
	return candidate
}
