// storage_read_authorization.go
// Authorizes row-scoped storage reads against dataset, row, field, and asset-relation permissions.
// Bridges the /storage handler with the normal read-policy and RLS machinery.
// Exists so knowing a filesystem path never bypasses the database visibility model.
package dtt_1_row_read

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/permissions"

	"github.com/lib/pq"
)

// StorageReadDecision separates expected authorization denials from internal
// failures. Callers must still treat every value except Allowed as fail-closed.
type StorageReadDecision uint8

const (
	StorageReadNotFound StorageReadDecision = iota
	StorageReadAllowed
	StorageReadForbidden
)

// StorageReadRequest is the canonical identity encoded in one protected
// /storage path. Parsing and filesystem containment remain router concerns.
type StorageReadRequest struct {
	TableUID    string
	ParentRowID int64
	Variant     string
	Filename    string
}

type storageRowReadContext struct {
	querier dbutils.Querier
	policy  ReadRowPolicy
}

// storagePermissionQuerier keeps metadata reads on the same request
// transaction when the permission and role handles share one pool. Without
// this adapter, concurrent RLS-pilot storage reads can each hold an admin
// transaction while waiting for a second admin connection, exhausting the
// pool. Different-role pools remain deliberately separate.
type storagePermissionQuerier struct {
	ctx          context.Context
	permissionDB dbutils.Querier
}

func newStoragePermissionQuerier(
	ctx context.Context,
	permissionDB dbutils.Querier,
	roleDB *sql.DB,
) dbutils.Querier {
	permissionPool, ok := permissionDB.(*sql.DB)
	if !ok || permissionPool != roleDB {
		return permissionDB
	}
	return &storagePermissionQuerier{
		ctx:          ctx,
		permissionDB: permissionDB,
	}
}

func (q *storagePermissionQuerier) selected() dbutils.Querier {
	if tx, ok := dbutils.PeekTx(q.ctx); ok {
		return tx
	}
	return q.permissionDB
}

func (q *storagePermissionQuerier) Exec(query string, args ...interface{}) (sql.Result, error) {
	return q.selected().Exec(query, args...)
}

func (q *storagePermissionQuerier) Query(query string, args ...interface{}) (*sql.Rows, error) {
	return q.selected().Query(query, args...)
}

func (q *storagePermissionQuerier) QueryRow(query string, args ...interface{}) *sql.Row {
	return q.selected().QueryRow(query, args...)
}

type storageCacheTarget struct {
	Table  string `json:"table"`
	Column string `json:"column"`
}

type storageFileUploadProfile struct {
	Enabled      bool                 `json:"enabled"`
	CacheTargets []storageCacheTarget `json:"cache_targets,omitempty"`
}

type storageFileUploadConfig struct {
	Enabled        bool                                `json:"enabled"`
	FilenameColumn string                              `json:"filename_column"`
	CacheTargets   []storageCacheTarget                `json:"cache_targets,omitempty"`
	Profiles       map[string]storageFileUploadProfile `json:"profiles,omitempty"`
}

type storageFileUploadEnvelope struct {
	FileUpload *storageFileUploadConfig `json:"file_upload"`
}

type storageFileUploadRelation struct {
	RelationID       int
	ParentTable      string
	ChildTable       string
	ForeignKeyColumn string
	UploadConfig     storageFileUploadConfig
}

// AuthorizeStorageRead proves that the actor may read both the parent row and
// the exact database-backed object named by request. Unknown legacy roots are
// accepted only when an active child relation proves their parent provenance.
func AuthorizeStorageRead(
	ctx context.Context,
	permissionDB dbutils.Querier,
	roleDB *sql.DB,
	actor dbutils.RequestActorContext,
	request StorageReadRequest,
) (StorageReadDecision, error) {
	if permissionDB == nil || roleDB == nil {
		return StorageReadNotFound, fmt.Errorf("storage authorization database unavailable")
	}
	if !validStorageReadRequest(request) {
		return StorageReadNotFound, nil
	}

	permissionDB = newStoragePermissionQuerier(ctx, permissionDB, roleDB)

	parentTable, found, err := lookupStorageTableName(permissionDB, request.TableUID)
	if err != nil {
		return StorageReadNotFound, err
	}
	if found {
		return authorizeCanonicalStorageRead(ctx, permissionDB, roleDB, actor, parentTable, request)
	}

	return authorizeLegacyStorageRead(ctx, permissionDB, roleDB, actor, request)
}

func validStorageReadRequest(request StorageReadRequest) bool {
	return isCanonicalPositiveID(request.TableUID) &&
		request.ParentRowID > 0 &&
		strings.TrimSpace(request.Variant) != "" &&
		strings.TrimSpace(request.Filename) != ""
}

