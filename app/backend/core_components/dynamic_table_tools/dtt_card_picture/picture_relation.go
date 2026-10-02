// picture_relation.go
// Finds a row's gallery: the one child relation whose pictures can become the row's card picture.
// Between system_foreign_key_relations_1_m file-upload metadata, the child tables' columns and
// every reader and writer of the card picture.
// Exists so the card, the article's gallery, the writers and the missing-media check all mean
// the same relation; when two places chose separately, a card could show a picture that the
// gallery did not list. Moved here from the row-read package (card_support_enrichment.go and
// related_media_relation_metadata.go) because the asset-linking writers cannot import that package.
package dtt_card_picture

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"easelect/backend/core_components/dbutils"
)

const sharedAssetProfileKey = "asset_linking"

// RelationStatus is one file-upload relation of a parent as its metadata states it.
type RelationStatus struct {
	ParentTable      string
	ChildTable       string
	ForeignKeyColumn string
	UploadConfig     UploadConfig
}

type targetInsertSpecsEnvelope struct {
	FileUpload *UploadConfig `json:"file_upload"`
}

// UploadConfig is the part of a relation's file_upload metadata that decides what the
// relation holds. The asset-linking package parses the full shape for its own editors.
type UploadConfig struct {
	ProfileKey      string                       `json:"profile_key,omitempty"`
	AssetKinds      []string                     `json:"asset_kinds,omitempty"`
	TargetDirectory string                       `json:"target_directory,omitempty"`
	FilenameColumn  string                       `json:"filename_column,omitempty"`
	CacheTargets    []CacheTarget                `json:"cache_targets,omitempty"`
	Profiles        map[string]ProfileUploadSpec `json:"profiles,omitempty"`
}

// ProfileUploadSpec is one capability (image, attachment) of a shared-asset relation.
type ProfileUploadSpec struct {
	AssetKinds      []string      `json:"asset_kinds,omitempty"`
	TargetDirectory string        `json:"target_directory,omitempty"`
	CacheTargets    []CacheTarget `json:"cache_targets,omitempty"`
}

// CacheTarget names a column an upload of the relation writes.
type CacheTarget struct {
	Column string `json:"column,omitempty"`
}

// ListRelationStatuses returns the file-upload relations of parentTable, or of every
// parent when parentTable is empty, in a stable order.
func ListRelationStatuses(querier dbutils.Querier, parentTable string) ([]RelationStatus, error) {
	if querier == nil {
		return nil, nil
	}

	query := `
		SELECT
			src.table_name AS child_table,
			tgt.table_name AS parent_table,
			fk.source_column_name,
			fk.target_insert_specs
		FROM system_foreign_key_relations_1_m fk
		JOIN system_db_tables src ON src.table_uid = fk.source_table_uid
		JOIN system_db_tables tgt ON tgt.table_uid = fk.target_table_uid
		WHERE fk.target_insert_specs->'file_upload' IS NOT NULL`

	args := []interface{}{}
	if strings.TrimSpace(parentTable) != "" {
		query += " AND tgt.table_name = $1"
		args = append(args, parentTable)
	}
	query += " ORDER BY tgt.table_name, src.table_name, fk.id"

	rows, err := querier.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("query related media relation statuses: %w", err)
	}
	defer rows.Close()

	statuses := make([]RelationStatus, 0)
	for rows.Next() {
		var status RelationStatus
		var specsJSON []byte
		if scanErr := rows.Scan(&status.ChildTable, &status.ParentTable, &status.ForeignKeyColumn, &specsJSON); scanErr != nil {
			return nil, fmt.Errorf("scan related media relation status: %w", scanErr)
		}

		uploadConfig, ok := ParseUploadConfig(specsJSON)
		if !ok {
			continue
		}
		status.UploadConfig = uploadConfig
		statuses = append(statuses, status)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate related media relation statuses: %w", err)
	}

	return statuses, nil
}

// ParseUploadConfig reads the file_upload part of a relation's target_insert_specs.
func ParseUploadConfig(specsJSON []byte) (UploadConfig, bool) {
	var envelope targetInsertSpecsEnvelope
	if err := json.Unmarshal(specsJSON, &envelope); err != nil || envelope.FileUpload == nil {
		return UploadConfig{}, false
	}

	config := *envelope.FileUpload
	if config.AssetKinds == nil {
		config.AssetKinds = []string{}
	}
	if config.CacheTargets == nil {
		config.CacheTargets = []CacheTarget{}
	}
	if config.Profiles == nil {
		config.Profiles = map[string]ProfileUploadSpec{}
	} else {
		normalizedProfiles := make(map[string]ProfileUploadSpec, len(config.Profiles))
		for profileKey, profileConfig := range config.Profiles {
			if profileConfig.AssetKinds == nil {
				profileConfig.AssetKinds = []string{}
			}
			if profileConfig.CacheTargets == nil {
				profileConfig.CacheTargets = []CacheTarget{}
			}
			normalizedProfiles[profileKey] = profileConfig
		}
		config.Profiles = normalizedProfiles
	}

	return config, true
}

