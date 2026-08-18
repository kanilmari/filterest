// managed_asset_child_cleanup.go
// Removes Filterest-managed shared asset child tables with their parent dataset.
// Bridges canonical file-upload relation metadata and the ordinary table-delete workflow.
// Exists so deleting a dataset cannot leave its generated <dataset>_assets table behind.
package dtt_3_table_delete

import (
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	"easelect/backend/core_components/security"
	"fmt"
)

type managedAssetChildTable struct {
	tableName  string
	tableUID   int64
	schemaName string
}

// findManagedAssetChildTables returns only the canonical child table that is
// both named <parent>_assets and backed by Filterest file-upload metadata.
// Ordinary user-created related tables are intentionally outside this query.
func findManagedAssetChildTables(
	q dbutils.Querier,
	parentTableUID int64,
	parentTableName string,
) ([]managedAssetChildTable, error) {
	rows, err := q.Query(`
		SELECT DISTINCT src.table_name, src.table_uid, src.schema_name
		FROM system_foreign_key_relations_1_m AS fk
		JOIN system_db_tables AS src ON src.table_uid = fk.source_table_uid
		WHERE fk.target_table_uid = $1
		  AND src.schema_name = 'public'
		  AND src.table_name = $2
		  AND fk.target_insert_specs->'file_upload' IS NOT NULL
	`, parentTableUID, parentTableName+"_assets")
	if err != nil {
		return nil, fmt.Errorf("inspect managed asset child table: %w", err)
	}
	defer rows.Close()

	children := make([]managedAssetChildTable, 0, 1)
	for rows.Next() {
		var child managedAssetChildTable
		if err := rows.Scan(&child.tableName, &child.tableUID, &child.schemaName); err != nil {
			return nil, fmt.Errorf("scan managed asset child table: %w", err)
		}
		children = append(children, child)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate managed asset child tables: %w", err)
	}
	return children, nil
}

func dropManagedAssetChildTable(q dbutils.Querier, child managedAssetChildTable) error {
	sanitizedChildName, err := security.SanitizeIdentifier(child.tableName)
	if err != nil {
		return fmt.Errorf("validate managed asset child table name: %w", err)
	}
	if _, err := q.Exec(fmt.Sprintf("DROP TABLE %s CASCADE", sanitizedChildName)); err != nil {
		return fmt.Errorf("drop managed asset child table %s: %w", sanitizedChildName, err)
	}

	dtt_1_row_read.InvalidateSchemaCache(sanitizedChildName)
	dtt_1_row_read.InvalidateDatasetExistsCache(sanitizedChildName)
	if err := CleanupTableMetadata(q, child.tableUID, child.schemaName); err != nil {
		return fmt.Errorf("clean managed asset child metadata %s: %w", sanitizedChildName, err)
	}
	return nil
}