func lookupStorageTableName(q dbutils.Querier, tableUID string) (string, bool, error) {
	var tableName string
	err := q.QueryRow(
		`SELECT table_name
		   FROM system_db_tables
		  WHERE table_uid = $1
		    AND schema_name = 'public'`,
		tableUID,
	).Scan(&tableName)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", false, nil
		}
		return "", false, fmt.Errorf("resolve storage table uid %s: %w", tableUID, err)
	}
	tableName = strings.TrimSpace(tableName)
	if tableName == "" {
		return "", false, nil
	}
	return tableName, true, nil
}

func lookupStorageParentTableUID(q dbutils.Querier, parentTable string) (int, error) {
	var parentTableUID int
	if err := q.QueryRow(
		`SELECT table_uid
		   FROM system_db_tables
		  WHERE table_name = $1
		    AND schema_name = 'public'`,
		parentTable,
	).Scan(&parentTableUID); err != nil {
		return 0, err
	}
	return parentTableUID, nil
}

// listStorageFileUploadRelationsStrict intentionally owns a small read-only
// metadata query here. Importing the asset-linking handler package would create
// a package cycle back through table deletion and row-read authorization.
func listStorageFileUploadRelationsStrict(q dbutils.Querier, parentTable string) ([]storageFileUploadRelation, error) {
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
	args := make([]interface{}, 0, 1)
	if strings.TrimSpace(parentTable) != "" {
		query += " AND tgt.table_name = $1"
		args = append(args, parentTable)
	}
	query += " ORDER BY tgt.table_name, src.table_name, fk.id"

	rows, err := q.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("query storage file_upload relations: %w", err)
	}
	defer rows.Close()

	relations := make([]storageFileUploadRelation, 0)
	for rows.Next() {
		var relation storageFileUploadRelation
		var specsJSON []byte
		if err := rows.Scan(
			&relation.RelationID,
			&relation.ChildTable,
			&relation.ParentTable,
			&relation.ForeignKeyColumn,
			&specsJSON,
		); err != nil {
			return nil, fmt.Errorf("scan storage file_upload relation: %w", err)
		}

		var envelope storageFileUploadEnvelope
		if err := json.Unmarshal(specsJSON, &envelope); err != nil {
			return nil, fmt.Errorf("parse file_upload relation %d: %w", relation.RelationID, err)
		}
		if envelope.FileUpload == nil {
			return nil, fmt.Errorf("parse file_upload relation %d: missing file_upload config", relation.RelationID)
		}
		relation.UploadConfig = *envelope.FileUpload
		if strings.TrimSpace(relation.UploadConfig.FilenameColumn) == "" {
			relation.UploadConfig.FilenameColumn = "filename"
		}
		relations = append(relations, relation)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate storage file_upload relations: %w", err)
	}
	return relations, nil
}

func authorizeCanonicalStorageRead(
	ctx context.Context,
	permissionDB dbutils.Querier,
	roleDB *sql.DB,
	actor dbutils.RequestActorContext,
	parentTable string,
	request StorageReadRequest,
) (StorageReadDecision, error) {
	canRead, err := storageActorCanReadTable(permissionDB, actor.UserID, parentTable)
	if err != nil {
		return StorageReadNotFound, err
	}
	if !canRead {
		return StorageReadForbidden, nil
	}

	parentRead, err := prepareStorageRowRead(ctx, roleDB, parentTable)
	if err != nil {
		return StorageReadNotFound, err
	}
	visible, err := storageRowVisible(parentRead, parentTable, request.ParentRowID, actor)
	if err != nil {
		return StorageReadNotFound, err
	}
	if !visible {
		return StorageReadNotFound, nil
	}

	selectableColumns, err := storageSelectableColumns(parentRead.querier, parentTable)
	if err != nil {
		return StorageReadNotFound, err
	}
	mediaColumns, err := storageMetadataMediaColumns(permissionDB, request.TableUID)
	if err != nil {
		return StorageReadNotFound, err
	}
	matched, err := storageVisibleParentFieldMatches(
		parentRead,
		parentTable,
		request.ParentRowID,
		actor,
		request,
		request.TableUID,
		intersectStorageColumns(mediaColumns, selectableColumns),
	)
	if err != nil {
		return StorageReadNotFound, err
	}
	if matched {
		return StorageReadAllowed, nil
	}

	relations, err := listStorageFileUploadRelationsStrict(permissionDB, parentTable)
	if err != nil {
		return StorageReadNotFound, fmt.Errorf("load storage relations for %s: %w", parentTable, err)
	}
	relations = activeStorageRelations(relations)

	cacheColumns := activeStorageCacheColumns(relations, parentTable)
	matched, err = storageVisibleParentFieldMatches(
		parentRead,
		parentTable,
		request.ParentRowID,
		actor,
		request,
		request.TableUID,
		intersectStorageColumns(cacheColumns, selectableColumns),
	)
	if err != nil {
		return StorageReadNotFound, err
	}
	if matched {
		return StorageReadAllowed, nil
	}

	for _, relation := range relations {
		parentIDs, relationErr := visibleStorageRelationParentIDs(
			ctx,
			permissionDB,
			roleDB,
			actor,
			relation,
			request.TableUID,
			request,
			request.ParentRowID,
		)
		if relationErr != nil {
			return StorageReadNotFound, relationErr
		}
		if len(parentIDs) > 0 {
			return StorageReadAllowed, nil
		}
	}

	return StorageReadNotFound, nil
}