// UsesSharedAsset reports whether the relation uses the shared `<parent>_assets` model.
func (config UploadConfig) UsesSharedAsset() bool {
	return len(config.Profiles) > 0 || strings.TrimSpace(config.ProfileKey) == sharedAssetProfileKey
}

// SupportsImage reports whether the relation can hold pictures. A relation that holds
// only attachments never feeds a card picture.
func (config UploadConfig) SupportsImage() bool {
	if _, ok := config.Profiles["image"]; ok {
		return true
	}

	if strings.EqualFold(strings.TrimSpace(config.ProfileKey), "image") {
		return true
	}
	for _, assetKind := range config.AssetKinds {
		if strings.EqualFold(strings.TrimSpace(assetKind), "image") {
			return true
		}
	}
	if strings.EqualFold(strings.TrimSpace(config.TargetDirectory), "media") {
		return true
	}
	for _, cacheTarget := range config.CacheTargets {
		if strings.EqualFold(strings.TrimSpace(cacheTarget.Column), "cached_image") {
			return true
		}
	}
	return false
}

// PictureRelation is a parent's gallery and the columns its table has.
type PictureRelation struct {
	ChildTable     string
	ForeignKey     string
	FilenameColumn string
	// Shared is true for a shared-asset relation, whose table can keep a card-only
	// picture as a gallery row; an older single-purpose relation cannot.
	Shared  bool
	Columns GalleryColumns
	// HasAssetKind says whether rows are filtered to pictures by asset_kind; without
	// the column every row with a stored name is a picture.
	HasAssetKind    bool
	HasTypeID       bool
	HasMetadataJSON bool
	HasTitle        bool
	HasOriginalName bool
}

// PictureRelationOf returns the parent's gallery, or nil when it has none:
//
//  1. the first shared-asset relation that can hold pictures;
//  2. otherwise a child table found through the parent's foreign-key relations that has
//     the asset columns (asset_kind and a stored name), `<parent>_assets` first; tables of
//     the parent's upload relations are not candidates here, so a shared relation that
//     holds only attachments is never mistaken for a gallery;
//  3. otherwise the first older single-purpose upload relation that can hold pictures.
//
// The older relation comes last on purpose: a canonical gallery wins wherever one exists,
// and an attachments-only shared relation does not hide an older picture relation.
func PictureRelationOf(querier dbutils.Querier, parentTable string) (*PictureRelation, error) {
	if querier == nil {
		return nil, nil
	}

	statuses, err := ListRelationStatuses(querier, parentTable)
	if err != nil {
		return nil, err
	}
	excludedTables := make(map[string]bool, len(statuses))
	legacyImageStatuses := make([]RelationStatus, 0)
	for _, status := range statuses {
		trimmedChildTable := strings.TrimSpace(status.ChildTable)
		if trimmedChildTable != "" {
			excludedTables[trimmedChildTable] = true
		}
		if !status.UploadConfig.UsesSharedAsset() {
			if status.UploadConfig.SupportsImage() {
				legacyImageStatuses = append(legacyImageStatuses, status)
			}
			continue
		}
		if !status.UploadConfig.SupportsImage() {
			continue
		}
		relation, relationErr := pictureRelationFromCandidate(querier, parentTable, relationCandidate{
			childTable:     status.ChildTable,
			foreignKeyName: status.ForeignKeyColumn,
			filenameColumn: status.UploadConfig.FilenameColumn,
		}, true)
		if relationErr != nil {
			return nil, relationErr
		}
		if relation != nil {
			relation.Shared = true
			return relation, nil
		}
	}

	candidates, err := discoverRelationCandidates(querier, parentTable)
	if err != nil {
		return nil, err
	}
	for _, candidate := range candidates {
		if excludedTables[strings.TrimSpace(candidate.childTable)] {
			continue
		}
		relation, relationErr := pictureRelationFromCandidate(querier, parentTable, candidate, true)
		if relationErr != nil {
			return nil, relationErr
		}
		if relation != nil {
			return relation, nil
		}
	}

	for _, status := range legacyImageStatuses {
		relation, relationErr := pictureRelationFromCandidate(querier, parentTable, relationCandidate{
			childTable:     status.ChildTable,
			foreignKeyName: status.ForeignKeyColumn,
			filenameColumn: status.UploadConfig.FilenameColumn,
		}, false)
		if relationErr != nil {
			return nil, relationErr
		}
		if relation != nil {
			return relation, nil
		}
	}
	return nil, nil
}

