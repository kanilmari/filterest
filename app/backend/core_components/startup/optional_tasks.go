// optional_tasks.go
// Runs optional background tasks during server startup. Executes non-critical initialization
// steps such as cache warming and consistency checks that do not block startup.
// Exists to separate best-effort maintenance from the critical server boot path.
package startup

import (
	"context"
	"log"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dynamic_table_tools/ai_features"
	dtt_1_row_create "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_create"
	dtt_system_table_folders "easelect/backend/core_components/dynamic_table_tools/dtt_table_folders"
	dtt_search_vectors "easelect/backend/core_components/dynamic_table_tools/search_vectors"
	missing_media_check "easelect/backend/core_components/missing_media_check"
	"easelect/backend/core_components/runtimepaths"
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

	repairUpscaledDisplayVariants(runtimepaths.Current().StorageRoot)
	refreshFunctionSearchVectors()

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
	EnsureMissingMediaCheckLangKeys(backend.Db)
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
	// The missing-media-files check reads storage, so it starts only after the
	// rest of startup maintenance is done, and it never blocks the server.
	missing_media_check.StartStartupRun()

	log.Println("[STARTUP] Optional maintenance completed.")
}

// refreshFunctionSearchVectors keeps the route registry findable by text search.
// Startup registration writes those rows directly, so without this they carry no
// vector at all, or one written by an older release's word splitting.
func refreshFunctionSearchVectors() {
	updated, err := dtt_search_vectors.RefreshTableRowVectors(context.Background(), backend.Db, "system_functions")
	if err != nil {
		log.Printf("\033[31merror: [STARTUP] function search vectors could not be refreshed: %v\033[0m", err)
		return
	}
	if updated > 0 {
		log.Printf("[STARTUP] Search index: refreshed %d function search vectors", updated)
	}
}

// repairUpscaledDisplayVariants replaces display variants that earlier releases
// enlarged beyond their original or encoded heavier than it, so sized catalog
// slots stop serving more bytes than the original.
func repairUpscaledDisplayVariants(storageRoot string) {
	result, err := dtt_1_row_create.RepairUpscaledDisplayVariants(storageRoot)
	if err != nil {
		log.Printf("\033[31merror: [STARTUP] media display variant repair failed: %v\033[0m", err)
		return
	}
	if result.ReplacedVariants > 0 || result.FailedVariants > 0 {
		log.Printf(
			"[STARTUP] Media display variants: replaced %d oversized of %d checked (%d failed)",
			result.ReplacedVariants, result.CheckedVariants, result.FailedVariants,
		)
	}
}