func authorizeLegacyStorageRead(
	ctx context.Context,
	permissionDB dbutils.Querier,
	roleDB *sql.DB,
	actor dbutils.RequestActorContext,
	request StorageReadRequest,
) (StorageReadDecision, error) {
	relations, err := listStorageFileUploadRelationsStrict(permissionDB, "")
	if err != nil {
		return StorageReadNotFound, fmt.Errorf("load legacy storage relations: %w", err)
	}

	type parentVisibilityKey struct {
		table string
		rowID int64
	}
	visibilityCache := make(map[parentVisibilityKey]bool)
	permissionCache := make(map[string]bool)

	for _, relation := range activeStorageRelations(relations) {
		parentUID, uidErr := lookupStorageParentTableUID(permissionDB, relation.ParentTable)
		if uidErr != nil {
			return StorageReadNotFound, fmt.Errorf("resolve parent uid for %s: %w", relation.ParentTable, uidErr)
		}
		parentUIDString := strconv.Itoa(parentUID)

		parentIDs, relationErr := visibleStorageRelationParentIDs(
			ctx,
			permissionDB,
			roleDB,
			actor,
			relation,
			parentUIDString,
			request,
			0,
		)
		if relationErr != nil {
			return StorageReadNotFound, relationErr
		}
		for _, parentID := range parentIDs {
			canRead, checked := permissionCache[relation.ParentTable]
			if !checked {
				canRead, err = storageActorCanReadTable(permissionDB, actor.UserID, relation.ParentTable)
				if err != nil {
					return StorageReadNotFound, err
				}
				permissionCache[relation.ParentTable] = canRead
			}
			if !canRead {
				continue
			}

			key := parentVisibilityKey{table: relation.ParentTable, rowID: parentID}
			visible, checked := visibilityCache[key]
			if !checked {
				parentRead, setupErr := prepareStorageRowRead(ctx, roleDB, relation.ParentTable)
				if setupErr != nil {
					return StorageReadNotFound, setupErr
				}
				visible, err = storageRowVisible(parentRead, relation.ParentTable, parentID, actor)
				if err != nil {
					return StorageReadNotFound, err
				}
				visibilityCache[key] = visible
			}
			if visible {
				return StorageReadAllowed, nil
			}
		}
	}

	return StorageReadNotFound, nil
}

func storageActorCanReadTable(q dbutils.Querier, userID int, tableName string) (bool, error) {
	return permissions.CheckRouteTablePermission(
		q,
		"/api/get-results",
		userID,
		permissions.RouteTableScope{TableName: tableName},
		permissions.AccessControlRouteTableOptions(false),
	)
}

func prepareStorageRowRead(ctx context.Context, roleDB *sql.DB, tableName string) (storageRowReadContext, error) {
	querier, err := getPilotReadQuerier(ctx, tableName, roleDB)
	if err != nil {
		return storageRowReadContext{}, fmt.Errorf("prepare storage row read for %s: %w", tableName, err)
	}
	policy, err := getLegacyMustTrueReadPolicy(querier, tableName)
	if err != nil {
		return storageRowReadContext{}, fmt.Errorf("load storage row policy for %s: %w", tableName, err)
	}
	return storageRowReadContext{querier: querier, policy: policy}, nil
}

func storageRowVisible(read storageRowReadContext, tableName string, rowID int64, actor dbutils.RequestActorContext) (bool, error) {
	return isRelatedParentRowVisible(
		read.querier,
		tableName,
		int(rowID),
		actor.UserRole,
		actor.UserID,
		read.policy,
	)
}