// GalleryOf returns the parent whose gallery childTable is, with that gallery, or empty
// values when childTable is no parent's gallery. Writers that change rows of a child
// table use it to find the one card picture the change can affect.
func GalleryOf(querier dbutils.Querier, childTable string) (string, *PictureRelation, error) {
	if querier == nil || strings.TrimSpace(childTable) == "" {
		return "", nil, nil
	}
	rows, err := querier.Query(
		`SELECT DISTINCT tgt.table_name
		   FROM system_foreign_key_relations_1_m fk
		   JOIN system_db_tables src ON src.table_uid = fk.source_table_uid
		   JOIN system_db_tables tgt ON tgt.table_uid = fk.target_table_uid
		  WHERE src.table_name = $1
		  ORDER BY tgt.table_name`,
		childTable,
	)
	if err != nil {
		return "", nil, err
	}
	parents := make([]string, 0, 1)
	for rows.Next() {
		var parent string
		if scanErr := rows.Scan(&parent); scanErr != nil {
			rows.Close()
			return "", nil, scanErr
		}
		parents = append(parents, parent)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return "", nil, err
	}
	for _, parent := range parents {
		relation, relationErr := PictureRelationOf(querier, parent)
		if relationErr != nil {
			return "", nil, relationErr
		}
		if relation != nil && relation.ChildTable == childTable {
			return parent, relation, nil
		}
	}
	return "", nil, nil
}

type relationCandidate struct {
	childTable     string
	foreignKeyName string
	filenameColumn string
}

type tableColumn struct {
	name     string
	dataType string
}

// pictureRelationFromCandidate reads the candidate table's columns. requireAssetKind is
// true for canonical galleries, which name each row's kind; an older single-purpose
// table holds only pictures and may lack the column.
func pictureRelationFromCandidate(
	querier dbutils.Querier,
	parentTable string,
	candidate relationCandidate,
	requireAssetKind bool,
) (*PictureRelation, error) {
	childTable := strings.TrimSpace(candidate.childTable)
	if childTable == "" {
		return nil, nil
	}

	exists, err := publicTableExists(querier, childTable)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, nil
	}

	columns, err := publicTableColumns(querier, childTable)
	if err != nil {
		return nil, err
	}
	if requireAssetKind && !hasColumn(columns, "asset_kind") {
		return nil, nil
	}

	filenameColumn := strings.TrimSpace(candidate.filenameColumn)
	if filenameColumn == "" || !hasColumn(columns, filenameColumn) {
		var ok bool
		filenameColumn, ok = resolveFilenameColumn(columns)
		if !ok {
			return nil, nil
		}
	}

	foreignKeyName := strings.TrimSpace(candidate.foreignKeyName)
	if foreignKeyName == "" || !hasColumn(columns, foreignKeyName) {
		var ok bool
		foreignKeyName, ok = resolveForeignKeyColumn(parentTable, columns)
		if !ok {
			return nil, nil
		}
	}

	return &PictureRelation{
		ChildTable:     childTable,
		ForeignKey:     foreignKeyName,
		FilenameColumn: filenameColumn,
		Columns: GalleryColumns{
			IsPrimary: hasColumn(columns, "is_primary"),
			SortOrder: hasColumn(columns, "sort_order"),
			Created:   hasColumn(columns, "created"),
			ID:        hasColumn(columns, "id"),
		},
		HasAssetKind:    hasColumn(columns, "asset_kind"),
		HasTypeID:       hasColumn(columns, "type_id"),
		HasMetadataJSON: hasColumn(columns, "metadata_json"),
		HasTitle:        hasColumn(columns, "title"),
		HasOriginalName: hasColumn(columns, "original_name"),
	}, nil
}

