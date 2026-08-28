// cleanup_lang_key_sources.go
// Maintains lang key sources and usage_explanation on table/column drop or rename.
// Between DDL mutation handlers and system_lang_key_sources/system_lang_keys tables.
// Exists to keep translation metadata consistent when schema objects change.
//
// DROP algorithm:
//  1. Delete matching rows from system_lang_key_sources.
//  2. If no other sources remain for a lang_key_id, delete from system_lang_keys.
//  3. If other sources exist, keep the key — only the source row is removed.
//
// RENAME algorithm:
//  1. Update source_high/source_low to reflect the new name.
//  2. Update usage_explanation on affected source records.
package lang

import (
	"easelect/backend/core_components/dbutils"
	"fmt"
	"log"
	"strings"
)

type datasetOwnedSourceCleanupRule struct {
	sourceType         string
	exactHighMatch     bool
	legacyHighPrefixes []string
}

var datasetOwnedSourceCleanupRules = []datasetOwnedSourceCleanupRule{
	{sourceType: "table", exactHighMatch: true},
	{sourceType: "column", exactHighMatch: true},
	// New dataset_header rows use source_high=<dataset>, source_low=<field>.
	// Legacy rows used source_high=<dataset>:<field>, so table-drop cleanup must support both.
	{sourceType: "dataset_header", exactHighMatch: true, legacyHighPrefixes: []string{":"}},
	// hasLangKey value sources are tied to one dataset via "dataset.column" ownership.
	{sourceType: "column_value", legacyHighPrefixes: []string{"."}},
}

func buildDatasetOwnedSourceWhereClause(datasetName string) (string, []interface{}) {
	var args []interface{}
	addArg := func(value interface{}) string {
		args = append(args, value)
		return fmt.Sprintf("$%d", len(args))
	}

	var clauses []string
	for _, rule := range datasetOwnedSourceCleanupRules {
		var highMatchers []string
		if rule.exactHighMatch {
			highMatchers = append(highMatchers, fmt.Sprintf("source_high = %s", addArg(datasetName)))
		}
		for _, legacyPrefix := range rule.legacyHighPrefixes {
			highMatchers = append(highMatchers, fmt.Sprintf("source_high LIKE %s", addArg(datasetName+legacyPrefix+"%")))
		}
		if len(highMatchers) == 0 {
			continue
		}

		clauses = append(clauses, fmt.Sprintf(
			"(source_type = '%s' AND (%s))",
			rule.sourceType,
			strings.Join(highMatchers, " OR "),
		))
	}

	return strings.Join(clauses, "\n			  OR "), args
}

func buildDatasetOwnedSourceOrDynamicKeyWhereClause(datasetName string) (string, []interface{}) {
	sourceWhereClause, args := buildDatasetOwnedSourceWhereClause(datasetName)
	dynamicKeyNames := datasetOwnedDynamicLangKeyNames(datasetName)
	if len(dynamicKeyNames) == 0 {
		return sourceWhereClause, args
	}

	keyPlaceholders := make([]string, 0, len(dynamicKeyNames))
	for _, dynamicKeyName := range dynamicKeyNames {
		args = append(args, dynamicKeyName)
		keyPlaceholders = append(keyPlaceholders, fmt.Sprintf("$%d", len(args)))
	}

	dynamicKeyClause := fmt.Sprintf(
		"lang_key_id IN (SELECT id FROM system_lang_keys WHERE lang_key IN (%s))",
		strings.Join(keyPlaceholders, ", "),
	)
	if strings.TrimSpace(sourceWhereClause) == "" {
		return dynamicKeyClause, args
	}
	return "(" + sourceWhereClause + ")\n			  OR " + dynamicKeyClause, args
}

// CleanupLangKeySourcesForTable removes all lang key sources associated with a
// dataset. This includes schema-derived table/column sources plus dataset-owned
// metadata sources such as dataset_header and hasLangKey column_value entries.
// Lang keys that lose their last source are deleted.
func CleanupLangKeySourcesForTable(q dbutils.Querier, tableName string) error {
	return cleanupSources(q, "table-drop", tableName, "")
}

// CleanupLangKeySourcesForColumn removes lang key sources for a specific column
// including hasLangKey column_value entries tied to that column. Lang keys that
// lose their last source are deleted.
func CleanupLangKeySourcesForColumn(q dbutils.Querier, tableName string, columnName string) error {
	return cleanupSources(q, "column-drop", tableName, columnName)
}