func storageMetadataMediaColumns(q dbutils.Querier, tableUID string) ([]string, error) {
	rows, err := q.Query(
		`SELECT DISTINCT scd.column_name
		   FROM system_column_details scd
		  WHERE scd.table_uid = $1
		    AND (
		      scd.column_name = 'cached_image'
		      OR COALESCE(scd.card_element, '') ILIKE '%image%'
		    )
		  ORDER BY scd.column_name`,
		tableUID,
	)
	if err != nil {
		return nil, fmt.Errorf("load storage media columns for table uid %s: %w", tableUID, err)
	}
	defer rows.Close()

	columns := make([]string, 0)
	for rows.Next() {
		var column string
		if err := rows.Scan(&column); err != nil {
			return nil, err
		}
		column = strings.TrimSpace(column)
		if column != "" {
			columns = append(columns, column)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return columns, nil
}

func storageSelectableColumns(q dbutils.Querier, tableName string) (map[string]bool, error) {
	rows, err := q.Query(
		`SELECT column_name
		   FROM information_schema.column_privileges
		  WHERE table_schema = 'public'
		    AND table_name = $1
		    AND privilege_type = 'SELECT'
		    AND grantee = current_user`,
		tableName,
	)
	if err != nil {
		return nil, fmt.Errorf("load selectable storage columns for %s: %w", tableName, err)
	}
	defer rows.Close()

	columns := make(map[string]bool)
	for rows.Next() {
		var column string
		if err := rows.Scan(&column); err != nil {
			return nil, err
		}
		columns[strings.TrimSpace(column)] = true
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return columns, nil
}

func intersectStorageColumns(candidates []string, selectable map[string]bool) []string {
	seen := make(map[string]bool, len(candidates))
	columns := make([]string, 0, len(candidates))
	for _, column := range candidates {
		column = strings.TrimSpace(column)
		if column == "" || seen[column] || !selectable[column] {
			continue
		}
		seen[column] = true
		columns = append(columns, column)
	}
	sort.Strings(columns)
	return columns
}

func storageVisibleParentFieldMatches(
	read storageRowReadContext,
	tableName string,
	rowID int64,
	actor dbutils.RequestActorContext,
	request StorageReadRequest,
	defaultTableUID string,
	columns []string,
) (bool, error) {
	if len(columns) == 0 {
		return false, nil
	}

	selectExpressions := make([]string, 0, len(columns))
	for _, column := range columns {
		selectExpressions = append(selectExpressions, pq.QuoteIdentifier(column)+"::text")
	}
	whereClause := fmt.Sprintf(
		" WHERE %s.%s = $1",
		pq.QuoteIdentifier(tableName),
		pq.QuoteIdentifier("id"),
	)
	args := []interface{}{rowID}
	whereClause, args = appendReadPolicyToWhereClause(
		tableName,
		actor.UserRole,
		actor.UserID,
		read.policy,
		whereClause,
		args,
	)
	query := fmt.Sprintf(
		"SELECT %s FROM %s%s",
		strings.Join(selectExpressions, ", "),
		pq.QuoteIdentifier(tableName),
		whereClause,
	)

	values := make([]sql.NullString, len(columns))
	destinations := make([]interface{}, len(columns))
	for idx := range values {
		destinations[idx] = &values[idx]
	}
	if err := read.querier.QueryRow(query, args...).Scan(destinations...); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, fmt.Errorf("read storage fields from %s row %d: %w", tableName, rowID, err)
	}

	for _, value := range values {
		if value.Valid && storageReferenceMatches(value.String, defaultTableUID, rowID, request) {
			return true, nil
		}
	}
	return false, nil
}

func activeStorageRelations(relations []storageFileUploadRelation) []storageFileUploadRelation {
	active := make([]storageFileUploadRelation, 0, len(relations))
	for _, relation := range relations {
		if storageFileUploadConfigActive(relation.UploadConfig) {
			active = append(active, relation)
		}
	}
	return active
}

func storageFileUploadConfigActive(config storageFileUploadConfig) bool {
	if len(config.Profiles) > 0 {
		for _, profile := range config.Profiles {
			if profile.Enabled {
				return true
			}
		}
		return false
	}
	return config.Enabled
}

func activeStorageCacheColumns(relations []storageFileUploadRelation, parentTable string) []string {
	columns := make([]string, 0)
	for _, relation := range relations {
		if len(relation.UploadConfig.Profiles) == 0 && relation.UploadConfig.Enabled {
			for _, target := range relation.UploadConfig.CacheTargets {
				if target.Table == parentTable {
					columns = append(columns, target.Column)
				}
			}
		}
		for _, profile := range relation.UploadConfig.Profiles {
			if !profile.Enabled {
				continue
			}
			for _, target := range profile.CacheTargets {
				if target.Table == parentTable {
					columns = append(columns, target.Column)
				}
			}
		}
	}
	return columns
}