func discoverRelationCandidates(querier dbutils.Querier, parentTable string) ([]relationCandidate, error) {
	rows, err := querier.Query(
		`SELECT src.table_name, fk.source_column_name
		   FROM system_foreign_key_relations_1_m fk
		   JOIN system_db_tables src ON src.table_uid = fk.source_table_uid
		   JOIN system_db_tables tgt ON tgt.table_uid = fk.target_table_uid
		  WHERE tgt.table_name = $1
		  ORDER BY src.table_name`,
		parentTable,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	candidates := make([]relationCandidate, 0, 2)
	for rows.Next() {
		var childTable string
		var foreignKeyName string
		if scanErr := rows.Scan(&childTable, &foreignKeyName); scanErr != nil {
			return nil, scanErr
		}
		childTable = strings.TrimSpace(childTable)
		if childTable == "" {
			continue
		}
		candidates = append(candidates, relationCandidate{
			childTable:     childTable,
			foreignKeyName: strings.TrimSpace(foreignKeyName),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	sort.SliceStable(candidates, func(leftIdx, rightIdx int) bool {
		return scoreRelationCandidate(parentTable, candidates[leftIdx].childTable) <
			scoreRelationCandidate(parentTable, candidates[rightIdx].childTable)
	})

	if len(candidates) == 0 && strings.TrimSpace(parentTable) != "" {
		candidates = append(candidates, relationCandidate{
			childTable: strings.TrimSpace(parentTable) + "_assets",
		})
	}

	return candidates, nil
}

func resolveFilenameColumn(columns []tableColumn) (string, bool) {
	for _, candidate := range []string{"filename", "stored_filename", "original_name"} {
		if hasColumn(columns, candidate) {
			return candidate, true
		}
	}
	return "", false
}

func resolveForeignKeyColumn(parentTable string, columns []tableColumn) (string, bool) {
	preferred := []string{
		parentTable + "_id",
		legacyForeignKeyNameFromTable(parentTable),
	}
	for _, candidate := range preferred {
		if candidate != "" && hasColumn(columns, candidate) {
			return candidate, true
		}
	}

	idColumns := make([]string, 0)
	for _, column := range columns {
		if column.name == "id" || !strings.HasSuffix(column.name, "_id") {
			continue
		}
		idColumns = append(idColumns, column.name)
	}
	if len(idColumns) == 1 {
		return idColumns[0], true
	}

	return "", false
}

func publicTableExists(querier dbutils.Querier, tableName string) (bool, error) {
	var exists bool
	err := querier.QueryRow(
		`SELECT EXISTS (
			SELECT 1
			  FROM information_schema.tables
			 WHERE table_schema = 'public'
			   AND table_name = $1
		)`,
		tableName,
	).Scan(&exists)
	return exists, err
}

func publicTableColumns(querier dbutils.Querier, tableName string) ([]tableColumn, error) {
	rows, err := querier.Query(
		`SELECT column_name, data_type
		   FROM information_schema.columns
		  WHERE table_schema = 'public'
		    AND table_name = $1
		  ORDER BY ordinal_position`,
		tableName,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	columns := make([]tableColumn, 0)
	for rows.Next() {
		var column tableColumn
		if scanErr := rows.Scan(&column.name, &column.dataType); scanErr != nil {
			return nil, scanErr
		}
		columns = append(columns, column)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return columns, nil
}

func scoreRelationCandidate(parentTable string, childTable string) int {
	trimmedChildTable := strings.TrimSpace(childTable)
	trimmedParentTable := strings.TrimSpace(parentTable)
	switch {
	case trimmedParentTable != "" && trimmedChildTable == trimmedParentTable+"_assets":
		return 0
	case strings.HasSuffix(trimmedChildTable, "_assets"):
		return 1
	default:
		return 2
	}
}

func legacyForeignKeyNameFromTable(tableName string) string {
	tableName = strings.TrimSpace(strings.Trim(tableName, "_"))
	if tableName == "" {
		return ""
	}

	parts := strings.Split(tableName, "_")
	lastToken := singularizeTableToken(parts[len(parts)-1])
	if lastToken == "" {
		return ""
	}

	return lastToken + "_id"
}

func singularizeTableToken(token string) string {
	token = strings.TrimSpace(strings.ToLower(token))
	switch {
	case strings.HasSuffix(token, "ies") && len(token) > 3:
		return token[:len(token)-3] + "y"
	case strings.HasSuffix(token, "s") && !strings.HasSuffix(token, "ss") && len(token) > 1:
		return token[:len(token)-1]
	default:
		return token
	}
}

func hasColumn(columns []tableColumn, columnName string) bool {
	for _, column := range columns {
		if column.name == columnName {
			return true
		}
	}
	return false
}