// cleanupSources is the shared implementation for both table and column drops.
func cleanupSources(q dbutils.Querier, mode string, tableName string, columnName string) error {

	// 1. Collect the lang_key_ids that will be affected BEFORE we delete.
	var affectedQuery string
	var args []interface{}

	switch mode {
	case "table-drop":
		// All sources owned by this dataset, including legacy dataset_header source_high
		// values and known dynamic dataset keys that may have been saved with generic
		// fallback provenance before schema ownership could be resolved.
		whereClause, datasetArgs := buildDatasetOwnedSourceOrDynamicKeyWhereClause(tableName)
		affectedQuery = `
			SELECT DISTINCT lang_key_id
			FROM system_lang_key_sources
			WHERE ` + whereClause
		args = datasetArgs
	case "column-drop":
		affectedQuery = `
			SELECT DISTINCT lang_key_id
			FROM system_lang_key_sources
			WHERE (source_type = 'column'
			       AND source_high = $1
			       AND source_low = $2)
			   OR (source_type = 'column_value'
			       AND source_high = $3)`
		args = []interface{}{tableName, columnName, fmt.Sprintf("%s.%s", tableName, columnName)}
	case "folder-drop":
		affectedQuery = `
			SELECT DISTINCT lang_key_id
			FROM system_lang_key_sources
			WHERE source_type = 'folder'
			  AND source_high = $1`
		args = []interface{}{tableName}
	default:
		return fmt.Errorf("unknown cleanup mode: %s", mode)
	}

	rows, err := q.Query(affectedQuery, args...)
	if err != nil {
		return fmt.Errorf("failed to query affected lang_key_ids: %w", err)
	}
	defer rows.Close()

	var affectedIDs []int
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			return fmt.Errorf("failed to scan lang_key_id: %w", err)
		}
		affectedIDs = append(affectedIDs, id)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("rows iteration error: %w", err)
	}

	if len(affectedIDs) == 0 {
		log.Printf("[CleanupLangKeySources] %s %s: no matching sources found", mode, tableName)
		return nil
	}

	// 2. Delete the matching source rows.
	var deleteQuery string
	var deleteArgs []interface{}

	switch mode {
	case "table-drop":
		whereClause, datasetArgs := buildDatasetOwnedSourceOrDynamicKeyWhereClause(tableName)
		deleteQuery = `
			DELETE FROM system_lang_key_sources
			WHERE ` + whereClause
		deleteArgs = datasetArgs
	case "column-drop":
		deleteQuery = `
			DELETE FROM system_lang_key_sources
			WHERE (source_type = 'column'
			       AND source_high = $1
			       AND source_low = $2)
			   OR (source_type = 'column_value'
			       AND source_high = $3)`
		deleteArgs = []interface{}{tableName, columnName, fmt.Sprintf("%s.%s", tableName, columnName)}
	case "folder-drop":
		deleteQuery = `
			DELETE FROM system_lang_key_sources
			WHERE source_type = 'folder'
			  AND source_high = $1`
		deleteArgs = []interface{}{tableName}
	}

	res, err := q.Exec(deleteQuery, deleteArgs...)
	if err != nil {
		return fmt.Errorf("failed to delete lang key sources: %w", err)
	}
	if n, _ := res.RowsAffected(); n > 0 {
		log.Printf("[CleanupLangKeySources] %s %s: deleted %d source rows", mode, tableName, n)
	}

	// 3. For each affected key, check if it now has zero sources remaining.
	//    If so, delete the key itself (FK CASCADE cleans up any remaining sources).
	var orphanCount int64
	for _, keyID := range affectedIDs {
		var remaining int
		err := q.QueryRow(`
			SELECT COUNT(*) FROM system_lang_key_sources WHERE lang_key_id = $1
		`, keyID).Scan(&remaining)
		if err != nil {
			log.Printf("[CleanupLangKeySources] warning: could not count remaining sources for key %d: %v", keyID, err)
			continue
		}

		if remaining == 0 {
			_, delErr := q.Exec(`DELETE FROM system_lang_keys WHERE id = $1`, keyID)
			if delErr != nil {
				log.Printf("[CleanupLangKeySources] warning: could not delete orphaned lang key %d: %v", keyID, delErr)
			} else {
				orphanCount++
			}
		}
	}

	if orphanCount > 0 {
		log.Printf("[CleanupLangKeySources] %s %s: deleted %d orphaned lang keys (no remaining sources)", mode, tableName, orphanCount)
	}

	return nil
}

