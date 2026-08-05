// asset_linking_creator.go
// Creates and bootstraps the shared per-parent asset child table and FK metadata row.
// Bridges admin enable handlers, table creation workflow, and canonical <parent>_assets storage.
// Exists to keep the move from table-specific media relations to shared `_assets` relations centralized.
package dtt_asset_linking

import (
	"encoding/json"
	"fmt"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/dynamic_table_tools/dtt_2_column_crud/dtt_2_column_update"
	"easelect/backend/core_components/dynamic_table_tools/dtt_3_table_crud/dtt_3_table_create"
	dtt_crud_workflows "easelect/backend/core_components/dynamic_table_tools/dtt_crud_workflows"
)

// EnsureSharedAssetRelation finds or creates the canonical <parent>_assets relation row.
func EnsureSharedAssetRelation(
	tx dbutils.Querier,
	parentTable string,
	parentTableUID int,
	initialConfig FileUploadConfig,
) (FileUploadRelationStatus, bool, error) {
	childTable := parentTable + "_assets"
	fkColumnName := parentTable + "_id"

	if existingStatus, err := FindFileUploadRelationStatusByChildTable(tx, parentTableUID, childTable); err == nil {
		if existingStatus.UploadConfig.FilenameColumn == "" {
			existingStatus.UploadConfig.FilenameColumn = initialConfig.FilenameColumn
		}
		return existingStatus, true, nil
	}

	var childTableUID int
	err := tx.QueryRow(
		"SELECT table_uid FROM system_db_tables WHERE table_name = $1 AND schema_name = 'public'",
		childTable,
	).Scan(&childTableUID)
	if err != nil {
		columns := map[string]string{
			"id":            "SERIAL",
			fkColumnName:    "INTEGER",
			"asset_kind":    "TEXT",
			"filename":      "TEXT",
			"original_name": "TEXT",
			"mime_type":     "TEXT",
			"size_bytes":    "BIGINT",
			"title":         "TEXT",
			"description":   "TEXT",
			"sort_order":    "INTEGER DEFAULT 0",
			"is_primary":    "BOOLEAN DEFAULT FALSE",
			"metadata_json": "JSONB",
			"created":       "TIMESTAMPTZ DEFAULT NOW()",
			"updated":       "TIMESTAMPTZ DEFAULT NOW()",
		}
		foreignKeys := []dtt_3_table_create.ForeignKeyDefinition{
			{
				ReferencingColumn: fkColumnName,
				ReferencedTable:   parentTable,
				ReferencedColumn:  "id",
			},
		}

		if createErr := dtt_3_table_create.CreateTableInDatabase(tx, childTable, columns, foreignKeys); createErr != nil {
			return FileUploadRelationStatus{}, false, createErr
		}
		if refreshErr := refreshAssetLinkingCatalogMetadata(tx); refreshErr != nil {
			return FileUploadRelationStatus{}, false, refreshErr
		}

		if lookupErr := tx.QueryRow(
			"SELECT table_uid FROM system_db_tables WHERE table_name = $1 AND schema_name = 'public'",
			childTable,
		).Scan(&childTableUID); lookupErr != nil {
			return FileUploadRelationStatus{}, false, lookupErr
		}

		CopyTablePermissions(tx, parentTableUID, childTableUID)
	}

	specsJSON, err := BuildTargetInsertSpecsJSON(initialConfig)
	if err != nil {
		return FileUploadRelationStatus{}, false, err
	}

	referenceDirection := childTable + "->" + parentTable
	if _, err := tx.Exec(
		`INSERT INTO system_foreign_key_relations_1_m
		 (source_table_uid, target_table_uid, source_column_name, target_column_name,
		  reference_direction, insert_new_source_with_target, target_insert_specs)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		childTableUID,
		parentTableUID,
		fkColumnName,
		"id",
		referenceDirection,
		true,
		specsJSON,
	); err != nil {
		return FileUploadRelationStatus{}, false, err
	}
	CopyTablePermissions(tx, parentTableUID, childTableUID)

	status, err := FindFileUploadRelationStatusByChildTable(tx, parentTableUID, childTable)
	if err != nil {
		return FileUploadRelationStatus{}, false, err
	}
	return status, false, nil
}

// EnsureCachedImageColumn keeps the image preview cache available on the parent table.
func EnsureCachedImageColumn(tx dbutils.Querier, parentTable string) error {
	var cachedColumnExists int
	if err := tx.QueryRow(
		`SELECT COUNT(*) FROM information_schema.columns
		 WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'cached_image'`,
		parentTable,
	).Scan(&cachedColumnExists); err != nil {
		return err
	}
	if cachedColumnExists > 0 {
		return nil
	}

	if _, err := tx.Exec(fmt.Sprintf("ALTER TABLE %s ADD COLUMN cached_image TEXT", parentTable)); err != nil {
		return err
	}
	return refreshAssetLinkingCatalogMetadata(tx)
}

// EncodeTargetInsertSpecs is a small helper for tests and handlers needing the raw JSON payload.
func EncodeTargetInsertSpecs(uploadConfig FileUploadConfig) ([]byte, error) {
	return json.Marshal(BuildTargetInsertSpecs(uploadConfig))
}

// refreshAssetLinkingCatalogMetadata keeps table and column metadata aligned after asset-linking schema changes.
func refreshAssetLinkingCatalogMetadata(tx dbutils.Querier) error {
	if err := dtt_crud_workflows.UpdateOidsAndTableNamesWithBridge(tx); err != nil {
		return err
	}
	return dtt_2_column_update.UpdateColumnMetadata(tx)
}
