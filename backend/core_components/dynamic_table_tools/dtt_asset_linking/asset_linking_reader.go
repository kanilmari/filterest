// asset_linking_reader.go
// Reads asset-linking relation metadata from the database.
// Bridges system_db_tables and system_foreign_key_relations_1_m with typed file-upload relation status rows.
// Exists to keep shared relation metadata access centralized for the final asset-linking handlers.
package dtt_asset_linking

import (
	"database/sql"
	"errors"
	"fmt"

	"easelect/backend/core_components/dbutils"
)

var ErrFileUploadProfileNotFound = errors.New("file_upload profile not found")
var ErrFileUploadRelationNotFound = errors.New("file_upload relation not found")

// LookupParentTableUID finds the public table UID for one parent table name.
func LookupParentTableUID(q dbutils.Querier, parentTable string) (int, error) {
	var parentTableUID int
	err := q.QueryRow(
		"SELECT table_uid FROM system_db_tables WHERE table_name = $1 AND schema_name = 'public'",
		parentTable,
	).Scan(&parentTableUID)
	if err != nil {
		return 0, err
	}
	return parentTableUID, nil
}

// ListFileUploadRelationStatuses returns typed status rows for file_upload-enabled FK relations.
func ListFileUploadRelationStatuses(q dbutils.Querier, parentTable string) ([]FileUploadRelationStatus, error) {
	query := `
		SELECT
			fk.id,
			src.table_name AS child_table,
			tgt.table_name AS parent_table,
			fk.source_column_name,
			fk.target_insert_specs
		FROM system_foreign_key_relations_1_m fk
		JOIN system_db_tables src ON src.table_uid = fk.source_table_uid
		JOIN system_db_tables tgt ON tgt.table_uid = fk.target_table_uid
		WHERE fk.target_insert_specs->'file_upload' IS NOT NULL`

	args := []interface{}{}
	if parentTable != "" {
		query += " AND tgt.table_name = $1"
		args = append(args, parentTable)
	}
	query += " ORDER BY tgt.table_name"

	rows, err := q.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("query failed: %w", err)
	}
	defer rows.Close()

	statuses := make([]FileUploadRelationStatus, 0)
	for rows.Next() {
		var relationID int
		var childTable, resolvedParentTable, foreignKeyColumn string
		var specsJSON []byte
		if err := rows.Scan(&relationID, &childTable, &resolvedParentTable, &foreignKeyColumn, &specsJSON); err != nil {
			return nil, fmt.Errorf("scan failed: %w", err)
		}

		uploadConfig, err := ParseFileUploadConfig(specsJSON)
		if err != nil {
			continue
		}

		statuses = append(statuses, FileUploadRelationStatus{
			RelationID:       relationID,
			ParentTable:      resolvedParentTable,
			ChildTable:       childTable,
			ForeignKeyColumn: foreignKeyColumn,
			StorageDriver:    StorageDriverLocalFilesystem,
			UploadConfig:     uploadConfig,
		})
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("row iteration failed: %w", err)
	}

	return statuses, nil
}

// FindFileUploadRelationStatusByProfile returns one relation row for the requested profile on a parent table.
func FindFileUploadRelationStatusByProfile(q dbutils.Querier, parentTableUID int, profileKey string) (FileUploadRelationStatus, error) {
	rows, err := q.Query(
		`
		SELECT
			fk.id,
			src.table_name AS child_table,
			tgt.table_name AS parent_table,
			fk.source_column_name,
			fk.target_insert_specs
		FROM system_foreign_key_relations_1_m fk
		JOIN system_db_tables src ON src.table_uid = fk.source_table_uid
		JOIN system_db_tables tgt ON tgt.table_uid = fk.target_table_uid
		WHERE fk.target_table_uid = $1
		  AND fk.target_insert_specs->'file_upload' IS NOT NULL
		ORDER BY src.table_name
		`,
		parentTableUID,
	)
	if err != nil {
		return FileUploadRelationStatus{}, fmt.Errorf("query failed: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var relationID int
		var childTable, parentTable, foreignKeyColumn string
		var specsJSON []byte
		if err := rows.Scan(&relationID, &childTable, &parentTable, &foreignKeyColumn, &specsJSON); err != nil {
			return FileUploadRelationStatus{}, fmt.Errorf("scan failed: %w", err)
		}

		uploadConfig, err := ParseFileUploadConfig(specsJSON)
		if err != nil {
			continue
		}

		status := FileUploadRelationStatus{
			RelationID:       relationID,
			ParentTable:      parentTable,
			ChildTable:       childTable,
			ForeignKeyColumn: foreignKeyColumn,
			StorageDriver:    StorageDriverLocalFilesystem,
			UploadConfig:     uploadConfig,
		}
		if statusSupportsProfile(status, profileKey) {
			return status, nil
		}
	}

	if err := rows.Err(); err != nil {
		return FileUploadRelationStatus{}, fmt.Errorf("row iteration failed: %w", err)
	}

	return FileUploadRelationStatus{}, ErrFileUploadProfileNotFound
}

// FindFileUploadRelationStatusByChildTable returns one relation row even when target_insert_specs is still empty.
func FindFileUploadRelationStatusByChildTable(q dbutils.Querier, parentTableUID int, childTable string) (FileUploadRelationStatus, error) {
	var (
		relationID       int
		parentTable      string
		foreignKeyColumn string
		rawSpecsSQL      sql.NullString
	)

	err := q.QueryRow(
		`
		SELECT
			fk.id,
			tgt.table_name AS parent_table,
			fk.source_column_name,
			fk.target_insert_specs::text
		FROM system_foreign_key_relations_1_m fk
		JOIN system_db_tables src ON src.table_uid = fk.source_table_uid
		JOIN system_db_tables tgt ON tgt.table_uid = fk.target_table_uid
		WHERE fk.target_table_uid = $1
		  AND src.table_name = $2
		LIMIT 1
		`,
		parentTableUID,
		childTable,
	).Scan(&relationID, &parentTable, &foreignKeyColumn, &rawSpecsSQL)
	if err != nil {
		return FileUploadRelationStatus{}, ErrFileUploadRelationNotFound
	}

	uploadConfig := NormalizeFileUploadConfig(FileUploadConfig{})
	if rawSpecsSQL.Valid && rawSpecsSQL.String != "" {
		parsedConfig, parseErr := ParseFileUploadConfig([]byte(rawSpecsSQL.String))
		if parseErr == nil {
			uploadConfig = parsedConfig
		}
	}

	return FileUploadRelationStatus{
		RelationID:       relationID,
		ParentTable:      parentTable,
		ChildTable:       childTable,
		ForeignKeyColumn: foreignKeyColumn,
		StorageDriver:    StorageDriverLocalFilesystem,
		UploadConfig:     uploadConfig,
	}, nil
}