// ─── RENAME operations ────────────────────────────────────────────────

// UpdateLangKeySourcesForTableRename updates all dataset-owned lang key
// sources and usage_explanation that reference the old table name. This
// covers schema sources plus dataset_header and hasLangKey column_value rows.
func UpdateLangKeySourcesForTableRename(q dbutils.Querier, oldName, newName string) error {
	if oldName == newName {
		return nil
	}

	// 1. Update source_high for all sources referencing the old table name.
	//    Covers exact-match dataset ownership, including canonical dataset_header rows.
	res, err := q.Exec(`
		UPDATE system_lang_key_sources
		SET source_high = $2, last_seen = CURRENT_DATE
		WHERE source_high = $1
		  AND source_type IN ('table', 'column', 'dataset_header')
	`, oldName, newName)
	if err != nil {
		return fmt.Errorf("failed to update source_high for table rename %s→%s: %w", oldName, newName, err)
	}
	if n, _ := res.RowsAffected(); n > 0 {
		log.Printf("[UpdateLangKeySourcesForTableRename] updated %d source rows: %s → %s", n, oldName, newName)
	}

	// 2. Update source_low for table-type sources where source_low matches
	//    the old table name (table sources store table name in both fields).
	res, err = q.Exec(`
		UPDATE system_lang_key_sources
		SET source_low = $2
		WHERE source_low = $1
		  AND source_type = 'table'
	`, oldName, newName)
	if err != nil {
		log.Printf("[UpdateLangKeySourcesForTableRename] warning: source_low update: %v", err)
	}

	// 3. Update legacy dataset_header rows that still store "dataset:field" in source_high.
	if _, err := q.Exec(`
		UPDATE system_lang_key_sources
		SET source_high = $2 || SUBSTRING(source_high FROM CHAR_LENGTH($1) + 1),
		    last_seen = CURRENT_DATE
		WHERE source_type = 'dataset_header'
		  AND source_high LIKE $1 || ':%'
	`, oldName, newName); err != nil {
		log.Printf("[UpdateLangKeySourcesForTableRename] warning: dataset_header legacy source_high update: %v", err)
	}

	// 4. Update hasLangKey value sources stored as "dataset.column".
	if _, err := q.Exec(`
		UPDATE system_lang_key_sources
		SET source_high = $2 || SUBSTRING(source_high FROM CHAR_LENGTH($1) + 1),
		    last_seen = CURRENT_DATE
		WHERE source_type = 'column_value'
		  AND source_high LIKE $1 || '.%'
	`, oldName, newName); err != nil {
		log.Printf("[UpdateLangKeySourcesForTableRename] warning: column_value source_high update: %v", err)
	}

	// 5. Update usage_explanation on source records that reference the old table name.
	oldTableExpl := fmt.Sprintf("Table '%s'", oldName)
	newTableExpl := fmt.Sprintf("Table '%s'", newName)
	if _, err := q.Exec(`
		UPDATE system_lang_key_sources
		SET usage_explanation = $2
		WHERE usage_explanation = $1
	`, oldTableExpl, newTableExpl); err != nil {
		log.Printf("[UpdateLangKeySourcesForTableRename] warning: usage_explanation update (table): %v", err)
	}

	oldSuffix := fmt.Sprintf("in table '%s'", oldName)
	newSuffix := fmt.Sprintf("in table '%s'", newName)
	if _, err := q.Exec(`
		UPDATE system_lang_key_sources
		SET usage_explanation = REPLACE(usage_explanation, $1, $2)
		WHERE usage_explanation LIKE '%' || $1
	`, oldSuffix, newSuffix); err != nil {
		log.Printf("[UpdateLangKeySourcesForTableRename] warning: usage_explanation update (column-in-table): %v", err)
	}

	oldColumnPrefix := fmt.Sprintf("column '%s.", oldName)
	newColumnPrefix := fmt.Sprintf("column '%s.", newName)
	if _, err := q.Exec(`
		UPDATE system_lang_key_sources
		SET usage_explanation = REPLACE(usage_explanation, $1, $2)
		WHERE usage_explanation LIKE '%' || $1 || '%'
	`, oldColumnPrefix, newColumnPrefix); err != nil {
		log.Printf("[UpdateLangKeySourcesForTableRename] warning: usage_explanation update (column_value): %v", err)
	}

	return nil
}

