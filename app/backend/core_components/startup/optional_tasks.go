// optional_tasks.go
// Runs optional background tasks during server startup. Executes non-critical initialization
// steps such as cache warming and consistency checks that do not block startup.
// Exists to separate best-effort maintenance from the critical server boot path.
package startup

import (
	"log"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dynamic_table_tools/ai_features"
	dtt_system_table_folders "easelect/backend/core_components/dynamic_table_tools/dtt_table_folders"
	"easelect/backend/core_components/system_table_tools"
)

// RunOptionalTasks executes optional startup tasks.
func RunOptionalTasks(projectRoot string, appDBCompatibilityManifest ...string) {
	manifestPath := ""
	if len(appDBCompatibilityManifest) > 0 {
		manifestPath = appDBCompatibilityManifest[0]
	}

	// Heal an inconsistent bootstrap (anonymous browsing on, but guest has no
	// dataset-read rights) before serving requests, so a fresh machine does not
	// 403-storm on its first page load.
	EnsureAnonymousBrowseConsistency(backend.Db)

	system_table_tools.StartAutomaticDataRetentionLoop(backend.Db)
	go runDeferredStartupMaintenance(projectRoot, manifestPath)
}

func runDeferredStartupMaintenance(projectRoot string, appDBCompatibilityManifest string) {
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

	if mirroredRows, err := SyncAppDBCompatibilityMirror(backend.Db, projectRoot, appDBCompatibilityManifest); err != nil {
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
	ai_features.StartEmbeddingRefreshWorker(backend.Db)
	// Populoi lähdetiedot: skannaa koodipohja (JS/HTML/Go), skeema (sarakkeet/taulut)
	// ja tietokantapohjaiset avaimet (views, groups) system_lang_key_sources-tauluun.
	// Tämä pitää ajaa ENNEN MarkOrphanLangKeys():ta, koska orphan-tunnistus
	// perustuu nyt sources-taulun sisältöön (ei itsenäiseen skannaukseen).
	sourceCount, sourceErr := system_table_tools.PopulateLangKeySources()
	if sourceErr != nil {
		log.Printf("\033[31merror: [STARTUP] language-key source scan failed; orphan maintenance skipped: %v\033[0m", sourceErr)
	} else {
		log.Printf("[STARTUP] Lang key sources: %d source(s) saved", sourceCount)

		// Merkitään orpoavaimet system_lang_key_sources-tauluun (source_type='orphan').
		// Orpo = avain jolla ei ole yhtään non-orphan-lähdettä sources-taulussa.
		orphanCount, deOrphaned := system_table_tools.MarkOrphanLangKeys()
		log.Printf("[STARTUP] Orphan lang keys: %d orphans, %d de-orphaned", orphanCount, deOrphaned)
	}
	log.Println("[STARTUP] Optional maintenance completed.")
}
