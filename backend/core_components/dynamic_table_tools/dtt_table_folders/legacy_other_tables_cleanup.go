// legacy_other_tables_cleanup.go
// Reconciles legacy root-level other_tables folders into the canonical database subtree.
// Bridges startup maintenance and the persisted system_table_folders/system_db_tables metadata.
// Exists to retire the old duplicate Other tables lineage without manual shell-side SQL writes.
package dtt_system_table_folders

import (
	"database/sql"
	"fmt"

	"easelect/backend/core_components/dbutils"
)

// LegacyOtherTablesCleanupResult reports what the legacy other_tables reconciliation changed.
// Bridges the startup repair transaction with later logging and verification decisions.
// Exists so callers can tell whether cleanup was a no-op or a real persisted repair.
type LegacyOtherTablesCleanupResult struct {
	CanonicalFolderID          int
	LegacyRootFolderIDs        []int
	ReparentedChildFolderCount int64
	ReassignedTableCount       int64
	DeletedFolderCount         int
}

// ReconcileLegacyOtherTablesFolder repairs the old duplicate other_tables root lineage.
// Bridges startup maintenance with persisted folder/table metadata updates in one transaction.
// Exists so the app can retire the legacy root without requiring manual shell-side SQL writes.
func ReconcileLegacyOtherTablesFolder(db *sql.DB) (LegacyOtherTablesCleanupResult, error) {
	tx, err := db.Begin()
	if err != nil {
		return LegacyOtherTablesCleanupResult{}, fmt.Errorf("failed to begin legacy other_tables cleanup: %w", err)
	}

	result, err := reconcileLegacyOtherTablesFolderWithQuerier(tx)
	if err != nil {
		_ = tx.Rollback()
		return LegacyOtherTablesCleanupResult{}, err
	}

	if err := tx.Commit(); err != nil {
		return LegacyOtherTablesCleanupResult{}, fmt.Errorf("failed to commit legacy other_tables cleanup: %w", err)
	}

	return result, nil
}

func reconcileLegacyOtherTablesFolderWithQuerier(q dbutils.Querier) (LegacyOtherTablesCleanupResult, error) {
	legacyRootFolderIDs, err := findLegacyOtherTablesRootFolderIDs(q)
	if err != nil {
		return LegacyOtherTablesCleanupResult{}, err
	}
	if len(legacyRootFolderIDs) == 0 {
		return LegacyOtherTablesCleanupResult{}, nil
	}

	canonicalFolderID, err := EnsureDatabaseOtherTablesFolder(q)
	if err != nil {
		return LegacyOtherTablesCleanupResult{}, fmt.Errorf("failed to resolve canonical other_tables folder: %w", err)
	}

	result := LegacyOtherTablesCleanupResult{
		CanonicalFolderID:   canonicalFolderID,
		LegacyRootFolderIDs: append([]int(nil), legacyRootFolderIDs...),
	}

	for _, legacyRootFolderID := range legacyRootFolderIDs {
		if legacyRootFolderID == canonicalFolderID {
			continue
		}

		reparentedChildren, err := execRowsAffected(q, `
			UPDATE system_table_folders
			SET parent_id = $1,
			    updated = NOW()
			WHERE parent_id = $2
		`, canonicalFolderID, legacyRootFolderID)
		if err != nil {
			return LegacyOtherTablesCleanupResult{}, fmt.Errorf("failed to reparent legacy other_tables child folders from %d to %d: %w", legacyRootFolderID, canonicalFolderID, err)
		}
		result.ReparentedChildFolderCount += reparentedChildren

		reassignedTables, err := execRowsAffected(q, `
			UPDATE system_db_tables
			SET folder_id = $1
			WHERE folder_id = $2
		`, canonicalFolderID, legacyRootFolderID)
		if err != nil {
			return LegacyOtherTablesCleanupResult{}, fmt.Errorf("failed to move legacy other_tables tables from %d to %d: %w", legacyRootFolderID, canonicalFolderID, err)
		}
		result.ReassignedTableCount += reassignedTables

		// Folder lang-key sources are name-based, so the canonical other_tables folder
		// still needs those records after the legacy root is removed.
		deletedFolders, err := execRowsAffected(q, `DELETE FROM system_table_folders WHERE id = $1`, legacyRootFolderID)
		if err != nil {
			return LegacyOtherTablesCleanupResult{}, fmt.Errorf("failed to delete legacy other_tables folder %d: %w", legacyRootFolderID, err)
		}
		if deletedFolders != 1 {
			return LegacyOtherTablesCleanupResult{}, fmt.Errorf("expected to delete legacy other_tables folder %d exactly once, deleted %d row(s)", legacyRootFolderID, deletedFolders)
		}
		result.DeletedFolderCount += int(deletedFolders)
	}

	return result, nil
}

// findLegacyOtherTablesRootFolderIDs finds root-level legacy other_tables folders.
// Bridges the folder catalog query with the startup reconciliation loop.
// Exists so cleanup can skip work entirely when no duplicate legacy root remains.
func findLegacyOtherTablesRootFolderIDs(q dbutils.Querier) ([]int, error) {
	rows, err := q.Query(`
		SELECT id
		FROM system_table_folders
		WHERE parent_id IS NULL
		  AND folder_name = $1
		ORDER BY id
	`, OtherTablesFolderName)
	if err != nil {
		return nil, fmt.Errorf("failed to look up legacy other_tables root folders: %w", err)
	}
	defer rows.Close()

	var folderIDs []int
	for rows.Next() {
		var folderID int
		if err := rows.Scan(&folderID); err != nil {
			return nil, fmt.Errorf("failed to scan legacy other_tables root folder id: %w", err)
		}
		folderIDs = append(folderIDs, folderID)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to read legacy other_tables root folders: %w", err)
	}

	return folderIDs, nil
}

func execRowsAffected(q dbutils.Querier, query string, args ...interface{}) (int64, error) {
	result, err := q.Exec(query, args...)
	if err != nil {
		return 0, err
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return 0, err
	}
	return rowsAffected, nil
}