// UpdateLangKeySourcesForColumnRename updates lang key sources and
// usage_explanation when a column is renamed within a table. Updates source_low
// from old column name to new column name for matching source records.
func UpdateLangKeySourcesForColumnRename(q dbutils.Querier, tableName, oldColName, newColName string) error {
	if oldColName == newColName {
		return nil
	}

	// 1. Update source_low for column sources in the given table.
	res, err := q.Exec(`
		UPDATE system_lang_key_sources
		SET source_low = $3, last_seen = CURRENT_DATE
		WHERE source_type = 'column'
		  AND source_high = $1
		  AND source_low = $2
	`, tableName, oldColName, newColName)
	if err != nil {
		return fmt.Errorf("failed to update source_low for column rename %s.%s→%s: %w", tableName, oldColName, newColName, err)
	}
	if n, _ := res.RowsAffected(); n > 0 {
		log.Printf("[UpdateLangKeySourcesForColumnRename] updated %d source rows: %s.%s → %s.%s", n, tableName, oldColName, tableName, newColName)
	}

	// 2. Update hasLangKey value sources stored against the specific "table.column".
	oldColumnValueHigh := fmt.Sprintf("%s.%s", tableName, oldColName)
	newColumnValueHigh := fmt.Sprintf("%s.%s", tableName, newColName)
	if _, err := q.Exec(`
		UPDATE system_lang_key_sources
		SET source_high = $2, last_seen = CURRENT_DATE
		WHERE source_type = 'column_value'
		  AND source_high = $1
	`, oldColumnValueHigh, newColumnValueHigh); err != nil {
		log.Printf("[UpdateLangKeySourcesForColumnRename] warning: column_value source_high update: %v", err)
	}

	// 3. Update usage_explanation on source records that reference the old column name.
	oldExpl := fmt.Sprintf("Column '%s' in table '%s'", oldColName, tableName)
	newExpl := fmt.Sprintf("Column '%s' in table '%s'", newColName, tableName)
	if _, err := q.Exec(`
		UPDATE system_lang_key_sources
		SET usage_explanation = $2
		WHERE usage_explanation = $1
	`, oldExpl, newExpl); err != nil {
		log.Printf("[UpdateLangKeySourcesForColumnRename] warning: usage_explanation update: %v", err)
	}

	if _, err := q.Exec(`
		UPDATE system_lang_key_sources
		SET usage_explanation = REPLACE(usage_explanation, $1, $2)
		WHERE usage_explanation LIKE '%' || $1 || '%'
	`, oldColumnValueHigh, newColumnValueHigh); err != nil {
		log.Printf("[UpdateLangKeySourcesForColumnRename] warning: usage_explanation update (column_value): %v", err)
	}

	return nil
}

// ─── FOLDER operations ───────────────────────────────────────────────

// CleanupLangKeySourcesForFolder removes lang key sources for a deleted folder
// (source_type='folder', source_high=folderName). If the lang key has no other
// sources, it is deleted entirely (including its description).
func CleanupLangKeySourcesForFolder(q dbutils.Querier, folderName string) error {
	return cleanupSources(q, "folder-drop", folderName, "")
}

// UpdateLangKeySourcesForFolderRename updates lang key sources and
// usage_explanation when a folder is renamed. Updates source_high from old name to new name.
func UpdateLangKeySourcesForFolderRename(q dbutils.Querier, oldName, newName string) error {
	if oldName == newName {
		return nil
	}

	// 1. Update source_high for folder sources.
	res, err := q.Exec(`
		UPDATE system_lang_key_sources
		SET source_high = $2, last_seen = CURRENT_DATE
		WHERE source_high = $1
		  AND source_type = 'folder'
	`, oldName, newName)
	if err != nil {
		return fmt.Errorf("failed to update source_high for folder rename %s→%s: %w", oldName, newName, err)
	}
	if n, _ := res.RowsAffected(); n > 0 {
		log.Printf("[UpdateLangKeySourcesForFolderRename] updated %d source rows: %s → %s", n, oldName, newName)
	}

	// 2. Update usage_explanation on source records that reference the old folder name.
	oldExpl := fmt.Sprintf("Folder '%s'", oldName)
	newExpl := fmt.Sprintf("Folder '%s'", newName)
	if _, err := q.Exec(`
		UPDATE system_lang_key_sources
		SET usage_explanation = $2
		WHERE usage_explanation = $1
	`, oldExpl, newExpl); err != nil {
		log.Printf("[UpdateLangKeySourcesForFolderRename] warning: usage_explanation update: %v", err)
	}

	return nil
}
